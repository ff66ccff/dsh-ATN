/** Content-free, experiment-side accounting over Harness public events. */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import type { NetworkRecord } from '../src/schema.ts'
import { collaborationPeers, collaborationPeerLimit } from '../src/topology.ts'
import { taskResultDigest } from '../src/tasks.ts'
import { observeRequesterTask } from '../src/requester-feedback.ts'
import type {} from '../src/observer.ts'
import type {} from '@deepseek-ai/dsh-experimental-agent-team'
import { createAtnCostMeter } from './atn-cost.ts'
import { measureAtnFixedContext } from '../src/tools.ts'

export interface RoutePrice {
  provider: string
  model: string
  inputPerMillion: number
  outputPerMillion: number
  cacheReadPerMillion: number
  cacheWritePerMillion: number
}

/** Explicit caller-supplied tariff. Reasoning is a subset of output, never added twice. */
export interface PriceTable {
  id: string
  currency: string
  reasoningIncludedInOutput: true
  routes: RoutePrice[]
}

export interface TelemetryOptions {
  directory: string
  runId: string
  prices?: PriceTable
  /** Defaults to all calls in this Context, including calls without a Session. Use an isolated benchmark Context. */
  includeSession?: (sessionId: string | undefined) => boolean
  now?: () => number
}

const TOKEN_KEYS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'] as const
type TokenKey = typeof TOKEN_KEYS[number]
export type ObservedUsage = Record<TokenKey, number | null>
export interface TokenTotal { known: number; unknownCalls: number }
export interface TelemetryTotals {
  attempts: number
  settledAttempts: number
  inFlight: number
  errors: number
  aborted: number
  incomplete: number
  modelDurationMs: number
  toolsStarted: number
  toolsFinished: number
  toolErrors: number
  toolDurationMs: number
  tokens: Record<TokenKey, TokenTotal>
  cost: { amount: number | null; knownAmount: number; unknownCalls: number; currency: string | null }
}
export interface TelemetrySnapshot {
  version: 1
  runId: string
  startedAt: number
  observedAt: number
  elapsedMs: number
  events: number
  /** Unique committed ATN mails, including ones pruned after observation. */
  atnMessages: number
  /** UTF-8 bytes of mail envelopes, bodies and structured task results. */
  atnPayloadBytes: number
  /** Largest cumulative delivered payload for any single network/node pair. */
  atnMaxContextBytes: number
  /** Shared-medium operations are network-wide; no payload text is exported. */
  atnBoard: { reads: number; writes: number; readBytes: number; writeBytes: number }
  /** Mail plus board operations, so publication cannot masquerade as free communication. */
  atnTotalInteractions: number
  atnTotalTransferBytes: number
  /** Null when there were no ATN-bearing model calls. */
  fixedContextBytes: number | null
  /** Null if any settled invocation lacks input usage; never impute zero. */
  meanInputTokensPerCall: number | null
  knownMeanInputTokensPerCall: number | null
  inputTokenUnknownCalls: number
  callCosts: Array<{ call: string; session: string; systemPromptBytes: number; toolSchemaBytes: number;
    fixedContextBytes: number; inputTokens: number | null }>
  totals: TelemetryTotals
  sessions: Record<string, TelemetryTotals>
  coverage: {
    modelCalls: 'llm/stream invocations, including observable retries and auxiliary calls'
    hiddenHttpRetries: 'unknown'
    directExternalCalls: 'not-observed'
    usageSource: 'last adapter usage chunk per invocation; absent fields remain unknown'
    tokenUnits: 'input excludes cache; reasoning is contained in output; total is not added to buckets'
    costMeaning: 'reference tariff estimate, not actual billing or subscription consumption'
    content: 'no prompts, completions, tool arguments/results, error text, or raw identifiers'
    priceTableId: string | null
    writeFailed: boolean
    observationErrors: number
    closedWithInFlight: boolean
  }
}
export interface ExperimentTelemetry {
  paths: { events: string; summary: string }
  snapshot(): TelemetrySnapshot
  flush(): Promise<void>
  close(): Promise<TelemetrySnapshot>
}

function totals(currency: string | null): TelemetryTotals {
  return {
    attempts: 0, settledAttempts: 0, inFlight: 0, errors: 0, aborted: 0, incomplete: 0,
    modelDurationMs: 0, toolsStarted: 0, toolsFinished: 0, toolErrors: 0, toolDurationMs: 0,
    tokens: Object.fromEntries(TOKEN_KEYS.map(key => [key, { known: 0, unknownCalls: 0 }])) as TelemetryTotals['tokens'],
    cost: { amount: 0, knownAmount: 0, unknownCalls: 0, currency },
  }
}

/** Strip everything except valid numeric accounting, including provider extension fields. */
export function normalizeUsage(usage: TokenUsage | undefined): ObservedUsage {
  const result = Object.fromEntries(TOKEN_KEYS.map(key => {
    const value = usage?.[key]
    return [key, typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null]
  })) as ObservedUsage
  // Contradictory accounting is not usable for pricing. Preserve no misleading totals.
  const knownParts = [result.inputTokens, result.outputTokens, result.cacheReadTokens, result.cacheWriteTokens]
  if ((result.reasoningTokens !== null && result.outputTokens !== null && result.reasoningTokens > result.outputTokens)
    || (result.totalTokens !== null && (knownParts.reduce<number>((sum, value) => sum + (value ?? 0), 0) > result.totalTokens
      || (knownParts.every(value => value !== null) && knownParts.reduce<number>((sum, value) => sum + value!, 0) !== result.totalTokens)))) {
    return Object.fromEntries(TOKEN_KEYS.map(key => [key, null])) as ObservedUsage
  }
  return result
}

function validatePrices(prices: PriceTable | undefined): void {
  if (!prices) return
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(prices.id) || !/^[A-Z]{3}$/.test(prices.currency) || prices.reasoningIncludedInOutput !== true) {
    throw new TypeError('Price table needs a public id, ISO currency, and explicit reasoningIncludedInOutput=true')
  }
  const seen = new Set<string>()
  for (const row of prices.routes) {
    const key = JSON.stringify([row.provider, row.model])
    if (seen.has(key)) throw new TypeError('Duplicate price table route')
    seen.add(key)
    for (const rate of [row.inputPerMillion, row.outputPerMillion, row.cacheReadPerMillion, row.cacheWritePerMillion]) {
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) throw new TypeError('Price rates must be explicit finite nonnegative numbers')
    }
  }
}

function price(usage: ObservedUsage, tariff: RoutePrice | undefined): number | null {
  if (!tariff || usage.inputTokens === null || usage.outputTokens === null) return null
  const parts: [number | null, number][] = [
    [usage.inputTokens, tariff.inputPerMillion], [usage.outputTokens, tariff.outputPerMillion],
    [usage.cacheReadTokens, tariff.cacheReadPerMillion], [usage.cacheWriteTokens, tariff.cacheWritePerMillion],
  ]
  // Unknown usage is not zero. Only an explicitly zero tariff makes that bucket irrelevant to cost.
  if (parts.some(([tokens, rate]) => tokens === null && rate !== 0)) return null
  return parts.reduce((sum, [tokens, rate]) => sum + (tokens ?? 0) * rate / 1_000_000, 0)
}

/** Install before creating the entry Session or sending its first prompt. Refuses to overwrite an existing event file. */
export async function installTelemetry(ctx: Context, options: TelemetryOptions): Promise<ExperimentTelemetry> {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(options.runId)) throw new TypeError('runId must be a public alphanumeric identifier')
  validatePrices(options.prices)
  const prices = options.prices === undefined ? undefined : structuredClone(options.prices)
  const now = options.now ?? Date.now
  const include = options.includeSession ?? (() => true)
  const paths = { events: join(resolve(options.directory), 'events.jsonl'), summary: join(resolve(options.directory), 'summary.json') }
  await mkdir(resolve(options.directory), { recursive: true })
  const file = await open(paths.events, 'wx')
  const startedAt = now()
  let sequence = 0
  let calls = 0
  let closed = false
  let closedAt: number | undefined
  let closedWithInFlight = false
  let observationErrors = 0
  let writeFailed = false
  let writes = Promise.resolve()
  let closing: Promise<TelemetrySnapshot> | undefined
  const aliases = new Map<string, Map<string, string>>()
  const sessionTotals = new Map<string, TelemetryTotals>()
  const all = totals(prices?.currency ?? null)
  const pendingTools = new Map<string, { at: number; session: string; tool: string }>()
  const networks = new Map<string, Map<string, string>>()
  const atnCost = createAtnCostMeter()
  const callCosts: TelemetrySnapshot['callCosts'] = []
  const alias = (type: string, raw: string): string => {
    let entries = aliases.get(type)
    if (!entries) { entries = new Map(); aliases.set(type, entries) }
    let value = entries.get(raw)
    if (!value) { value = `${type}-${entries.size + 1}`; entries.set(raw, value) }
    return value
  }
  const sessionName = (id: string | undefined): string => id === undefined ? 'unattributed' : alias('session', id)
  const group = (name: string): TelemetryTotals => {
    let value = sessionTotals.get(name)
    if (!value) { value = totals(prices?.currency ?? null); sessionTotals.set(name, value) }
    return value
  }
  const emit = (kind: string, facts: Record<string, unknown>, at = now()): void => {
    if (closed) return
    const line = JSON.stringify({ version: 1, sequence: ++sequence, at, kind, ...facts }) + '\n'
    writes = writes.then(async () => { if (!writeFailed) await file.write(line) }).catch(() => { writeFailed = true })
  }
  emit('experiment.start', { runId: options.runId, priceTableId: prices?.id ?? null })

  const removeStream = ctx.on('llm/stream', (request, next) => {
    if (closed || !include(request.sessionId)) return next()
    return observe(request, next)
  }, { global: true, prepend: true })

  async function* observe(request: GenerateOptions, next: () => AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
    const call = `call-${++calls}`
    const session = sessionName(request.sessionId)
    const route = alias('route', JSON.stringify([request.provider, request.model]))
    const tariff = prices?.routes.find(row => row.provider === request.provider && row.model === request.model)
    const started = now()
    const counters = [all, group(session)]
    const fixed = request.tools?.some(tool => tool.name.startsWith('atn_')) ? measureAtnFixedContext(request.tools)
      : { systemPromptBytes: 0, toolSchemaBytes: 0, fixedContextBytes: 0 }
    const callCost = { call, session, ...fixed, inputTokens: null as number | null }
    callCosts.push(callCost)
    let usage: TokenUsage | undefined
    let status: 'completed' | 'error' | 'aborted' | 'incomplete' = 'incomplete'
    for (const counter of counters) { counter.attempts++; counter.inFlight++ }
    const purpose = request.purpose === 'compaction' || request.purpose === 'session-title' ? request.purpose : 'conversation'
    emit('model.start', { call, session, route, purpose, ...fixed })
    try {
      for await (const chunk of next()) {
        if (chunk.type === 'usage') usage = chunk.usage
        if (chunk.type === 'finish') status = chunk.reason.kind === 'error' ? 'error' : chunk.reason.kind === 'aborted' ? 'aborted' : 'completed'
        yield chunk
      }
    } catch (error) {
      status = request.signal?.aborted ? 'aborted' : 'error'
      throw error
    } finally {
      if (!closed) {
        const durationMs = Math.max(0, now() - started)
        const normalized = normalizeUsage(usage)
        callCost.inputTokens = normalized.inputTokens
        const amount = price(normalized, tariff)
        for (const counter of counters) {
          counter.inFlight--; counter.settledAttempts++; counter.modelDurationMs += durationMs
          if (status === 'error') counter.errors++
          if (status === 'aborted') counter.aborted++
          if (status === 'incomplete') counter.incomplete++
          for (const key of TOKEN_KEYS) {
            if (normalized[key] === null) counter.tokens[key].unknownCalls++
            else counter.tokens[key].known += normalized[key]
          }
          if (amount === null) counter.cost.unknownCalls++
          else counter.cost.knownAmount += amount
          counter.cost.amount = counter.cost.unknownCalls ? null : counter.cost.knownAmount
        }
        emit('model.end', { call, session, route, status, durationMs, usage: normalized, cost: amount, currency: prices?.currency ?? null })
      }
    }
  }

  const observeSession = (session: Session, event: SessionEvent): void => {
    if (closed || !include(session.id)) return
    const name = sessionName(session.id)
    const counters = [all, group(name)]
    if (event.type === 'team/member') {
      emit('team.member', { team: alias('team', event.data.teamId), session: name,
        member: sessionName(event.data.member.id), phase: event.data.member.phase, context: event.data.member.context }, event.time)
    } else if (event.type === 'team/task') {
      const { task, teamId } = event.data
      emit('team.task', { team: alias('team', teamId), session: name,
        task: alias('team-task', `${teamId}:${task.id}`), revision: task.revision, status: task.status,
        owner: task.ownerId === undefined ? null : sessionName(task.ownerId),
        blockedBy: task.blockedBy.map(id => alias('team-task', `${teamId}:${id}`)),
        writeScopes: task.writeScopes.map(scope => alias('write-scope', `${teamId}:${scope}`)),
      }, event.time)
    } else if (event.type === 'team/message/queued') {
      const { message, teamId } = event.data
      emit('team.mail', { team: alias('team', teamId), session: name, mail: alias('team-mail', `${teamId}:${message.id}`),
        from: sessionName(message.senderId), to: sessionName(message.targetId), status: 'queued' }, event.time)
    } else if (event.type === 'team/message/delivered') {
      emit('team.mail', { team: alias('team', event.data.teamId), session: name,
        mail: alias('team-mail', `${event.data.teamId}:${event.data.messageId}`), to: sessionName(event.data.targetId), status: 'delivered' }, event.time)
    } else if (event.type === 'tool/call') {
      const call = alias('toolcall', `${session.id}:${event.data.callId}`)
      const tool = alias('tool', event.data.name)
      pendingTools.set(call, { at: event.time, session: name, tool })
      counters.forEach(counter => { counter.toolsStarted++ })
      emit('tool.start', { session: name, call, tool, turn: event.data.turn, step: event.data.step }, event.time)
    } else if (event.type === 'tool/result') {
      const call = alias('toolcall', `${session.id}:${event.data.message.toolCallId}`)
      const pending = pendingTools.get(call)
      const durationMs = pending ? Math.max(0, event.time - pending.at) : null
      pendingTools.delete(call)
      for (const counter of counters) {
        counter.toolsFinished++
        if (event.data.message.isError) counter.toolErrors++
        counter.toolDurationMs += durationMs ?? 0
      }
      emit('tool.end', { session: name, call, tool: pending?.tool ?? null, error: !!event.data.message.isError, durationMs }, event.time)
    } else if (event.type === 'step/start' || event.type === 'step/end' || event.type === 'turn/start') {
      emit(event.type, { session: name, turn: event.data.turn, ...('step' in event.data ? { step: event.data.step } : {}) }, event.time)
    } else if (event.type === 'turn/end') {
      const reason = ['completed', 'aborted', 'error', 'max-tokens', 'blocked', 'interrupted', 'forked'].includes(event.data.reason.kind) ? event.data.reason.kind : 'other'
      emit('turn/end', { session: name, turn: event.data.turn, reason }, event.time)
    }
  }
  const removeSession = ctx.on('session/event', (session, event) => {
    try { observeSession(session, event) } catch { observationErrors++ }
  }, { global: true })

  function observeNetwork(record: NetworkRecord, at: number): void {
    const members = Object.values(record.nodes).filter(node => include(node.sessionId))
    if (!members.length) return
    const selected = new Set(members.map(node => node.id))
    atnCost.observe({ ...record, mails: Object.fromEntries(Object.entries(record.mails)
      .filter(([, mail]) => selected.has(mail.fromId) || selected.has(mail.toId))) })
    const network = alias('network', record.id)
    const old = networks.get(record.id) ?? new Map<string, string>()
    const next = new Map<string, string>()
    const fact = (key: string, kind: string, data: Record<string, unknown>): void => {
      const encoded = JSON.stringify(data)
      next.set(key, encoded)
      if (old.get(key) !== encoded) emit(kind, { network, ...data, ...(kind === 'topology.changed' ? { initial: !old.has(key) } : {}) }, at)
    }
    fact('network', 'network.state', { status: record.status, goalVersion: record.goalHistory.at(-1)?.version ?? null, stepsUsed: record.stepsUsed })
    if (record.whiteboard) fact('whiteboard', 'whiteboard.state', {
      entries: record.whiteboard.entries.length, generation: record.whiteboard.generation,
      ...record.whiteboard.usage,
    })
    for (const node of members) {
      const nodeId = alias('node', `${record.id}:${node.id}`)
      fact(`node:${node.id}`, 'node.state', { node: nodeId, session: sessionName(node.sessionId), entry: node.isEntry, lifecycle: node.lifecycle,
        creationState: node.creationState, stepsUsed: node.stepsUsed ?? null, stepBudget: record.limits.stepBudget })
      fact(`edges:${node.id}`, 'topology.changed', {
        node: nodeId,
        peers: (node.lifecycle === 'active' && node.creationState === 'published' ? collaborationPeers(record.nodes, node.id, collaborationPeerLimit(record)) : [])
          .filter(peer => selected.has(peer)).map(peer => alias('node', `${record.id}:${peer}`)),
      })
      const knowledge = node.knowledgeFingerprint
      if (knowledge) fact(`knowledge:${node.id}`, 'node.knowledge', {
        node: nodeId, source: 'self-reported', updatedAt: knowledge.updatedAt,
        documents: knowledge.documents.map(id => alias('document', id)),
        topics: knowledge.topics.map(topic => alias('topic', topic)),
        contributions: knowledge.contributions.map(contribution => alias('contribution', contribution)),
      })
    }
    for (const task of Object.values(record.tasks)) {
      if (!selected.has(task.holderId) && !selected.has(task.requesterId)) continue
      const taskId = alias('task', `${record.id}:${task.id}`)
      const acceptance = task.acceptance
      const resultBound = acceptance != null && task.status === 'completed' && task.result !== null
        && acceptance.resultDigest === taskResultDigest(task)
      const acceptanceStatus = resultBound ? acceptance.status : 'unverified'
      fact(`task:${task.id}`, 'task.state', {
        task: taskId, holder: alias('node', `${record.id}:${task.holderId}`),
        requester: alias('node', `${record.id}:${task.requesterId}`), status: task.status, createdAt: task.createdAt,
        settledAt: task.settledAt, evidenceCount: task.result?.evidence.length ?? null,
        dependsOn: (task.dependsOn ?? []).map(id => alias('task', `${record.id}:${id}`)),
        retryOf: task.retryOf == null ? null : alias('task', `${record.id}:${task.retryOf}`),
        holderStepsAtCreation: task.holderStepsAtCreation ?? null, holderStepsAtSettlement: task.holderStepsAtSettlement ?? null,
        acceptance: acceptanceStatus,
      })
      if (acceptance != null) {
        const metrics = resultBound ? acceptance.metrics : undefined
        const latencyMs = task.settledAt === null ? null : task.settledAt - task.createdAt
        fact(`acceptance:${task.id}`, 'task.acceptance', {
          task: taskId, status: acceptanceStatus, resultBound, checkedAt: acceptance.checkedAt,
          validator: alias('validator', acceptance.validatorId), evidenceCount: acceptance.evidence.length,
          comparison: metrics?.comparisonKey === undefined ? null : alias('comparison', metrics.comparisonKey),
          latencyMs: latencyMs !== null && latencyMs >= 0 ? latencyMs : null,
          cost: metrics?.cost ?? null,
          costUnit: metrics?.costUnit === undefined ? null : alias('cost-unit', metrics.costUnit),
          informationKeys: (metrics?.informationKeys ?? []).map(key => alias('information', key)),
        })
      }
      const feedback = task.localFeedback
      if (feedback) {
        const observed = observeRequesterTask(task, task.id)
        fact(`requester-feedback:${task.id}`, 'task.requester-feedback', {
          task: taskId, source: 'requester', status: feedback.status,
          effectiveStatus: observed.status, hostRejected: observed.hostRejected,
          eligibleForSelection: (observed.status === 'accepted' || observed.status === 'rejected') && observed.comparisonKey !== null,
          requester: alias('node', `${record.id}:${feedback.requesterId}`),
          resultBound: task.status === 'completed' && task.result !== null && task.settledBy === task.holderId
            && feedback.requesterId === task.requesterId && feedback.resultDigest === taskResultDigest(task),
          checkedAt: feedback.checkedAt, evidenceCount: feedback.evidence.length,
          comparison: feedback.comparisonKey === null ? null : alias('comparison', feedback.comparisonKey),
        })
      }
    }
    for (const rewire of record.rewireHistory ?? []) {
      if (!selected.has(rewire.nodeId)) continue
      const evaluation = rewire.evaluation
      const requesterEvaluation = rewire.requesterEvaluation
      const observations = rewire.observations
      const observationSnapshot = (snapshot: NonNullable<typeof observations>['before']) => ({
        observedAt: snapshot.observedAt,
        peers: snapshot.peers.map(({ peerId, taskIds, ...counts }) => ({ ...counts,
          peer: alias('node', `${record.id}:${peerId}`), tasks: taskIds.map(id => alias('task', `${record.id}:${id}`)) })),
      })
      fact(`rewire:${rewire.id}`, 'topology.rewire', {
        rewire: alias('rewire', `${record.id}:${rewire.id}`), node: alias('node', `${record.id}:${rewire.nodeId}`),
        committedAt: rewire.createdAt,
        previousPeers: rewire.previousPeers.map(id => alias('node', `${record.id}:${id}`)),
        nextPeers: rewire.nextPeers.map(id => alias('node', `${record.id}:${id}`)),
        intent: rewire.intent,
        evidenceSource: evaluation.verdict !== 'insufficient-evidence' ? 'host'
          : requesterEvaluation?.verdict !== undefined && requesterEvaluation.verdict !== 'insufficient-evidence' ? 'requester' : 'none',
        verdict: evaluation.verdict !== 'insufficient-evidence' ? evaluation.verdict
          : requesterEvaluation?.verdict ?? evaluation.verdict,
        hostVerdict: evaluation.verdict, hostReasons: evaluation.reasons,
        requesterVerdict: requesterEvaluation?.verdict ?? 'insufficient-evidence',
        causalClaim: false,
        baselineTasks: evaluation.baselineTaskIds.map(id => alias('task', `${record.id}:${id}`)),
        candidateTasks: evaluation.candidateTaskIds.map(id => alias('task', `${record.id}:${id}`)),
        comparison: evaluation.comparisonKey === null ? null : alias('comparison', evaluation.comparisonKey),
        validator: evaluation.validatorId === null ? null : alias('validator', evaluation.validatorId),
        costUnit: evaluation.costUnit === null ? null : alias('cost-unit', evaluation.costUnit),
        delta: {
          passRate: evaluation.delta.passRate, meanLatencyMs: evaluation.delta.meanLatencyMs,
          meanCost: evaluation.delta.meanCost,
        },
        requesterEvaluation: requesterEvaluation ? {
          source: 'requester', qualityOnly: true, causalClaim: false,
          verdict: requesterEvaluation.verdict, reasons: requesterEvaluation.reasons,
          baselineTasks: requesterEvaluation.baselineTaskIds.map(id => alias('task', `${record.id}:${id}`)),
          candidateTasks: requesterEvaluation.candidateTaskIds.map(id => alias('task', `${record.id}:${id}`)),
          comparison: requesterEvaluation.comparisonKey === null ? null : alias('comparison', requesterEvaluation.comparisonKey),
          baseline: requesterEvaluation.baseline, candidate: requesterEvaluation.candidate, delta: requesterEvaluation.delta,
        } : null,
      })
      // Changing observations are separate from the immutable rewire fact, so
      // one committed action is counted once while outcomes remain inspectable.
      if (observations) fact(`rewire-observations:${rewire.id}`, 'topology.rewire-observations', {
        rewire: alias('rewire', `${record.id}:${rewire.id}`), causalClaim: false,
        before: observationSnapshot(observations.before), after: observationSnapshot(observations.after),
      })
    }
    for (const mail of Object.values(record.mails)) {
      if (!selected.has(mail.fromId) && !selected.has(mail.toId)) continue
      fact(`mail:${mail.id}`, 'mail.state', { mail: alias('mail', `${record.id}:${mail.id}`),
        from: alias('node', `${record.id}:${mail.fromId}`), to: alias('node', `${record.id}:${mail.toId}`),
        task: mail.taskId === null ? null : alias('task', `${record.id}:${mail.taskId}`), messageKind: mail.kind, status: mail.status,
      })
    }
    for (const proposal of Object.values(record.proposals)) {
      if (!selected.has(proposal.proposerId)) continue
      fact(`proposal:${proposal.id}`, 'proposal.state', { proposal: alias('proposal', `${record.id}:${proposal.id}`),
        status: proposal.status, baseVersion: proposal.baseVersion, votes: proposal.votes.map(vote => ({ voter: alias('node', `${record.id}:${vote.voterId}`), approve: vote.approve })),
      })
    }
    networks.set(record.id, next)
  }
  const removeNetwork = ctx.on('atn/network-updated', ({ record, at }) => {
    if (closed) return
    try { observeNetwork(record, at) } catch { observationErrors++ }
  }, { global: true })

  const snapshot = (): TelemetrySnapshot => {
    const observedAt = closedAt ?? now()
    const cost = atnCost.snapshot()
    const knownInput = callCosts.filter(row => row.inputTokens !== null)
    const knownMean = knownInput.length ? knownInput.reduce((sum, row) => sum + row.inputTokens!, 0) / knownInput.length : null
    const result: TelemetrySnapshot = structuredClone({
      version: 1, runId: options.runId, startedAt, observedAt, elapsedMs: Math.max(0, observedAt - startedAt),
      events: sequence, totals: all, sessions: Object.fromEntries(sessionTotals),
      atnMessages: cost.messages, atnPayloadBytes: cost.payloadBytes, atnMaxContextBytes: cost.maxContextBytes,
      atnBoard: cost.board, atnTotalInteractions: cost.totalInteractions, atnTotalTransferBytes: cost.totalTransferBytes,
      fixedContextBytes: callCosts.some(row => row.fixedContextBytes > 0) ? Math.max(...callCosts.map(row => row.fixedContextBytes)) : null,
      meanInputTokensPerCall: callCosts.length && knownInput.length === callCosts.length ? knownMean : null,
      knownMeanInputTokensPerCall: knownMean, inputTokenUnknownCalls: callCosts.length - knownInput.length, callCosts,
      coverage: {
        modelCalls: 'llm/stream invocations, including observable retries and auxiliary calls', hiddenHttpRetries: 'unknown',
        directExternalCalls: 'not-observed', usageSource: 'last adapter usage chunk per invocation; absent fields remain unknown',
        tokenUnits: 'input excludes cache; reasoning is contained in output; total is not added to buckets',
        costMeaning: 'reference tariff estimate, not actual billing or subscription consumption',
        content: 'no prompts, completions, tool arguments/results, error text, or raw identifiers',
        priceTableId: prices?.id ?? null, writeFailed, observationErrors, closedWithInFlight,
      },
    })
    for (const counter of [result.totals, ...Object.values(result.sessions)]) {
      if (counter.inFlight) counter.cost.amount = null
    }
    return result
  }
  const flush = async (): Promise<void> => {
    await writes
    if (writeFailed) throw new Error('Experiment telemetry write failed; this run is incomplete')
    if (!closed) await file.sync()
  }
  const close = (): Promise<TelemetrySnapshot> => {
    if (closing) return closing
    closedWithInFlight = all.inFlight > 0
    emit('experiment.end', { inFlight: all.inFlight, unfinishedTools: pendingTools.size })
    closedAt = now()
    closed = true
    removeStream(); removeSession(); removeNetwork()
    closing = (async () => {
      try {
        await flush()
        await file.sync()
        const final = snapshot()
        await writeFile(paths.summary, JSON.stringify(final, null, 2) + '\n', { flag: 'wx' })
        return final
      } finally { await file.close() }
    })()
    return closing
  }
  return { paths, snapshot, flush, close }
}
