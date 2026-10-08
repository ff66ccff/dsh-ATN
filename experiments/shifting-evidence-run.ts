/** Bounded live Harness pilot for changing distributed chain proofs. No provider call without --execute. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, type LlmAdapter } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorageBackend from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as OpenCodeGo from 'dsh-opencode-go'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import AtnRuntimePlugin from '../src/index.ts'
import * as AtnTools from '../src/tools.ts'
import { collaborationPeers } from '../src/topology.ts'
import { observeRequesterTask } from '../src/requester-feedback.ts'
import { atnDomainSpec } from '../src/domain.ts'
import type { NetworkRecord } from '../src/schema.ts'
import { createExperimentBudget, installExperimentOutputCap } from './budget.ts'
import { installTelemetry } from './telemetry.ts'
import { assertAllowedPilotModel, discoverPilotModels, type PilotModel } from './provider.ts'
import { createShiftingEvidenceTask, ShiftingEvidenceScenario, shiftingPrompt, evaluateCheckpoints } from './shifting-evidence-task.ts'
import { provisionShifting, runShiftingReference, shiftingConfig } from './shifting-evidence-reference.ts'
import { runBindingReferencePair } from './topology-binding-reference.ts'
import { auditFactFlow, referenceCostRatios } from './topology-binding-audit.ts'
import { installShiftingEvidenceAccess } from './shifting-evidence-access.ts'
import { proveTopologyBinding } from './topology-binding-proof.ts'
import type { installTopologyBindingAccess } from './topology-binding-access.ts'
import { summarizeAdaptiveProbe, summarizeShiftingRuns, shiftingStepHeadroom, type ShiftingRunObservation,
  type ShiftingProtocolObservation, assertTopologyComparisonPreflight, SHIFTING_ARMS } from './shifting-evidence-protocol.ts'
import { shiftingMechanisms } from './simplification-arms.ts'

export const SHIFTING_MODES = [...SHIFTING_ARMS, 'minimal'] as const
export type ShiftingMode = typeof SHIFTING_MODES[number]
export interface ShiftingOptions {
  model: PilotModel; mode: ShiftingMode; directory: string; agents: number; seed: number
  perNodeSteps: number; maxCalls: number; maxOutputTokens: number; timeoutMs: number; observedTokenLimit: number
  chainLength?: number; topologyBinding?: boolean; autoAdvance?: boolean; purpose?: 'comparison' | 'adaptive-probe'
}

/** Public routing provenance only; never pass profile settings or credential objects here. */
export interface ShiftingLiveProviderProvenance {
  provider: string; plugin: 'dsh-opencode-go'; profile: string; sourceProfile?: string
  modelImport: 'dsh-desktop-profile-llm'; mount: 'dsh-profile-import'
}
export interface ShiftingLiveProviderMount {
  liveProviderMount(ctx: Context): Promise<void>
  provenance: ShiftingLiveProviderProvenance
}

function publicProviderProvenance(testSeam: { adapter: LlmAdapter } | undefined, liveProvider: ShiftingLiveProviderMount | undefined) {
  if (testSeam && liveProvider) throw new Error('Scripted and live provider mounts are mutually exclusive')
  if (liveProvider) {
    const supplied = liveProvider.provenance
    if (typeof liveProvider.liveProviderMount !== 'function' || !supplied || supplied.provider !== OpenCodeGo.PROVIDER_ID ||
      supplied.plugin !== 'dsh-opencode-go' || supplied.mount !== 'dsh-profile-import' || supplied.modelImport !== 'dsh-desktop-profile-llm' ||
      typeof supplied.profile !== 'string' || supplied.profile.trim().length === 0 ||
      (supplied.sourceProfile !== undefined && (typeof supplied.sourceProfile !== 'string' || supplied.sourceProfile.trim().length === 0))) {
      throw new Error('Invalid public profile-import provider provenance')
    }
    // Do not spread a profile-derived object: credential/settings properties must never reach artifacts.
    return { provider: supplied.provider, plugin: supplied.plugin, profile: supplied.profile,
      ...(supplied.sourceProfile === undefined ? {} : { sourceProfile: supplied.sourceProfile }),
      modelImport: supplied.modelImport, mount: supplied.mount }
  }
  return { provider: OpenCodeGo.PROVIDER_ID, plugin: testSeam ? null : 'dsh-opencode-go', profile: null,
    modelImport: testSeam ? 'scripted-adapter' : 'live-gateway-catalog', mount: testSeam ? 'scripted-test' : 'standalone-harness' }
}

const sourceFiles = ['shifting-evidence-run.ts', 'shifting-evidence-task.ts', 'shifting-evidence-reference.ts',
  'shifting-evidence-profile-run.ts', 'simplification-arms.ts', 'simplification-protocol.ts', 'simplification-statistics.ts', 'simplification-reference.ts',
  'shifting-evidence-access.ts', 'shifting-evidence-protocol.ts', 'shifting-evidence-script.ts', 'shifting-evidence-calibration.ts',
  'topology-binding-proof.ts', 'topology-binding-access.ts',
  'topology-binding-audit.ts', 'topology-binding-reference.ts',
  'static-wide-topology.ts', 'comparison-statistics.ts',
  'reference-kernel.ts', 'provider.ts', 'budget.ts', 'telemetry.ts', 'atn-cost.ts',
  '../src/runtime.ts', '../src/schema.ts', '../src/config.ts', '../src/tools.ts', '../src/tasks.ts', '../src/messages.ts',
  '../src/knowledge.ts', '../src/requester-feedback.ts', '../src/topology.ts', '../src/topology-feedback.ts', '../src/information-boundary.ts', '../src/refusal.ts',
  '../package.json', '../package-lock.json']

export async function shiftingSourceHashes() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async file =>
    [file, createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex')])))
}

function validateOptions(options: ShiftingOptions) {
  assertAllowedPilotModel(options.model)
  if (!SHIFTING_MODES.includes(options.mode)) throw new Error('Unknown shifting-evidence arm')
  if (options.purpose === 'adaptive-probe' && options.mode !== 'adaptive') throw new Error('Adaptive probe requires the adaptive arm')
  createShiftingEvidenceTask(options.agents, options.seed, options.chainLength, options.topologyBinding)
  if (options.topologyBinding && options.model.id === 'longcat-2.5-preview-free') throw new Error('LongCat is capability-insufficient and excluded from topology-binding arms')
  if (options.topologyBinding && options.autoAdvance) throw new Error('Topology binding requires checkpoint-only phase advancement')
  if (options.autoAdvance !== undefined && typeof options.autoAdvance !== 'boolean') throw new Error('autoAdvance must be boolean')
  for (const [name, value, min, max] of [
    ['perNodeSteps', options.perNodeSteps, 12, 48], ['maxCalls', options.maxCalls, 64, 768],
    ['maxOutputTokens', options.maxOutputTokens, 1024, 4096], ['timeoutMs', options.timeoutMs, 30_000, 600_000],
    ['observedTokenLimit', options.observedTokenLimit, 10_000, 8_000_000],
  ] as const) if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid bounded ${name}`)
  if (options.maxCalls < options.agents * options.perNodeSteps) throw new Error('Global call cap must cover all per-node allocations')
}

export async function runShiftingEvidence(options: ShiftingOptions, testSeam?: { adapter: LlmAdapter }, liveProvider?: ShiftingLiveProviderMount) {
  const providerProvenance = publicProviderProvenance(testSeam, liveProvider)
  validateOptions(options)
  const hashes = await shiftingSourceHashes()
  const mechanisms = { ...shiftingMechanisms(options.mode), sharedBoard: false }
  // A fresh same-bound real-runtime reference is required before provider installation.
  const bindingReference = options.topologyBinding ? await runBindingReferencePair({ agents: options.agents, seed: options.seed,
    chainLength: options.chainLength ?? 4, topologyBinding: true, perNodeSteps: options.perNodeSteps,
    maxCalls: options.maxCalls, timeoutMs: options.timeoutMs }, hashes) : null
  const reference = options.topologyBinding && ['no-feedback', 'no-board', 'minimal'].includes(options.mode)
    ? await runShiftingReference({ agents: options.agents, seed: options.seed, chainLength: options.chainLength,
      topologyBinding: true, steps: options.perNodeSteps, maxCalls: options.maxCalls, timeoutMs: options.timeoutMs, topology: options.mode })
    : bindingReference ? bindingReference[options.mode === 'fixed' ? 'fixed' : options.mode === 'fixed-wide' ? 'fixed-wide' : 'adaptive']!
      : await runShiftingReference({ agents: options.agents, seed: options.seed, chainLength: options.chainLength,
        topologyBinding: options.topologyBinding, steps: options.perNodeSteps, maxCalls: options.maxCalls, timeoutMs: options.timeoutMs })
  if (options.topologyBinding && !['fixed', 'fixed-wide'].includes(options.mode) &&
    (!reference.passed || reference.obtainedRequiredFactCount !== reference.requiredFactCount || reference.issuedModelCalls !== 0)) {
    throw new Error('Mechanism ablation reference failed before live provider installation')
  }
  const task = createShiftingEvidenceTask(options.agents, options.seed, options.chainLength, options.topologyBinding)
  const scenario = new ShiftingEvidenceScenario(task)
  const directory = resolve(options.directory)
  await mkdir(dirname(directory), { recursive: true })
  await mkdir(directory)
  const runId = randomUUID(), startedAt = Date.now()
  const ctx = new Context(); ctx.baseUrl = import.meta.url
  let ended = false, stopReason = 'quiescent', entry: Agent | undefined
  let network: Awaited<ReturnType<typeof provisionShifting>> | undefined
  let telemetry: Awaited<ReturnType<typeof installTelemetry>> | undefined
  let phaseRequested: string | undefined
  let ready!: () => void
  const provisioned = new Promise<void>(done => { ready = done })
  const budget = createExperimentBudget({ provider: OpenCodeGo.PROVIDER_ID, model: options.model.id,
    maxCalls: options.maxCalls, maxOutputTokens: options.maxOutputTokens, observedTokenLimit: options.observedTokenLimit })
  const attempts: Array<{ phase: number; at: number; answer: string }> = []
  const hostControlInputs = { messages: 0, bytes: 0 }
  const failures: Array<{ code: string; status: number | null }> = []
  let protocol: ShiftingProtocolObservation | null = null, cleanup = 'released'
  let measuredRecord: NetworkRecord | null = null
  let binding: ReturnType<typeof installTopologyBindingAccess> | null = null
  let rewireHistory: NonNullable<NetworkRecord['rewireHistory']> = []
  const queriedStatus = new Set<string>()
  let priorStatusQueryCalls = 0
  const rewireAttempts: Array<{ callId: string; sessionId: string; phase: number; withPriorStatusQuery: boolean;
    outcome: 'pending' | 'blocked' | 'committed'; ablationBlocked: boolean; rewireId: string | null }> = []
  const pendingRewires = new Map<symbol, typeof rewireAttempts[number]>()
  const statusArguments = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  const rewireTelemetry = () => {
    const attempts = rewireAttempts.map(attempt => {
      const committed = rewireHistory.find(row => row.id === attempt.rewireId)
      const changed = committed ? committed.previousPeers.slice().sort().join() !== committed.nextPeers.slice().sort().join() : false
      return { ...attempt, changed, durableCommitObserved: !!committed }
    })
    return { statusRewireCalls: attempts.length,
      successfulRewires: attempts.filter(row => row.outcome === 'committed' && row.durableCommitObserved && row.changed).length,
      unchangedRewires: attempts.filter(row => row.outcome === 'committed' && row.durableCommitObserved && !row.changed).length,
      blockedRewires: attempts.filter(row => row.outcome === 'blocked').length,
      ablationBlockedRewires: attempts.filter(row => row.outcome === 'blocked' && row.ablationBlocked).length,
      pendingRewires: attempts.filter(row => row.outcome === 'pending' || (row.outcome === 'committed' && !row.durableCommitObserved)).length,
      priorStatusQueryCalls, callsWithPriorStatusQuery: attempts.filter(row => row.withPriorStatusQuery).length, attempts }
  }
  const obligations = (record: NetworkRecord) => ({ status: record.status,
    openTasks: Object.values(record.tasks).filter(row => row.status === 'open').length,
    queuedMail: Object.values(record.mails).filter(row => row.status === 'queued').length })
  const checkpointObligations: Array<{ phase: number; status: string; openTasks: number; queuedMail: number }> = []
  const cancel = (reason: string) => {
    ended = true; stopReason = reason
    for (const agent of ctx.get('agents')?.list() ?? []) agent.cancel({ kind: 'hook', reason })
  }
  const advance = (reason: string) => {
    if (scenario.phase !== 1 || ended) return
    scenario.advance(reason); phaseRequested = undefined
    for (const agent of ctx.agents.list()) {
      const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
        task.topologyBinding
          ? 'Host update: PHASE 2 is active. Current phase=2/version=2; owners and next pointers changed. Each node reads its own mine snapshot once and advertises metadata. Entry rebuilds from key-00 using ONE outstanding fact request at a time: first request and review the older root copy, then request, cache and review the current root, then follow its next pointer by direct owner lookup. Never wait on an already returned task: inspect its actual taskId once after a response if needed. Submit phase 2 after the complete chain. Helpers answer only their own facts and do not repeat the phase-1 setup receipt. Forwarding is host-refused; board is metadata-only. With no fact task, end the turn and wait. Phase 1 correctness is not disclosed.'
          : 'Host update: PHASE 2 is active. Current facts have changed owners and next pointers; phase-1 witnesses are stale. The entry rebuilds the chain from key-00, cross-checks the root through two holder task/result replies, reviews each when enabled, and submits the checkpoint; only the entry may submit phase=2. Helpers call read_evidence("mine"), publish local facts once under phase-2 keys when the board is enabled, then respond to or relay actual tasks. Return exact local copies even if obsolete; relays preserve target, requested phase/version, key and evidence. Retrieve an explicitly assigned bounded fragment only; with no assigned work, end the current turn and wait for mail. No unsolicited full-chain search, idle polling, broadcasts or unchanged board rewrites. No correctness feedback on phase 1 is available.' }] })
      hostControlInputs.messages++; hostControlInputs.bytes += Buffer.byteLength(JSON.stringify(message), 'utf8')
      if (agent.status === 'running') agent.steer(message)
      else agent.followup(message)
    }
  }
  try {
    await ctx.plugin(LlmRuntime); await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(AgentRegistry)
    ctx.on('tools/pre-execute', (execution, next) => {
      if (execution.name === 'atn_status' && execution.agent && statusArguments(execution.arguments).rewire !== undefined) {
        const attempt: typeof rewireAttempts[number] = { callId: String(execution.callId), sessionId: String(execution.agent.id),
          phase: scenario.phase, withPriorStatusQuery: queriedStatus.has(String(execution.agent.id)),
          outcome: 'pending', ablationBlocked: false, rewireId: null }
        rewireAttempts.push(attempt); pendingRewires.set(execution.token, attempt)
      }
      return next()
    }, { global: true, prepend: true })
    ctx.on('tools/result', (execution, result) => {
      if (execution.name !== 'atn_status' || !execution.agent) return undefined
      const args = statusArguments(execution.arguments)
      if (args.claimTaskId === undefined && args.review === undefined && args.rewire === undefined && !result.isError) {
        queriedStatus.add(String(execution.agent.id)); priorStatusQueryCalls++
      }
      const attempt = pendingRewires.get(execution.token)
      if (attempt) {
        pendingRewires.delete(execution.token)
        if (result.isError) {
          attempt.outcome = 'blocked'
          attempt.ablationBlocked = /disabled.*ablation/i.test(result.error.message)
        } else {
          const rewire = statusArguments(statusArguments(result.value).rewire)
          attempt.outcome = 'committed'; attempt.rewireId = typeof rewire.rewireId === 'string' ? rewire.rewireId : null
        }
      }
      return undefined
    }, { global: true })
    await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
    if (testSeam) ctx.llm.registerAdapter([OpenCodeGo.PROVIDER_ID], testSeam.adapter)
    else if (liveProvider) await liveProvider.liveProviderMount(ctx)
    else await ctx.plugin(OpenCodeGo, { apiKeyEnv: 'OPENCODE_API_KEY', usageDisplay: 'off', streamIdleTimeoutMs: Math.min(options.timeoutMs, 60_000),
      modelLimits: { [options.model.id]: { maxTokens: options.maxOutputTokens } } })
    telemetry = await installTelemetry(ctx, { directory, runId, prices: {
      id: 'live-catalog-reference-not-subscription-bill', currency: 'USD', reasoningIncludedInOutput: true,
      routes: [{ provider: OpenCodeGo.PROVIDER_ID, model: options.model.id,
        inputPerMillion: options.model.referenceCostPerMillion.input, outputPerMillion: options.model.referenceCostPerMillion.output,
        cacheReadPerMillion: options.model.referenceCostPerMillion.cacheRead, cacheWritePerMillion: options.model.referenceCostPerMillion.cacheWrite }],
    } })
    installExperimentOutputCap(ctx, options.maxOutputTokens)
    ctx.on('agent/pre-step', async (payload, next) => {
      await provisioned
      if (scenario.phase === 1 && network) {
        const record = await ctx.atn.network(network.networkId)
        const caller = Object.values(record.nodes).find(node => node.sessionId === payload.agent.id)
        if (phaseRequested) advance(phaseRequested)
        else if (options.autoAdvance && (caller?.stepsUsed ?? 0) >= Math.floor(options.perNodeSteps / 2)) advance('half-node-budget')
      }
      return next()
    }, { global: true, prepend: true })
    ctx.on('llm/stream', (request, next) => (async function* () {
      await provisioned
      const usage = telemetry!.snapshot().totals.tokens.totalTokens
      const admission = budget.admit(request, { ended, knownTotalTokens: usage.known, unknownUsageCalls: usage.unknownCalls })
      if (!admission.allowed) { if (admission.reason !== 'ended') cancel(admission.reason); throw new Error(`shifting-${admission.reason}`) }
      if (options.autoAdvance && scenario.phase === 1 && admission.issued >= Math.floor(options.maxCalls / 2)) phaseRequested ??= 'half-call-budget'
      for await (const chunk of next()) {
        if (chunk.type === 'finish' && chunk.reason.kind === 'error') failures.push({ code: chunk.reason.failure.code,
          status: chunk.reason.failure.status ?? null })
        yield chunk
      }
    })(), { global: true, prepend: true })
    ctx.on('agent/created', ({ agent }) => { scenario.register(agent.id); return undefined })
    ctx.systemPrompt.section({ name: 'shifting-experiment', order: 10, text: [
      shiftingPrompt(task, options), `Each node has ${options.perNodeSteps} steps across BOTH phases. Global bounds: ${options.maxCalls} calls, ${options.maxOutputTokens} output tokens/call.`,
      options.mode === 'fixed' || options.mode === 'fixed-wide' ? `Ablation: atn_status.rewire is disabled; use the fixed ${options.mode === 'fixed-wide' ? 'four-peer public-roster topology' : 'ring'} and host custody discovery.` : '',
      !mechanisms.requesterFeedback ? 'Ablation: atn_status.review is disabled; collect evidence without requester ratings.' : '',
      'ATN 0.5.0 has no shared board; use actual directed task/result mail and host custody discovery.',
    ].filter(Boolean).join('\n') })
    const output = { schema: { type: 'json' } as const, render: (_: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }
    ctx.tools.register(defineTool({ name: 'read_evidence', description: 'Read your local evidence snapshots, including any stale copies. mine returns all local snapshots; inspect phase/version/key/required fields. Another key/document requires local ownership.',
      parameters: { id: { type: 'string', required: true, description: 'mine, or a local document id/key.' } }, output,
      async execute(args, execution) {
        if (!execution.agent) throw new Error('Agent required')
        const result = scenario.read(execution.agent.id, args.id)
        if (network) await ctx.atn.refreshCustody(network.networkId)
        return result as unknown as JsonValue
      },
    }))
    ctx.tools.register(defineTool({ name: 'submit_checkpoint', description: 'Entry: record one proof for the current phase. Returns receipt only, never correctness; phase-1 receipt advances the task.',
      parameters: { phase: { type: 'number', required: true, description: '1 or 2, matching the current phase.' },
        answer: { type: 'string', required: true, description: 'Exactly the required chain proof JSON encoded as a string.' } }, output,
      async execute(args, execution) {
        if (execution.agent !== entry || (args.phase !== 1 && args.phase !== 2)) throw new Error('Only entry may submit a current phase checkpoint')
        scenario.submit(args.phase, args.answer); attempts.push({ phase: args.phase, at: Date.now(), answer: args.answer })
        checkpointObligations.push({ phase: args.phase, ...obligations(await ctx.atn.network(network!.networkId)) })
        if (args.phase === 1) phaseRequested = 'phase-1-checkpoint'
        else { ended = true; stopReason = 'phase-2-submitted' }
        return { recorded: true, correctnessFeedback: false }
      },
    }))
    await ctx.plugin(Storage); await ctx.plugin(JsonStorageBackend, { root: join(directory, 'storage') }); await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(AtnRuntimePlugin, shiftingConfig(options.agents, options.perNodeSteps, options.timeoutMs, options.mode === 'fixed-wide' ? 4 : 2)); await ctx.plugin(AtnTools)
    const handle = await ctx.agents.create({ sessionId: SessionId(`shifting-${runId}`),
      agentOptions: { provider: OpenCodeGo.PROVIDER_ID, model: options.model.id, maxTokens: options.maxOutputTokens }, meta: { cwd: directory } })
    entry = handle.agent
    network = await provisionShifting(ctx, entry, scenario, options)
    const fixedPeers = options.mode === 'fixed' || options.mode === 'fixed-wide' ? network.initialPeerIds : undefined
    binding = installShiftingEvidenceAccess(ctx.atn, network.networkId, sessionId => scenario.knowledgeHints(sessionId), scenario, fixedPeers)
    if (fixedPeers) ctx.atn.rewire = async () => { throw new Error('Rewiring disabled by fixed-topology ablation') }
    if (!mechanisms.requesterFeedback) ctx.atn.feedback = async () => { throw new Error('Requester ratings disabled by no-feedback ablation') }
    ctx.atn.deliver = async () => { throw new Error('This two-phase experiment records proof with submit_checkpoint; keep the network open for host-managed measurement and cleanup') }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ runId, experiment: task.id, protocolRevision: task.topologyBinding ? 8 : 4, mode: options.mode,
      purpose: options.purpose ?? 'comparison',
      execution: testSeam ? 'scripted-test' : 'live-provider', providerProvenance,
      taskHash: createHash('sha256').update(JSON.stringify(task)).digest('hex'), seed: options.seed, model: options.model,
      topologyProof: task.topologyBinding ? proveTopologyBinding(task) : null,
      staticTopologyProof: fixedPeers && task.topologyBinding ? proveTopologyBinding(task, { entrySlot: 0,
        maxCollaborationPeers: options.mode === 'fixed-wide' ? 4 : 2,
        initialPeers: fixedPeers[network.nodeId].map(id => network!.ids.indexOf(id)) }) : null,
      limits: { agents: options.agents, degree: options.mode === 'fixed-wide' ? 4 : 2, steps: options.perNodeSteps, calls: options.maxCalls,
        chainLength: task.chainLength, autoAdvance: options.autoAdvance ?? false,
        outputTokens: options.maxOutputTokens, timeoutMs: options.timeoutMs, observedTokenLimit: options.observedTokenLimit },
      reference, bindingReference, sourceHashes: hashes, initialTopology: network.topology,
      initialPeerIds: network.initialPeerIds, staticSelection: network.staticSelection,
      fixedContext: AtnTools.measureAtnFixedContext(ctx.tools.schemas()),
      phaseTrigger: options.autoAdvance ? 'checkpoint or automatic half-budget/quiescence advance' : 'phase-1 checkpoint only',
      evidenceAccess: 'host-enforced local snapshot holder ACL, including stable stale copies; no fixture file tool access',
      discoveryAccess: 'canonical current local metadata only; no task/result prose or content search; task reads restricted to holder/requester; no orphan claims or early retirement',
      transportAccess: task.topologyBinding ? 'JSON phase/key requests and exact local-owner results only; no notes, relays or board facts; ACL runs inside mail/task mutation' : 'legacy ring relays and metered board evidence',
      primaryMetrics: ['issuedModelCalls conditional on phase1Correct && phase2Correct'],
      secondaryMetrics: ['atnTotalInteractions', 'atnTotalTransferBytes', 'entrySteps', 'two-phase completion with Wilson interval and paired power statement'],
      experimentClass: 'bounded efficacy smoke, not calibrated effect-size measurement', causalClaim: false,
    }, null, 2) + '\n')
    ready()
    const kickoff = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text:
      `You are the entry ${network.nodeId}; only you submit checkpoints. Network provisioned. Begin phase 1. Discover the current chain from ${task.rootKey}; coordinate concise evidence and preserve steps for phase 2.` }] })
    hostControlInputs.messages++; hostControlInputs.bytes += Buffer.byteLength(JSON.stringify(kickoff), 'utf8')
    if (entry.status === 'running') entry.steer(kickoff)
    else entry.followup(kickoff)
    let quietSince: number | null = null
    while (!ended) {
      if (Date.now() - startedAt >= options.timeoutMs) { cancel('timeout'); break }
      if (phaseRequested) advance(phaseRequested)
      const running = ctx.agents.list().some(agent => agent.status === 'running')
      if (!running) {
        await ctx.atn.tick()
        // A scheduler pass can wake queued work. Measure quiescence only
        // after that pass, so slow storage cannot turn active work into idle.
        if (ctx.agents.list().some(agent => agent.status === 'running')) {
          quietSince = null
          continue
        }
        if (quietSince === null) quietSince = Date.now()
        if (Date.now() - quietSince >= 200) {
          if (scenario.phase === 1 && options.autoAdvance) { advance('phase-1-quiescence'); quietSince = null }
          else if (scenario.phase === 1) { stopReason = 'phase-1-quiescence'; break }
          else { stopReason = 'phase-2-quiescence'; break }
        }
      } else quietSince = null
      await new Promise(done => setTimeout(done, 25))
    }
    ended = true
    for (const agent of ctx.agents.list()) agent.cancel({ kind: 'hook', reason: 'checkpoint measurement stopped' })
    let drainTimer: ReturnType<typeof setTimeout> | undefined
    try { await Promise.race([Promise.all(ctx.agents.list().map(agent => agent.whenIdle())),
      new Promise<void>(done => { drainTimer = setTimeout(done, 5_000) })]) }
    finally { if (drainTimer) clearTimeout(drainTimer) }
    const record = await ctx.atn.network(network.networkId)
    measuredRecord = record
    rewireHistory = record.rewireHistory ?? []
    const observations = Object.values(record.tasks).map(row => observeRequesterTask(row, row.id))
    protocol = { ...obligations(record), nodes: Object.keys(record.nodes).length,
      maxObservedFinalDegree: Math.max(...Object.values(record.nodes).map(node => collaborationPeers(record.nodes, node.id, record.limits.maxCollaborationPeers).length)),
      knowledgePublications: Object.values(record.nodes).filter(node => node.knowledgeFingerprint?.source === 'host-custody').length,
      requesterFeedback: { accepted: observations.filter(row => row.status === 'accepted').length,
        rejected: observations.filter(row => row.status === 'rejected').length, needsMore: observations.filter(row => row.status === 'needs-more').length },
      rewireTelemetry: rewireTelemetry(),
      explicitRewires: (record.rewireHistory ?? []).map(row => ({ id: row.id,
        changed: row.previousPeers.slice().sort().join() !== row.nextPeers.slice().sort().join(),
        hostVerdict: row.evaluation.verdict, requesterVerdict: row.requesterEvaluation?.verdict ?? 'insufficient-evidence', causalClaim: false })),
      stepUse: Object.values(record.nodes).map(row => ({ id: row.id, stepsUsed: row.stepsUsed ?? 0, lifecycle: row.lifecycle })),
    }
  } catch (error) {
    stopReason = `host-error:${error instanceof Error ? error.name : 'unknown'}`
    // Log only safe error names in the shareable report; local diagnostic stack stays on stderr.
    console.error(error instanceof Error ? error.message : String(error))
  } finally {
    ended = true; ready()
    for (const agent of ctx.get('agents')?.list() ?? []) agent.cancel({ kind: 'hook', reason: 'shifting experiment cleanup' })
    let timer: ReturnType<typeof setTimeout> | undefined
    try { cleanup = await Promise.race([ctx.fiber.dispose().then(() => 'released', () => 'failed'),
      new Promise<string>(done => { timer = setTimeout(() => done('timed-out'), 15_000) })]) }
    finally { if (timer) clearTimeout(timer) }
  }
  const metrics = telemetry ? await telemetry.close() : null
  let protocolAfterCleanup: ReturnType<typeof obligations> | null = null
  if (network && cleanup === 'released') {
    const audit = new Context(); audit.baseUrl = import.meta.url
    try {
      await audit.plugin(Storage); await audit.plugin(JsonStorageBackend, { root: join(directory, 'storage') })
      await audit.plugin(StorageDomain, { backend: 'json' })
      const domain = await audit.storageDomain.open(atnDomainSpec(shiftingConfig(options.agents, options.perNodeSteps, options.timeoutMs).domainName))
      const record = domain.table('networks').get(network.networkId)
      if (record) protocolAfterCleanup = obligations(record)
    } finally { await audit.fiber.dispose() }
  }
  const evaluation = evaluateCheckpoints(task, scenario.submissions)
  protocol ??= { requesterFeedback: { accepted: 0, rejected: 0, needsMore: 0 }, rewireTelemetry: rewireTelemetry(), stepUse: [] }
  protocol.rewireTelemetry = rewireTelemetry()
  protocol.stepHeadroom = shiftingStepHeadroom({ conditions: { seed: options.seed, perNodeSteps: options.perNodeSteps }, protocol })
  const factFlowAudit = task.topologyBinding && measuredRecord ? auditFactFlow(task, measuredRecord, attempts, network?.initialPeerIds[network.nodeId]) : null
  const entrySteps = measuredRecord?.nodes[measuredRecord.entryNodeId]?.stepsUsed ?? null
  const costRelativeToReference = referenceCostRatios({ issuedModelCalls: budget.snapshot().issued,
    atnTotalInteractions: metrics?.atnTotalInteractions ?? 0, atnTotalTransferBytes: metrics?.atnTotalTransferBytes ?? 0, entrySteps }, reference)
  const report = { runId, mode: options.mode, purpose: options.purpose ?? 'comparison', model: options.model.id, seed: options.seed,
    startedAt, completedAt: Date.now(), stopReason, cleanup,
    execution: testSeam ? 'scripted-test' : 'live-provider', providerProvenance,
    elapsedMs: Date.now() - startedAt, issuedModelCalls: budget.snapshot().issued, budget: budget.snapshot(),
    ...evaluation, manipulation: scenario.snapshot(), protocol,
    conditions: { agents: options.agents, seed: options.seed, chainLength: task.chainLength,
      ...(task.topologyBinding ? { topologyBinding: true } : {}),
      perNodeSteps: options.perNodeSteps, maxCalls: options.maxCalls, maxOutputTokens: options.maxOutputTokens,
      timeoutMs: options.timeoutMs, observedTokenLimit: options.observedTokenLimit, autoAdvance: options.autoAdvance ?? false },
    sourceHashes: hashes,
    topologyProof: task.topologyBinding ? proveTopologyBinding(task) : null,
    staticTopologyProof: task.topologyBinding && network && ['fixed', 'fixed-wide'].includes(options.mode) ? proveTopologyBinding(task, { entrySlot: 0,
      maxCollaborationPeers: options.mode === 'fixed-wide' ? 4 : 2,
      initialPeers: network.initialPeerIds[network.nodeId].map(id => network!.ids.indexOf(id)) }) : null,
    topologyBinding: binding?.snapshot() ?? null,
    bindingReference, factFlowAudit, comparisonEligible: !task.topologyBinding || factFlowAudit?.passed === true,
    initialPeerIds: network?.initialPeerIds ?? null, staticSelection: network?.staticSelection ?? null,
    entrySteps, costRelativeToReference, mechanisms,
    checkpointObligations, protocolAfterCleanup,
    checkpointMeaning: 'Correct proof submission is measured separately from unresolved ATN obligations and network closure.',
    metrics, atnMessages: metrics?.atnMessages ?? 0, atnPayloadBytes: metrics?.atnPayloadBytes ?? 0,
    hostControlInputs,
    communicationBoundary: 'ATN totals include durable mail and board operations. Host kickoff/phase notices are separate below. Shared prompts and tool outputs are captured by model token usage, not byte totals. Relative metrics compare ATN communication only, not all model context.',
    interactionsIncludingHostControl: (metrics?.atnTotalInteractions ?? 0) + hostControlInputs.messages,
    transferBytesIncludingHostControl: (metrics?.atnTotalTransferBytes ?? 0) + hostControlInputs.bytes,
    atnBoard: metrics?.atnBoard ?? null, atnTotalInteractions: metrics?.atnTotalInteractions ?? 0,
    atnTotalTransferBytes: metrics?.atnTotalTransferBytes ?? 0, reference,
    fixedContextBytes: metrics?.fixedContextBytes ?? null, meanInputTokensPerCall: metrics?.meanInputTokensPerCall ?? null,
    relativeInteractions: metrics ? metrics.atnTotalInteractions / reference.totalInteractions : null,
    relativeTransferBytes: metrics ? metrics.atnTotalTransferBytes / reference.totalTransferBytes : null,
    attempts, failures, causalClaim: false,
    interpretation: testSeam ? 'Deterministic scripted adapter through real runtime, not evidence of real-model solving ability or topology benefit.' : 'Five arms run directly with matched source/model/budget/fixture and paired seeds. Completion uses Wilson intervals and exact paired power; efficiency includes two-phase completions only, failed consumption remains separate. Zero adaptive completions means no comparable signal. Fixed and fixed-wide structural failure is task design. Rejected reviews, rewiring and headroom are diagnostics, not admission gates. Causal claims remain false.',
  }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}

async function main() {
  const { values } = parseArgs({ options: {
    execute: { type: 'boolean', default: false }, models: { type: 'string', default: 'space-bunny-free,longcat-2.5-preview-free,deepseek-v4.1-flash' },
    probe: { type: 'boolean', default: false }, 'probe-report': { type: 'string' },
    'free-only': { type: 'boolean', default: false },
    modes: { type: 'string' }, agents: { type: 'string', default: '8' }, seed: { type: 'string', default: '17' },
    'chain-length': { type: 'string', default: '4' }, 'auto-advance': { type: 'boolean', default: false }, repeats: { type: 'string', default: '5' },
    'topology-binding': { type: 'boolean', default: false },
    steps: { type: 'string', default: '16' }, 'max-calls': { type: 'string', default: '128' },
    'max-output-tokens': { type: 'string', default: '2048' }, 'timeout-ms': { type: 'string', default: '240000' },
    'observed-token-limit': { type: 'string', default: '400000' }, out: { type: 'string', default: '.artifacts/experiments/shifting-evidence' },
  } })
  const common = { agents: Number(values.agents), seed: Number(values.seed), chainLength: Number(values['chain-length']), autoAdvance: values['auto-advance'], perNodeSteps: Number(values.steps),
    ...(values['topology-binding'] ? { topologyBinding: true } : {}),
    maxCalls: Number(values['max-calls']), maxOutputTokens: Number(values['max-output-tokens']),
    timeoutMs: Number(values['timeout-ms']), observedTokenLimit: Number(values['observed-token-limit']) }
  const modes = (values.modes ?? (values.probe ? 'adaptive' : SHIFTING_ARMS.join(','))).split(',') as ShiftingMode[]
  if (modes.some(mode => !SHIFTING_MODES.includes(mode))) throw new Error('Unknown mode')
  if (values.probe && (modes.length !== 1 || modes[0] !== 'adaptive')) throw new Error('--probe runs only the adaptive arm')
  const modelIds = values.models.split(',')
  const repeats = Number(values.repeats)
  if (!Number.isSafeInteger(repeats) || repeats < 5) throw new Error('Every experiment arm requires at least five repeats')
  if (new Set(modes).size !== modes.length || new Set(modelIds).size !== modelIds.length) throw new Error('Duplicate model/mode would overwrite evidence')
  const root = resolve(values.out)
  let probeRuns: ShiftingRunObservation[] = []
  if (values['probe-report']) {
    const artifact = JSON.parse(await readFile(resolve(values['probe-report']), 'utf8'))
    probeRuns = Array.isArray(artifact) ? artifact : artifact.completed ?? artifact.runs ?? []
    if (!Array.isArray(probeRuns)) throw new Error('Invalid --probe-report: expected a dedicated probe batch with completed runs')
  }
  const requiresProbe = modes.length > 1 || values['topology-binding'] && !values.probe
  await mkdir(dirname(root), { recursive: true })
  await mkdir(root, { recursive: !values.execute })
  const reference = await runShiftingReference({ agents: common.agents, seed: common.seed, steps: common.perNodeSteps,
    chainLength: common.chainLength, topologyBinding: values['topology-binding'], maxCalls: common.maxCalls, timeoutMs: common.timeoutMs })
  await writeFile(join(root, 'reference.json'), JSON.stringify(reference, null, 2) + '\n')
  if (!values.execute) { console.log(JSON.stringify({ execute: false, reference, plannedModes: modes,
    purpose: values.probe ? 'adaptive-probe' : 'comparison', repeats, limits: common }, null, 2)); return }
  const catalog = await discoverPilotModels()
  const selected = modelIds.map(id => { const model = catalog.models.find(row => row.id === id); if (!model) throw new Error(`Requested live model unavailable: ${id}`); return model })
  if (values['free-only'] && selected.some(model => !model.catalogFree || Object.values(model.referenceCostPerMillion).some(rate => rate !== 0))) {
    throw new Error('free-only execution requires every selected live model to be catalog-free with all reference tariffs equal to zero')
  }
  if (requiresProbe) {
    const sourceHashes = await shiftingSourceHashes()
    for (const model of selected) assertTopologyComparisonPreflight(probeRuns.filter(run => run.model === model.id),
      { model: model.id, conditions: common, sourceHashes }, Array.from({ length: repeats }, (_, i) => common.seed + i * 14))
  }
  await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
  const reports: Array<Awaited<ReturnType<typeof runShiftingEvidence>> & { directory: string }> = []
  for (const [index, model] of selected.entries()) for (let repeat = 0; repeat < repeats; repeat++) for (const mode of [...modes.slice(index % modes.length), ...modes.slice(0, index % modes.length)]) {
    const seed = common.seed + repeat * 14
    const directory = join(root, `${model.id}-${mode}-seed-${seed}`)
    const report = await runShiftingEvidence({ ...common, seed, model, mode, directory,
      purpose: values.probe ? 'adaptive-probe' : 'comparison' })
    reports.push({ ...report, directory })
    await writeFile(join(root, 'batch.json'), JSON.stringify({ purpose: values.probe ? 'adaptive-probe' : 'comparison',
      completed: reports, planned: selected.length * modes.length * repeats,
      summaries: selected.map(candidate => ({ model: candidate.id, ...(values.probe
        ? summarizeAdaptiveProbe(reports.filter(row => row.model === candidate.id))
        : summarizeShiftingRuns(reports.filter(row => row.model === candidate.id), probeRuns.filter(row => row.model === candidate.id))) })),
      causalClaim: false }, null, 2) + '\n')
    console.log(JSON.stringify({ model: model.id, mode, seed, passed: report.passed, directory }))
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
