/** Bounded real-model pilot using Harness kernels and the actual dsh-opencode-go plugin. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorageBackend from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as Fork from '@deepseek-ai/dsh-subagent-fork-in-process'
import TeamService from '@deepseek-ai/dsh-experimental-agent-team'
import * as TeamTools from '@deepseek-ai/dsh-experimental-tool-agent-team'
import * as OpenCodeGo from 'dsh-opencode-go'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { parseArgs } from 'node:util'
import AtnRuntimePlugin from '../src/index.ts'
import * as AtnTools from '../src/tools.ts'
import { getPilotTask, PILOT_TASK_IDS, renderTaskPrompt, type PilotTaskId } from './tasks.ts'
import { evaluatePilotTask } from './evaluation.ts'
import { installTelemetry, type PriceTable, type TelemetrySnapshot } from './telemetry.ts'
import { assertAllowedPilotModel, discoverPilotModels, type PilotModel } from './provider.ts'
import { isTaskAccepted, taskResultDigest } from '../src/tasks.ts'
import { createExperimentBudget, installExperimentOutputCap } from './budget.ts'
import { ExperimentSessionQuery } from './session-query.ts'
import { extractFinalTextSubmission, installAtnSubmissionBridge } from './submission.ts'
import { getTopologyTask, isTopologyTask, renderTopologyPrompt, TOPOLOGY_TASK_IDS, TopologyScenario, type TopologyTaskId } from './topology-task.ts'
import { evaluateTopologyTask } from './topology-evaluation.ts'
import { advanceTopologyScenario, provisionTopologyScenario } from './topology-host.ts'
import { assertReferenceFeasible, topologyRuntimeConfig, relativeAtnMetrics, PRIMARY_METRICS } from './measurement-gate.ts'
import { calibratedTokenLimit, type CalibrationSample } from './calibration.ts'
import { summarizeMeasurements } from './measurement-summary.ts'

// Capture once per process, before a batch starts. Do not edit source during runs.
const sourceFiles = ['run.ts', 'budget.ts', 'submission.ts', 'tasks.ts', 'evaluation.ts', 'topology-task.ts', 'topology-evaluation.ts', 'topology-host.ts', 'provider.ts', 'telemetry.ts', 'session-query.ts',
  'reference-run.ts', 'reference-policy.ts', 'reference-kernel.ts', 'measurement-gate.ts', 'measurement-summary.ts', 'calibration.ts', 'atn-cost.ts',
  '../src/runtime.ts', '../src/mailbox.ts', '../src/messages.ts', '../src/topology.ts', '../src/topology-feedback.ts',
  '../src/tasks.ts', '../src/governance.ts', '../src/proposals.ts', '../src/verified-feedback.ts', '../src/local-feedback.ts',
  '../src/config.ts', '../src/schema.ts', '../src/tools.ts', '../package-lock.json']
const diskSourceHashesAtModuleLoad = Object.fromEntries(await Promise.all(sourceFiles.map(async path =>
  [path, createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex')])))

export const PILOT_MODES = ['single', 'independent-pool', 'native-team', 'atn-no-rewire', 'atn-adaptive',
  'atn-no-rewire-preassigned-backup', 'atn-adaptive-preassigned-backup'] as const
export type PilotMode = typeof PILOT_MODES[number]
export interface RunOptions {
  mode: PilotMode; model: PilotModel; task: PilotTaskId | TopologyTaskId; directory: string
  maxCalls: number; maxOutputTokens: number; observedTokenLimit: number | null; timeoutMs: number; maxAgents: number
  /** ATN step budget per node, including the entry; separate from the global experiment safety cap. */
  perNodeSteps?: number
  calibration?: boolean
  calibrationSamples?: readonly CalibrationSample[]
}

function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_-]{1,80}$/.test(error.code)) return error.code
  return error instanceof Error && /^[A-Za-z0-9_-]{1,80}$/.test(error.name) ? error.name : 'unknown-error'
}

/** Synthetic task inputs only: no shell, filesystem, network or environment tool is exposed. */
export async function runPilot(options: RunOptions) {
  assertAllowedPilotModel(options.model)
  if (isTopologyTask(options.task) && !options.mode.startsWith('atn-')) throw new Error('Distributed topology tasks require an ATN mode; use legacy tasks for architecture smoke tests')
  const perNodeSteps = options.perNodeSteps ?? 16
  if (!Number.isSafeInteger(perNodeSteps) || perNodeSteps < 1 || perNodeSteps > 64) throw new Error('perNodeSteps must be an integer from 1 to 64')
  const recoveryMode = options.mode.endsWith('-preassigned-backup') ? 'preassigned-backup' : 'self-organized'
  const calibrationKey = { model: options.model.id, task: options.task, maxAgents: options.maxAgents,
    perNodeSteps, maxOutputTokens: options.maxOutputTokens, recoveryMode } as const
  // This is outside the provider try/catch: an infeasible arm never loads an adapter.
  const reference = options.mode.startsWith('atn-') ? await assertReferenceFeasible(options.task,
    { maxAgents: options.maxAgents, perNodeSteps, timeoutMs: options.timeoutMs, maxCalls: options.maxCalls, recoveryMode }) : null
  if (reference && options.maxCalls < options.maxAgents * perNodeSteps) throw new Error('Global call safety cap must cover every per-node step allocation')
  const tokenCalibration = reference && !options.calibration
    ? calibratedTokenLimit(options.calibrationSamples ?? [], calibrationKey) : null
  const observedTokenLimit = reference ? tokenCalibration?.observedTokenLimit ?? null : options.observedTokenLimit
  if (observedTokenLimit === null && !options.calibration) throw new Error('Unlimited token admission is only available for explicit calibration')
  const ctx = new Context()
  ctx.baseUrl = import.meta.url
  const topologyTask = isTopologyTask(options.task) ? getTopologyTask(options.task, options.maxAgents) : undefined
  const task = topologyTask ? undefined : getPilotTask(options.task as PilotTaskId)
  const scenario = topologyTask ? new TopologyScenario(topologyTask, { recoveryMode }) : undefined
  const taskId = options.task
  const taskRevision = (topologyTask ?? task)!.revision
  const prompt = topologyTask ? renderTopologyPrompt(topologyTask, recoveryMode) : renderTaskPrompt(task!)
  const directory = resolve(options.directory)
  await mkdir(directory, { recursive: true })
  const runId = randomUUID()
  const started = Date.now()
  let entry: Agent | undefined
  let answer: string | undefined
  let submissionMethod: 'tool' | 'final-text' | 'none' = 'none'
  let stopReason = 'quiescent-without-submission'
  const budget = createExperimentBudget({ provider: OpenCodeGo.PROVIDER_ID, model: options.model.id,
    maxCalls: options.maxCalls, maxOutputTokens: options.maxOutputTokens, observedTokenLimit })
  let peakAgents = 0
  let totalAgents = 0
  let agentCreationEvents = 0
  let maxTokenTruncations = 0
  const agentSessions = new Set<string>()
  let ended = false
  const requestFailures: Array<{ code: string; status?: number }> = []
  let telemetry: Awaited<ReturnType<typeof installTelemetry>> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let phaseTimer: ReturnType<typeof setTimeout> | undefined
  let phaseTransition: Promise<void> | undefined
  let provisioningComplete!: () => void
  const provisioningReady = scenario ? new Promise<void>(resolveReady => { provisioningComplete = resolveReady }) : Promise.resolve()
  let protocol: unknown = null
  let cleanup = 'released'
  let submissionMetrics: TelemetrySnapshot | null = null
  let submissionBoundary = -1
  let finalTextExtraction: ReturnType<typeof extractFinalTextSubmission> | null = null
  const submissionBoundaries = new Map<string, number>()
  const submissionAgent = async (): Promise<Agent | undefined> => {
    if (!entry || !options.mode.startsWith('atn-')) return entry
    const networkId = ctx.atn.networkForSession(entry.id)
    if (!networkId) return undefined
    const holder = await ctx.atn.deliveryHolder(networkId)
    if (!holder) return undefined
    const record = await ctx.atn.network(networkId)
    return ctx.agents.list().find(agent => agent.id === record.nodes[holder]?.sessionId)
  }
  const independentCandidates: Array<ReturnType<typeof extractFinalTextSubmission>> = []
  const candidateCalls = new Map<string, number>()
  const candidateCallLimit = Math.floor((options.maxCalls - 1) / (options.maxAgents - 1))
  const nativeQueuedMail = (): number => {
    const pending = new Set<string>()
    for (const event of entry?.session.snapshotEvents() ?? []) {
      if (event.type === 'team/message/queued') pending.add(event.data.message.id)
      if (event.type === 'team/message/delivered') pending.delete(event.data.messageId)
    }
    return pending.size
  }
  let signalEnd!: () => void
  const endSignal = new Promise<void>(resolveEnd => { signalEnd = resolveEnd })
  const prices: PriceTable = {
    id: 'live-models.dev-opencode-go-reference-not-subscription-bill', currency: 'USD', reasoningIncludedInOutput: true,
    routes: [{ provider: OpenCodeGo.PROVIDER_ID, model: options.model.id,
      inputPerMillion: options.model.referenceCostPerMillion.input,
      outputPerMillion: options.model.referenceCostPerMillion.output,
      cacheReadPerMillion: options.model.referenceCostPerMillion.cacheRead,
      cacheWritePerMillion: options.model.referenceCostPerMillion.cacheWrite }],
  }
  const cancel = (reason: string): void => {
    ended = true
    stopReason = reason
    signalEnd()
    for (const agent of ctx.get('agents')?.list() ?? []) agent.cancel({ kind: 'hook', reason })
  }
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
    await ctx.plugin(OpenCodeGo, {
      apiKeyEnv: 'OPENCODE_API_KEY', usageDisplay: 'off', streamIdleTimeoutMs: Math.min(60_000, options.timeoutMs),
      modelLimits: { [options.model.id]: { maxTokens: options.maxOutputTokens } },
    })
    if (!ctx.llm.listProviders().some(provider => provider.id === OpenCodeGo.PROVIDER_ID)) throw new Error('OpenCode plugin route is unavailable')
    telemetry = await installTelemetry(ctx, { directory, runId, prices })
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'turn/end' && event.data.reason.kind === 'max-tokens') maxTokenTruncations++
    }, { global: true })
    // Official config waterfall: the loop records this header before freezing
    // its request, including for children that omit maxTokens in their options.
    installExperimentOutputCap(ctx, options.maxOutputTokens)
    // Hold before ATN constructs local topology feedback, so the first model
    // context describes the final seeded graph rather than a partial birth graph.
    if (scenario) ctx.on('agent/pre-step', async (_payload, next) => { await provisioningReady; return next() }, { global: true, prepend: true })
    // This middleware never invokes the downstream adapter after the hard call limit.
    ctx.on('llm/stream', (request, next) => (async function* () {
      // Host-created workers cannot see or act on a partially provisioned graph.
      await provisioningReady
      const candidateUsed = request.sessionId ? candidateCalls.get(request.sessionId) : undefined
      if (candidateUsed !== undefined && candidateUsed >= candidateCallLimit) throw new Error('pilot-independent-candidate-limit')
      const observed = telemetry?.snapshot().totals.tokens.totalTokens
      const admission = budget.admit(request, { ended: ended || answer !== undefined,
        knownTotalTokens: observed?.known ?? 0, unknownUsageCalls: observed?.unknownCalls ?? 0 })
      if (!admission.allowed) {
        if (admission.reason !== 'ended') cancel(admission.reason)
        throw new Error(`pilot-${admission.reason}`)
      }
      if (candidateUsed !== undefined) candidateCalls.set(request.sessionId!, candidateUsed + 1)
      for await (const chunk of next()) {
        if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
          const failure = chunk.reason.failure
          const code = /trains on request data/i.test(failure.message) ? 'PRIVACY_SETTING_REQUIRED' : failure.code
          const encodedStatus = /API error \((\d{3})\)/.exec(failure.message)?.[1]
          requestFailures.push({ code, status: failure.status ?? (encodedStatus ? Number(encodedStatus) : undefined) })
        }
        yield chunk
      }
    })(), { global: true, prepend: true })
    ctx.on('agent/created', ({ agent }) => {
      agentCreationEvents += 1
      agentSessions.add(agent.id)
      scenario?.register(agent.id)
      submissionBoundaries.set(agent.id, agent.session.snapshotEvents().at(-1)?.seq ?? -1)
      totalAgents = agentSessions.size
      peakAgents = Math.max(peakAgents, ctx.agents.list().length)
      return undefined
    })
    const policy = [
      scenario ? 'Solve the distributed evidence task. read_document enforces per-node access; use id="mine" to list your current documents.'
        : 'Solve the synthetic task using the supplied documents. read_document provides the same documents to every worker.',
      options.mode.startsWith('atn-')
        ? 'The current delivery holder may submit_answer, or use atn_finish(scope=network) with the final JSON as summary. A successful network finish also submits the artifact. Initially the entry holds delivery; after its retirement, settle your work and claim the orphan delivery task through atn_status to take over.'
        : 'Only the initial entry/Lead may submit_answer. Workers return their findings through their architecture tools, or as final JSON text if no collaboration tools exist.',
      'Before final submission finish required collaboration. Give exactly one final JSON answer via submit_answer or your final text response; do not include surrounding prose.',
      `Run bounds: at most ${options.maxAgents} total agents including the entry, ${options.maxCalls} model calls across all agents, ${options.maxOutputTokens} output tokens per call. Keep coordination concise.`,
      options.mode.startsWith('atn-') ? `Each node, including the entry, has ${perNodeSteps} admitted model steps. Exhausted nodes retire; the global call cap is a separate experiment safety limit.` : '',
      options.mode === 'native-team' ? 'The user explicitly requests use of Agent Teams. Choose your own collaborators and task strategy using the native Team tools.' : '',
      options.mode.includes('no-rewire') ? 'Experimental ablation: voluntary atn_rewire is disabled. Birth connections and inactive-neighbour repair still operate. All other ATN rules apply.' : '',
    ].filter(Boolean).join('\n')
    ctx.systemPrompt.section({ name: 'pilot-common', order: 10, text: policy })
    const output = { schema: { type: 'json' } as const, render: (_: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
    const schedulePhaseTransition = (): void => {
      if (!scenario?.readyForPhaseChange || phaseTransition || phaseTimer || ended) return
      // Separate host callback: never release a worker while awaiting its own tool stack.
      phaseTimer = setTimeout(() => {
        phaseTimer = undefined
        phaseTransition = (async () => {
          if (ended || !entry || !topologyTask) return
          await advanceTopologyScenario(ctx, entry, scenario, () => ended)
        })().catch(error => { cancel(`phase-injection-error:${codeOf(error)}`) })
      }, 0)
    }
    ctx.tools.register(defineTool({ name: 'read_document', description: 'Read an accessible task document; id="mine" lists the current node documents for distributed tasks.',
      parameters: { id: { type: 'string', required: true, description: scenario ? 'mine, or one of the accessible document ids returned by mine.' : `Document id: ${task!.documents.map(document => document.id).join(', ')}.` } }, output,
      async execute(args, execution) {
        if (scenario) {
          if (!execution.agent) throw new Error('A node session is required to read distributed evidence')
          const result = scenario.read(execution.agent.id, args.id)
          schedulePhaseTransition()
          return JSON.parse(JSON.stringify(result)) as JsonValue
        }
        const document = task!.documents.find(item => item.id === args.id)
        if (!document) throw new Error('Unknown task document')
        return { id: document.id, text: document.text }
      },
    }))
    ctx.tools.register(defineTool({ name: 'submit_answer', description: 'Current delivery holder (or entry/Lead outside ATN): submit the final JSON artifact. No correctness feedback is returned.',
      parameters: { answer: { type: 'string', required: true, description: 'The final answer JSON object encoded as a string, following the task format.' } }, output,
      async execute(args, execution) {
        const holder = await submissionAgent()
        if (!holder || execution.agent !== holder) throw new Error('Only the current delivery holder may submit')
        if (scenario && scenario.snapshot().phase !== 2) throw new Error('Final submission requires the phase 2 update')
        if (Buffer.byteLength(args.answer, 'utf8') > 16_384) throw new Error('Answer exceeds the artifact size limit')
        if (answer !== undefined) throw new Error('An answer was already submitted')
        answer = args.answer
        submissionMethod = 'tool'
        stopReason = 'submitted'
        submissionMetrics = telemetry?.snapshot() ?? null
        signalEnd()
        return { accepted: true }
      },
    }))
    if (options.mode.startsWith('atn-')) {
      await ctx.plugin(Storage)
      await ctx.plugin(JsonStorageBackend, { root: join(directory, 'storage') })
      await ctx.plugin(StorageDomain, { backend: 'json' })
      await ctx.plugin(AtnRuntimePlugin, topologyRuntimeConfig({ maxAgents: options.maxAgents, perNodeSteps,
        timeoutMs: options.timeoutMs, maxCalls: options.maxCalls, recoveryMode }))
      await ctx.plugin(AtnTools)
      installAtnSubmissionBridge(ctx.atn, input => {
        if (scenario && scenario.snapshot().phase !== 2) throw new Error('Final submission requires the phase 2 update')
        if (Buffer.byteLength(input.summary, 'utf8') > 16_384) throw new Error('Answer exceeds the artifact size limit')
        if (answer !== undefined) throw new Error('An answer was already submitted')
      }, submitted => {
        answer = submitted; submissionMethod = 'tool'; stopReason = 'submitted'
        submissionMetrics = telemetry?.snapshot() ?? null
        signalEnd()
      })
      if (options.mode.includes('no-rewire')) ctx.atn.rewire = async () => { throw new Error('Voluntary rewiring is disabled by this experiment') }
    } else if (options.mode === 'native-team') {
      await ctx.plugin(ExperimentSessionQuery)
      await ctx.plugin(SubagentRuntime, { maxActiveSubagents: options.maxAgents - 1, maxDepth: 1 })
      await ctx.plugin(Spawn, { providerName: 'spawn' })
      await ctx.plugin(Fork, { providerName: 'fork' })
      await ctx.plugin(TeamService, { maxMembers: options.maxAgents - 1, maxTasks: 32, maxPendingMessagesPerMember: 32, maxMessageBytes: 8192 })
      await ctx.plugin(TeamTools, { freshProvider: 'spawn', forkProvider: 'fork' })
    }
    const handle = await ctx.agents.create({ sessionId: SessionId(`pilot-${runId}`),
      agentOptions: { provider: OpenCodeGo.PROVIDER_ID, model: options.model.id, maxTokens: options.maxOutputTokens },
      meta: { cwd: join(directory, 'workspace') } })
    entry = handle.agent
    await mkdir(join(directory, 'workspace'), { recursive: true })
    await writeFile(join(directory, 'input.json'), JSON.stringify(topologyTask ?? task, null, 2) + '\n')
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ runId, mode: options.mode, task: taskId, taskRevision,
      taskSha256: createHash('sha256').update(JSON.stringify(topologyTask ?? task)).digest('hex'), provider: OpenCodeGo.PROVIDER_ID, model: options.model,
      limits: { calls: options.maxCalls, perCallOutputTokens: options.maxOutputTokens, observedTokens: observedTokenLimit,
        tokenLimitIsAdmissionThreshold: true, timeoutMs: options.timeoutMs, agents: options.maxAgents, perNodeSteps, maxTasks: 128 },
      calibration: !!options.calibration, tokenCalibration, primaryMetrics: PRIMARY_METRICS, reference,
      topologyConditions: topologyTask ? { initialTopology: 'host-seeded-ring', seededNodes: topologyTask.agents,
        evidenceAccess: 'creation-slot ACL; no shard text in shared prompt', phaseTrigger: 'all initial shards read',
        failedSlot: topologyTask.failedSlot, recoveryMode, backupSlot: recoveryMode === 'preassigned-backup' ? topologyTask.backupSlot : null, oracle: 'final only',
        comparison: 'same task hash, seed, initial graph, phase/failure policy and budgets for both ATN modes' } : null,
      packages: { harness: '0.2.0-rc.2', provider: '0.1.20' },
      diskSourceHashesAtModuleLoad, finalTextRule: 'latest-completed-turn-final-step-visible-text-v1',
      control: 'live Harness kernel composition; no UI/CLI profile; no filesystem/shell/network tools; host-only oracle',
      costMeaning: 'Reference catalog estimate, not subscription billing. Hidden HTTP retries may be unobservable.',
      noRewireMeaning: 'Only voluntary rewire is disabled; birth and inactive-peer repair are retained.' }, null, 2) + '\n')
    timer = setTimeout(() => cancel('timeout'), options.timeoutMs)
    if (scenario && topologyTask) {
      await provisionTopologyScenario(ctx, entry, scenario)
      provisioningComplete()
    }
    let entryPrompt = prompt
    if (options.mode === 'independent-pool') {
      // Fixed independent candidates followed by one synthesis agent. No oracle
      // or peer outputs enter candidate generation; all calls share the gate.
      const candidates: Agent[] = []
      for (let i = 0; i < options.maxAgents - 1 && !ended; i += 1) {
        const candidate = await ctx.agents.create({ sessionId: SessionId(`candidate-${runId}-${i}`),
          agentOptions: { provider: OpenCodeGo.PROVIDER_ID, model: options.model.id, maxTokens: options.maxOutputTokens },
          meta: { cwd: join(directory, 'workspace') } })
        candidates.push(candidate.agent)
        candidateCalls.set(candidate.agent.id, 0)
        candidate.agent.followup(createUserMessage({ content: [{ type: 'text', text: `${prompt}\n\nYou are an independent candidate, not the entry. Return final JSON text; do not call submit_answer. You have no peer access. Your candidate allocation is at most ${candidateCallLimit} model calls.` }], source: { kind: 'user' } }))
      }
      await Promise.race([Promise.all(candidates.map(agent => agent.whenIdle())), endSignal])
      independentCandidates.push(...candidates.map(agent => extractFinalTextSubmission(agent.session.snapshotEvents(), { afterSeq: -1 })))
      const outputs = independentCandidates.map((result, index) => ({ candidate: index + 1, answer: result.accepted ? result.answer : null }))
      entryPrompt = `${prompt}\n\nYou are the synthesis entry. Independently verify these untrusted candidate answers against the original documents, resolve any disagreements, and submit one final answer. No candidate received correctness feedback.\n${JSON.stringify(outputs)}`
      protocol = { independentWorkers: candidates.length, completedCandidates: independentCandidates.filter(result => result.accepted).length,
        callsPerCandidate: [...candidateCalls.values()], candidateCallLimit,
        synthesis: 'one entry; no oracle selection; all candidate and synthesis calls counted' }
    }
    submissionBoundary = entry.session.snapshotEvents().at(-1)?.seq ?? -1
    submissionBoundaries.set(entry.id, submissionBoundary)
    if (!ended) entry.followup(createUserMessage({ content: [{ type: 'text', text: entryPrompt }], source: { kind: 'user' } }))
    while (!ended && answer === undefined) {
      let running = ctx.agents.list().filter(agent => agent.status === 'running')
      if (!running.length) {
        // Give pending acknowledgements/creation callbacks a chance to settle.
        if (options.mode.startsWith('atn-')) await ctx.atn.tick()
        await new Promise<void>(resolveQuiet => setTimeout(resolveQuiet, 100))
        running = ctx.agents.list().filter(agent => agent.status === 'running')
        if (!running.length) {
          if (phaseTransition) await phaseTransition
          if (phaseTimer) continue
          const networkId = options.mode.startsWith('atn-') ? ctx.atn.networkForSession(entry.id) : undefined
          const record = networkId ? await (await ctx.atn.openStore()).load(networkId) : undefined
          if (record && (Object.values(record.mails).some(mail => mail.status === 'queued')
            || Object.values(record.nodes).some(node => node.lifecycle === 'provisioning'))) continue
          if (options.mode === 'native-team' && (nativeQueuedMail() > 0
            || ctx.agentTeams.listMembers(entry).some(member => member.status === 'provisioning'))) continue
          break
        }
      }
      await Promise.race([Promise.all(running.map(agent => agent.whenIdle())), endSignal])
    }
    if (answer === undefined && !ended) {
      const holder = await submissionAgent()
      finalTextExtraction = holder ? extractFinalTextSubmission(holder.session.snapshotEvents(),
        { afterSeq: submissionBoundaries.get(holder.id) ?? -1 }) : { accepted: false, reason: 'no-current-turn' }
      if (finalTextExtraction.accepted && (!scenario || scenario.snapshot().phase === 2)) {
        answer = finalTextExtraction.answer; submissionMethod = 'final-text'; stopReason = 'final-text'
        submissionMetrics = telemetry?.snapshot() ?? null
      }
    }
    if (options.mode.startsWith('atn-')) {
      const networkId = ctx.atn.networkForSession(entry.id)
      if (networkId) {
        const record = await (await ctx.atn.openStore()).load(networkId)
        if (record) protocol = { status: record.status, nodes: Object.keys(record.nodes).length,
          queuedMail: Object.values(record.mails).filter(mail => mail.status === 'queued').length,
          pendingProposals: Object.values(record.proposals).filter(proposal => proposal.status === 'pending').length,
          openTasks: Object.values(record.tasks).filter(item => item.status === 'open').length,
          failedTasks: Object.values(record.tasks).filter(item => item.status === 'failed' || item.status === 'unreachable').length,
          taskAcceptance: {
            passed: Object.values(record.tasks).filter(isTaskAccepted).length,
            rejected: Object.values(record.tasks).filter(item => item.acceptance?.status === 'failed' && item.acceptance.resultDigest === taskResultDigest(item)).length,
            submittedUnverified: Object.values(record.tasks).filter(item => item.status === 'completed' && item.acceptance == null).length,
          },
          explicitRewires: (record.rewireHistory ?? []).map(item => ({ intent: item.intent, verdict: item.evaluation.verdict, causalClaim: false })),
          governanceProposals: Object.values(record.proposals).map(item => ({ status: item.status, voters: item.voters.length })),
        }
      }
    } else if (options.mode === 'native-team') {
      const tasks = ctx.agentTeams.listTasks(entry)
      protocol = { members: ctx.agentTeams.listMembers(entry).length, queuedMail: nativeQueuedMail(),
        openTasks: tasks.filter(task => task.status === 'pending' || task.status === 'in_progress').length,
        tasks: tasks.map(item => ({ status: item.status })) }
    }
    if (protocol && typeof protocol === 'object') protocol = { ...protocol, activeAgentsAtStop: ctx.agents.list().filter(agent => agent.status === 'running').length }
  } catch (error) {
    stopReason = `host-error:${codeOf(error)}`
  } finally {
    if (timer) clearTimeout(timer)
    if (phaseTimer) clearTimeout(phaseTimer)
    ended = true
    provisioningComplete?.()
    if (phaseTransition) await phaseTransition
    for (const agent of ctx.get('agents')?.list() ?? []) agent.cancel({ kind: 'hook', reason: 'pilot cleanup' })
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined
    try {
      cleanup = await Promise.race([
        ctx.fiber.dispose().then(() => 'released', () => 'failed'),
        new Promise<string>(resolveCleanup => { cleanupTimer = setTimeout(() => resolveCleanup('timed-out'), 15_000) }),
      ])
    } finally { if (cleanupTimer) clearTimeout(cleanupTimer) }
  }
  const metrics: TelemetrySnapshot | null = telemetry ? await telemetry.close() : null
  const evaluation = topologyTask ? evaluateTopologyTask(topologyTask, answer ?? '') : evaluatePilotTask(task!.id, answer ?? '')
  const report = { runId, mode: options.mode, model: options.model.id, task: taskId, stopReason,
    elapsedMs: Date.now() - started, issuedModelCalls: budget.snapshot().issued, budget: budget.snapshot(), peakAgents, totalAgents, agentCreationEvents,
    requestFailures, maxTokenTruncations, protocol, evaluation, metrics, submissionMetrics, submissionMethod, finalTextExtraction,
    independentCandidates, cleanup, answer: answer ?? null, manipulation: scenario?.snapshot() ?? null,
    calibration: !!options.calibration, tokenCalibration,
    limits: { ...calibrationKey, observedTokenLimit, maxCalls: options.maxCalls, maxTasks: 128, timeoutMs: options.timeoutMs },
    primaryMetrics: PRIMARY_METRICS, reference,
    atnMessages: metrics?.atnMessages ?? 0, atnPayloadBytes: metrics?.atnPayloadBytes ?? 0,
    relativeMetrics: reference && metrics ? relativeAtnMetrics(metrics.atnMessages, metrics.atnPayloadBytes, reference) : null }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    execute: { type: 'boolean', default: false }, models: { type: 'string', default: 'space-bunny-free' },
    modes: { type: 'string' },
    tasks: { type: 'string', default: 'shift-ledger-1,shift-ledger-2' }, repeats: { type: 'string' },
    calls: { type: 'string' }, 'output-tokens': { type: 'string', default: '8192' },
    'observed-tokens': { type: 'string' }, 'timeout-ms': { type: 'string', default: '180000' },
    calibrate: { type: 'boolean', default: false }, calibration: { type: 'string' },
    agents: { type: 'string' }, 'node-steps': { type: 'string', default: '16' }, out: { type: 'string' },
  } })
  const integer = (value: string, maximum: number) => { const n = Number(value); if (!Number.isInteger(n) || n < 1 || n > maximum) throw new Error(`Expected positive integer <= ${maximum}`); return n }
  const tasks = values.tasks.split(',') as Array<PilotTaskId | TopologyTaskId>
  const distributed = tasks.some(isTopologyTask)
  const maxCalls = integer(values.calls ?? (distributed ? '128' : '16'), 256)
  const maxOutputTokens = integer(values['output-tokens'], 8192)
  if (distributed && values['observed-tokens']) throw new Error('Topology runs use measured calibration × 2; use --calibrate or --calibration results.json')
  if (values.calibrate && values.calibration) throw new Error('Choose calibration collection or a measured calibration file')
  const observedTokenLimit = distributed || values.calibrate ? null : integer(values['observed-tokens'] ?? '250000', Number.MAX_SAFE_INTEGER)
  const calibrationSamples = values.calibration ? JSON.parse(await readFile(resolve(values.calibration), 'utf8')) as CalibrationSample[] : []
  if (!Array.isArray(calibrationSamples)) throw new Error('Calibration file must contain an array of run reports')
  if (distributed && values.execute && !values.calibrate && !values.calibration) throw new Error('Main topology runs require --calibration results.json; first collect a --calibrate pair')
  const timeoutMs = integer(values['timeout-ms'], 600_000)
  const maxAgents = integer(values.agents ?? (distributed ? '8' : '3'), 16)
  const perNodeSteps = integer(values['node-steps'], 64)
  if (maxAgents < 2) throw new Error('Pilot matrix requires an agent capacity of at least two; single mode still creates one')
  const repeats = integer(values.repeats ?? (values.calibrate ? '1' : '3'), 3)
  const modes = (values.modes ?? (distributed ? 'atn-no-rewire,atn-adaptive' : 'single,independent-pool,native-team')).split(',') as PilotMode[]
  if (modes.some(mode => !PILOT_MODES.includes(mode)) || tasks.some(task => ![...PILOT_TASK_IDS, ...TOPOLOGY_TASK_IDS].includes(task))) throw new Error('Unknown pilot mode or task')
  if (distributed && (maxAgents < 8 || modes.some(mode => !mode.startsWith('atn-')))) throw new Error('Distributed tasks require at least 8 agents and ATN modes only')
  if (modes.includes('independent-pool') && maxCalls < maxAgents) throw new Error('Independent pool needs at least one call per candidate plus one synthesis call')
  if (new Set(modes).size !== modes.length || new Set(tasks).size !== tasks.length) throw new Error('Duplicate modes or tasks would reuse an output directory')
  process.env.DSH_HOME ??= resolve('.scratch/pilot-harness-home')
  const catalog = await discoverPilotModels()
  const models = values.models.split(',').map(id => {
    const model = catalog.models.find(item => item.id === id)
    if (!model) throw new Error(`Model is not in the live requested/free allowlist: ${id}`)
    assertAllowedPilotModel(model)
    return model
  })
  if (new Set(models.map(model => model.id)).size !== models.length) throw new Error('Duplicate models would reuse an output directory')
  const directory = resolve(values.out ?? join('.artifacts/experiments', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`))
  const plan = { directory, models: models.map(model => model.id), modes, tasks, repeats, runs: models.length * modes.length * tasks.length * repeats,
    maxCallsPerRun: maxCalls, maxAgents, perNodeSteps, maxOutputTokensPerCall: maxOutputTokens,
    observedTokenThresholdPerRun: distributed && !values.calibrate ? 'matching calibration maximum × 2' : observedTokenLimit,
    calibration: values.calibrate, primaryMetrics: PRIMARY_METRICS, failurePolicy: 'retain every failed run; no replacement sampling', timeoutMs }
  console.log(JSON.stringify({ plan }))
  if (!values.execute) { console.log('Dry run only. Pass --execute to call the selected models.'); return }
  if (!process.env.OPENCODE_API_KEY) throw new Error('OPENCODE_API_KEY is not configured')
  if (plan.runs > 36) throw new Error('Limit each pilot batch to at most 36 runs')
  await mkdir(resolve(directory, '..'), { recursive: true })
  await mkdir(directory)
  await writeFile(join(directory, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
  const reports: Awaited<ReturnType<typeof runPilot>>[] = []
  for (const [modelIndex, model] of models.entries()) for (const [taskIndex, task] of tasks.entries()) for (let repetition = 0; repetition < repeats; repetition += 1) {
    const rotation = (modelIndex + taskIndex + repetition) % modes.length
    const rotatedModes = [...modes.slice(rotation), ...modes.slice(0, rotation)]
    for (const mode of rotatedModes) {
      const runDirectory = join(directory, `${model.id}-${task}-${mode}-${repetition + 1}`)
      const report = await runPilot({ model, task, mode, directory: runDirectory, maxCalls, maxOutputTokens, observedTokenLimit,
        timeoutMs, maxAgents, perNodeSteps, calibration: values.calibrate, calibrationSamples })
      reports.push(report)
      console.log(JSON.stringify({ mode, model: model.id, task, passed: report.evaluation.passed, stop: report.stopReason,
        calls: report.issuedModelCalls, agents: report.totalAgents, manipulationValid: report.manipulation?.valid ?? null,
        tokens: report.metrics?.totals.tokens.totalTokens, path: join(runDirectory, 'report.json') }))
      await writeFile(join(directory, 'results.json'), JSON.stringify(reports, null, 2) + '\n')
      const summary = summarizeMeasurements(reports.map(row => ({ ...row,
        rewires: (row.protocol as { explicitRewires?: unknown[] } | null)?.explicitRewires?.length ?? 0 })))
      await writeFile(join(directory, 'summary.json'), JSON.stringify({ primaryMetrics: PRIMARY_METRICS, groups: summary }, null, 2) + '\n')
      if (report.cleanup !== 'released') throw new Error('Cleanup did not finish; batch stopped before further inference')
      if (report.requestFailures.some(failure => failure.status === 401 || failure.status === 403 || failure.status === 429)) {
        throw new Error('Provider rejected authentication, access or quota; stopping the batch without retries')
      }
    }
  }
  const versions = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  console.log(JSON.stringify({ completedRuns: reports.length, passed: reports.filter(report => report.evaluation.passed).length,
    pluginVersion: versions.version, conclusion: 'Pilot only; no statistical claim of topology or emergence advantage.', directory }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    let detail = error instanceof Error ? error.message : 'Unknown error'
    if (process.env.OPENCODE_API_KEY) detail = detail.replaceAll(process.env.OPENCODE_API_KEY, '[redacted]')
    detail = detail.replace(/oc_sk_[A-Za-z0-9_-]+/g, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    console.error(`Pilot stopped: ${codeOf(error)}: ${detail.slice(0, 1000)}`)
    process.exitCode = 1
  })
}
