/** Digest-bound requester opinions, distinct from independent host verification. */
import { Buffer } from 'node:buffer'
import { isDeepStrictEqual } from 'node:util'
import { requesterFeedbackSchema, type NetworkRecord, type RequesterFeedback,
  type RequesterRewireEvaluation, type RequesterEdge, type TaskRecord } from './schema.ts'
import { taskResultDigest } from './tasks.ts'
import { MAX_FEEDBACK_TASKS, type RewireEvidenceInput } from './verified-feedback.ts'

export const MAX_REQUESTER_FEEDBACK_BYTES = 4096

/** Caller identity, submission digest and timestamp are supplied by the runtime. */
export interface RequesterFeedbackInput {
  readonly taskId: string
  readonly status: RequesterFeedback['status']
  readonly summary: string
  readonly evidence: readonly string[]
  /** Requester-declared shared workload and acceptance contract, required for comparisons. */
  readonly comparisonKey?: string
}

export class RequesterFeedbackError extends Error {
  constructor(
    readonly code: 'unknown-task' | 'not-requester' | 'self-rating' | 'not-submitted' |
      'invalid-time' | 'invalid-feedback' | 'already-reviewed' | 'stale-feedback',
    message: string,
  ) {
    super(message)
    this.name = 'RequesterFeedbackError'
  }
}

function isHolderSubmission(task: TaskRecord): boolean {
  return task.kind !== 'delivery' && task.status === 'completed' && task.result !== null &&
    task.settledAt !== null && task.settledBy === task.holderId && task.requesterId !== task.holderId
}

/**
 * Persist one bounded opinion from the real requester. A needs-more assessment
 * can become terminal; terminal opinions are immutable. Exact retries retain
 * the original timestamp and do not consume durable history or mail capacity.
 * The runtime remains responsible for checking the caller's live capability.
 */
export function recordRequesterFeedback(
  record: NetworkRecord,
  nodeId: string,
  input: RequesterFeedbackInput,
  now: number,
): { record: NetworkRecord; task: TaskRecord; feedback: RequesterFeedback } {
  const task = record.tasks[input.taskId]
  if (task === undefined) throw new RequesterFeedbackError('unknown-task', `task ${input.taskId} does not exist`)
  if (task.requesterId !== nodeId) {
    throw new RequesterFeedbackError('not-requester', `only requester ${task.requesterId} can review task ${task.id}`)
  }
  if (task.holderId === nodeId) throw new RequesterFeedbackError('self-rating', 'nodes cannot rate their own submissions')
  if (!isHolderSubmission(task)) {
    throw new RequesterFeedbackError('not-submitted', `task ${task.id} has no completed holder submission to review`)
  }
  if (!Number.isSafeInteger(now) || now < task.settledAt! || now < (task.localFeedback?.checkedAt ?? 0)) {
    throw new RequesterFeedbackError('invalid-time', 'feedback must occur at or after submission and previous feedback')
  }
  const parsed = requesterFeedbackSchema.safeParse({
    status: input.status, requesterId: nodeId, summary: input.summary, evidence: input.evidence,
    comparisonKey: input.comparisonKey ?? null, resultDigest: taskResultDigest(task), checkedAt: now,
  })
  if (!parsed.success) throw new RequesterFeedbackError('invalid-feedback', parsed.error.message)
  const feedback = parsed.data
  const maxBytes = Math.min(MAX_REQUESTER_FEEDBACK_BYTES, record.limits.maxMessageBytes)
  if (Buffer.byteLength(JSON.stringify(feedback), 'utf8') > maxBytes) {
    throw new RequesterFeedbackError('invalid-feedback', `requester feedback exceeds ${maxBytes} UTF-8 bytes`)
  }
  const previous = task.localFeedback
  if (previous !== undefined) {
    if (previous.resultDigest !== feedback.resultDigest || previous.requesterId !== nodeId) {
      throw new RequesterFeedbackError('stale-feedback', `task ${task.id} no longer matches its recorded review`)
    }
    if (isDeepStrictEqual(previous, { ...feedback, checkedAt: previous.checkedAt })) {
      return { record, task, feedback: previous }
    }
    if (previous.status !== 'needs-more' || feedback.status === 'needs-more' ||
      previous.comparisonKey !== feedback.comparisonKey) {
      throw new RequesterFeedbackError('already-reviewed', 'only needs-more may become a terminal opinion under the same comparison contract')
    }
  }
  const reviewed: TaskRecord = { ...task, localFeedback: feedback }
  const updated = { ...record, tasks: { ...record.tasks, [task.id]: reviewed } }
  return { record: refreshRequesterRewireEvidence(updated, now), task: reviewed, feedback }
}

export interface RequesterTaskObservation {
  taskId: string
  status: RequesterFeedback['status'] | 'unrated'
  requesterId: string | null
  comparisonKey: string | null
  checkedAt: number | null
  /** An independent rejection suppresses contradictory requester acceptance. */
  hostRejected: boolean
}

export interface RequesterFeedbackAggregate {
  accepted: number
  rejected: number
  needsMore: number
  unrated: number
  /** Terminal opinions only; needs-more is not a rejection. */
  acceptanceRate: number | null
}

export interface RequesterPeerFeedback extends RequesterFeedbackAggregate {
  source: 'requester'
  taskIds: string[]
  omittedTasks: number
  openTasks: number
  observations: RequesterTaskObservation[]
}

/** Effective source-labelled rating of one immutable submission, without sample truncation. */
export function observeRequesterTask(task: TaskRecord | undefined, taskId: string): RequesterTaskObservation {
  const feedback = task?.localFeedback
  const digest = task === undefined ? null : taskResultDigest(task)
  const hostRejected = task?.acceptance?.status === 'failed' && task.acceptance.resultDigest === digest
  const valid = task !== undefined && isHolderSubmission(task) && feedback !== undefined &&
    requesterFeedbackSchema.safeParse(feedback).success && feedback.requesterId === task.requesterId &&
    feedback.resultDigest === digest && feedback.checkedAt >= task.settledAt! &&
    !(hostRejected && feedback.status === 'accepted')
  return {
    taskId, status: valid ? feedback.status : 'unrated',
    requesterId: valid ? feedback.requesterId : null,
    comparisonKey: valid ? feedback.comparisonKey : null,
    checkedAt: valid ? feedback.checkedAt : null,
    hostRejected,
  }
}

function aggregate(rows: readonly RequesterTaskObservation[]): RequesterFeedbackAggregate {
  const accepted = rows.filter(row => row.status === 'accepted').length
  const rejected = rows.filter(row => row.status === 'rejected').length
  const needsMore = rows.filter(row => row.status === 'needs-more').length
  return {
    accepted, rejected, needsMore, unrated: rows.length - accepted - rejected - needsMore,
    acceptanceRate: accepted + rejected === 0 ? null : accepted / (accepted + rejected),
  }
}

/** Bounded recent requester observations; no optional host validator is needed. */
export function summarizeRequesterFeedback(
  record: NetworkRecord,
  peerId: string,
  options: { observerId?: string; maxTasks?: number } = {},
): RequesterPeerFeedback {
  const requested = options.maxTasks ?? MAX_FEEDBACK_TASKS
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(MAX_FEEDBACK_TASKS, Math.trunc(requested))) : MAX_FEEDBACK_TASKS
  const held = Object.values(record.tasks).filter(task => task.holderId === peerId && task.kind !== 'delivery' &&
    task.requesterId !== task.holderId && (options.observerId === undefined || task.requesterId === options.observerId))
  // A requester may inspect an old submission after newer work has completed.
  // Its fresh opinion must enter the bounded feedback view and refresh telemetry.
  const terminal = held.filter(task => task.status !== 'open').map(task => ({ task, observation: observeRequesterTask(task, task.id) }))
    .sort((a, b) => (b.observation.checkedAt ?? b.task.settledAt ?? -1) -
      (a.observation.checkedAt ?? a.task.settledAt ?? -1) || a.task.id.localeCompare(b.task.id))
  const selected = terminal.slice(0, limit)
  const observations = selected.map(({ observation }) => observation)
  return {
    source: 'requester', taskIds: selected.map(({ task }) => task.id), omittedTasks: terminal.length - selected.length,
    openTasks: held.filter(task => task.status === 'open').length, ...aggregate(observations), observations,
  }
}

/** Only comparable ratings of the requester's actual removed/added edges count. */
export function evaluateRequesterRewireEvidence(record: NetworkRecord, input: RewireEvidenceInput): RequesterRewireEvaluation {
  const reasons: string[] = []
  const oversized = input.baselineTaskIds.length > MAX_FEEDBACK_TASKS || input.candidateTaskIds.length > MAX_FEEDBACK_TASKS
  if (oversized) reasons.push('sample-limit-exceeded')
  const baselineTaskIds = [...new Set(input.baselineTaskIds.slice(0, MAX_FEEDBACK_TASKS))].sort()
  const candidateTaskIds = [...new Set(input.candidateTaskIds.slice(0, MAX_FEEDBACK_TASKS))].sort()
  if (!oversized && (baselineTaskIds.length !== input.baselineTaskIds.length || candidateTaskIds.length !== input.candidateTaskIds.length)) {
    reasons.push('duplicate-task-ids')
  }
  if (!Object.values(record.tasks).some(task => task.requesterId === input.requesterId && task.localFeedback !== undefined)) reasons.push('no-ratings-at-all')
  if (candidateTaskIds.length === 0) reasons.push('new-edge-unobserved')
  if (baselineTaskIds.length === 0) reasons.push('baseline-below-minimum-samples')
  if (baselineTaskIds.length !== candidateTaskIds.length) reasons.push('unmatched-sample-counts')
  if (baselineTaskIds.some(id => candidateTaskIds.includes(id))) reasons.push('overlapping-samples')
  const removed = input.previousPeers.filter(id => !input.nextPeers.includes(id))
  const added = input.nextPeers.filter(id => !input.previousPeers.includes(id))
  const checkLocal = (ids: string[], peers: string[], side: string): void => {
    if (ids.some(id => record.tasks[id] === undefined)) reasons.push(`${side}-unknown-task`)
    if (ids.some(id => {
      const task = record.tasks[id]
      return task !== undefined && (task.requesterId !== input.requesterId || !peers.includes(task.holderId) || !isHolderSubmission(task))
    })) reasons.push(`${side}-not-local-edge-evidence`)
    if (peers.some(id => !ids.some(taskId => record.tasks[taskId]?.holderId === id))) reasons.push(`${side}-below-minimum-samples`)
  }
  checkLocal(baselineTaskIds, removed, 'baseline')
  checkLocal(candidateTaskIds, added, 'candidate')
  const baselineRows = baselineTaskIds.map(id => observeRequesterTask(record.tasks[id], id))
  const candidateRows = candidateTaskIds.map(id => observeRequesterTask(record.tasks[id], id))
  const rows = [...baselineRows, ...candidateRows]
  const baseline = aggregate(baselineRows)
  const candidate = aggregate(candidateRows)
  const minimumSamples = record.limits.requesterMinSamples ?? 2
  if ([...removed.map(peer => baselineTaskIds.filter(id => record.tasks[id]?.holderId === peer &&
    ['accepted', 'rejected'].includes(observeRequesterTask(record.tasks[id], id).status)).length),
  ...added.map(peer => candidateTaskIds.filter(id => record.tasks[id]?.holderId === peer &&
    ['accepted', 'rejected'].includes(observeRequesterTask(record.tasks[id], id).status)).length)]
    .some(count => count < minimumSamples)) reasons.push('minimum-edge-samples-not-met')
  const firstKey = rows[0]?.comparisonKey ?? null
  const comparisonKey = firstKey !== null && rows.every(row => row.comparisonKey === firstKey) ? firstKey : null
  if (baseline.unrated + candidate.unrated > 0) reasons.push('unrated-results')
  if (baseline.needsMore + candidate.needsMore > 0) reasons.push('pending-requester-feedback')
  if (comparisonKey === null) reasons.push('missing-or-different-comparison-key')
  if (rows.some(row => row.hostRejected && row.status === 'unrated')) reasons.push('host-rejected-requester-acceptance')
  const comparable = reasons.length === 0 && baseline.acceptanceRate !== null && candidate.acceptanceRate !== null
  const delta = { acceptanceRate: comparable ? candidate.acceptanceRate! - baseline.acceptanceRate! : null }
  const verdict = !comparable ? 'insufficient-evidence' : delta.acceptanceRate! > 0 ? 'observed-improvement' :
    delta.acceptanceRate! < 0 ? 'observed-regression' : 'unchanged'
  return { source: 'requester', qualityOnly: true, causalClaim: false, verdict, requesterId: input.requesterId,
    baselineTaskIds, candidateTaskIds, comparisonKey, baseline, candidate, delta, reasons }
}

/**
 * Discover local evidence without asking models to remember task ids. Choose
 * recent same-contract terminal samples symmetrically and cover every changed
 * peer; absent coverage yields no automatic claim, never a partial best case.
 */
export function selectRequesterRewireSamples(
  record: NetworkRecord,
  input: Pick<RewireEvidenceInput, 'requesterId' | 'previousPeers' | 'nextPeers'>,
): { baselineTaskIds: string[]; candidateTaskIds: string[] } {
  const removed = input.previousPeers.filter(id => !input.nextPeers.includes(id))
  const added = input.nextPeers.filter(id => !input.previousPeers.includes(id))
  const empty = { baselineTaskIds: [] as string[], candidateTaskIds: [] as string[] }
  if (removed.length === 0 || added.length === 0 || removed.length > MAX_FEEDBACK_TASKS || added.length > MAX_FEEDBACK_TASKS) return empty
  const tasks = Object.values(record.tasks).filter(task => task.requesterId === input.requesterId &&
    (removed.includes(task.holderId) || added.includes(task.holderId))).map(task => ({ task, row: observeRequesterTask(task, task.id) }))
    .filter(({ row }) => (row.status === 'accepted' || row.status === 'rejected') && row.comparisonKey !== null)
    .sort((a, b) => b.row.checkedAt! - a.row.checkedAt! || a.task.id.localeCompare(b.task.id))
  const keys = [...new Set(tasks.map(({ row }) => row.comparisonKey!))]
  let fallback = empty
  for (const key of keys) {
    const baseline = tasks.filter(({ task, row }) => row.comparisonKey === key && removed.includes(task.holderId))
    const candidate = tasks.filter(({ task, row }) => row.comparisonKey === key && added.includes(task.holderId))
    if (candidate.length === 0 && fallback.baselineTaskIds.length === 0 && removed.every(peer => baseline.some(({ task }) => task.holderId === peer))) {
      fallback = { baselineTaskIds: baseline.slice(0, MAX_FEEDBACK_TASKS).map(({ task }) => task.id).sort(), candidateTaskIds: [] }
    }
    const count = Math.min(MAX_FEEDBACK_TASKS, baseline.length, candidate.length)
    if (count < Math.max(removed.length, added.length)) continue
    const pick = (rows: typeof tasks, peers: string[]): string[] | null => {
      const coverage = peers.map(peer => rows.find(({ task }) => task.holderId === peer)?.task.id)
      if (coverage.some(id => id === undefined)) return null
      const ids = new Set(coverage as string[])
      for (const { task } of rows) {
        if (ids.size >= count) break
        ids.add(task.id)
      }
      return [...ids].sort()
    }
    const baselineTaskIds = pick(baseline, removed)
    const candidateTaskIds = pick(candidate, added)
    if (baselineTaskIds !== null && candidateTaskIds !== null) return { baselineTaskIds, candidateTaskIds }
  }
  return fallback
}

function edgeKey(requesterId: string, holderId: string, comparisonKey: string | null): string {
  return JSON.stringify([requesterId, holderId, comparisonKey])
}

function edgeFromTasks(record: NetworkRecord, requesterId: string, holderId: string,
  comparisonKey: string | null, taskIds: readonly string[]): RequesterEdge {
  const totals = aggregate(taskIds.map(id => observeRequesterTask(record.tasks[id], id)))
  return { requesterId, holderId, comparisonKey, taskIds: [...taskIds].sort(), ...totals,
    sampleCount: totals.accepted + totals.rejected,
    state: taskIds.length === 0 ? 'unobserved' : 'observed' }
}

/** Distinct submissions, never calls: retries and needs-more resolution cannot inflate a sample. */
export function accumulateRequesterEdges(record: NetworkRecord): RequesterEdge[] {
  const grouped = new Map<string, { requesterId: string; holderId: string; comparisonKey: string | null; taskIds: string[] }>()
  for (const task of Object.values(record.tasks)) {
    const feedback = task.localFeedback
    if (feedback === undefined || !isHolderSubmission(task) || feedback.requesterId !== task.requesterId ||
      feedback.resultDigest !== taskResultDigest(task) || feedback.checkedAt < task.settledAt!) continue
    const key = edgeKey(task.requesterId, task.holderId, feedback.comparisonKey)
    const group = grouped.get(key) ?? { requesterId: task.requesterId, holderId: task.holderId,
      comparisonKey: feedback.comparisonKey, taskIds: [] }
    group.taskIds.push(task.id)
    grouped.set(key, group)
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) =>
    edgeFromTasks(record, group.requesterId, group.holderId, group.comparisonKey, group.taskIds))
}

/** Freeze all removed-edge evidence now; candidate evidence may arrive after the topology decision. */
export function evaluateCumulativeRequesterRewire(record: NetworkRecord,
  input: Pick<RewireEvidenceInput, 'requesterId' | 'previousPeers' | 'nextPeers'>,
  now: number, frozenBaseline?: readonly RequesterEdge[]): RequesterRewireEvaluation {
  const edges = accumulateRequesterEdges(record)
  const removed = input.previousPeers.filter(peer => !input.nextPeers.includes(peer))
  const added = input.nextPeers.filter(peer => !input.previousPeers.includes(peer))
  const baselineEdges = frozenBaseline === undefined
    ? edges.filter(edge => edge.requesterId === input.requesterId && removed.includes(edge.holderId))
    : frozenBaseline.map(edge => edgeFromTasks(record, edge.requesterId, edge.holderId, edge.comparisonKey, edge.taskIds))
  const candidateEdges = edges.filter(edge => edge.requesterId === input.requesterId && added.includes(edge.holderId))
  const minimumSamples = record.limits.requesterMinSamples ?? 2
  const keys = [...new Set([...baselineEdges, ...candidateEdges].map(edge => edge.comparisonKey).filter(key => key !== null))].sort()
  const matching = (list: readonly RequesterEdge[], peer: string, key: string | null): RequesterEdge =>
    list.find(edge => edge.holderId === peer && edge.comparisonKey === key) ?? edgeFromTasks(record, input.requesterId, peer, key, [])
  // A full comparable contract outranks a tied contract with pending or suppressed opinions.
  const selected = (key: string): RequesterEdge[] => [...removed.map(peer => matching(baselineEdges, peer, key)),
    ...added.map(peer => matching(candidateEdges, peer, key))]
  const complete = (key: string): number => Number(removed.length > 0 && added.length > 0 &&
    selected(key).every(edge => edge.sampleCount >= minimumSamples && edge.needsMore === 0 && edge.unrated === 0))
  const quality = (key: string): number => selected(key).reduce((sum, edge) => sum + Math.min(minimumSamples, edge.sampleCount), 0)
  keys.sort((a, b) => complete(b) - complete(a) || quality(b) - quality(a) || a.localeCompare(b))
  const comparisonKey = keys[0] ?? null
  const baselineSelected = removed.map(peer => matching(baselineEdges, peer, comparisonKey))
  const candidateSelected = added.map(peer => matching(candidateEdges, peer, comparisonKey))
  const sum = (list: readonly RequesterEdge[]): RequesterFeedbackAggregate => {
    const accepted = list.reduce((total, edge) => total + edge.accepted, 0)
    const rejected = list.reduce((total, edge) => total + edge.rejected, 0)
    return { accepted, rejected, needsMore: list.reduce((total, edge) => total + edge.needsMore, 0),
      unrated: list.reduce((total, edge) => total + edge.unrated, 0),
      acceptanceRate: accepted + rejected === 0 ? null : accepted / (accepted + rejected) }
  }
  const baseline = sum(baselineSelected), candidate = sum(candidateSelected)
  const reasons: string[] = []
  if (!Object.values(record.tasks).some(task => task.requesterId === input.requesterId && task.localFeedback !== undefined)) reasons.push('no-ratings-at-all')
  if (added.some(peer => !candidateEdges.some(edge => edge.holderId === peer && edge.taskIds.length > 0))) reasons.push('new-edge-unobserved')
  if (removed.length === 0 || added.length === 0) reasons.push('no-replaced-edge')
  if (baselineSelected.some(edge => edge.sampleCount < minimumSamples)) reasons.push('baseline-below-minimum-samples')
  if (candidateSelected.some(edge => edge.state !== 'unobserved' && edge.sampleCount < minimumSamples)) reasons.push('candidate-below-minimum-samples')
  if (comparisonKey === null || baselineSelected.some(edge => edge.state === 'unobserved') ||
    candidateSelected.some(edge => edge.state === 'unobserved' && candidateEdges.some(other => other.holderId === edge.holderId))) {
    reasons.push('missing-or-different-comparison-key')
  }
  if (baseline.needsMore + candidate.needsMore > 0) reasons.push('pending-requester-feedback')
  if (baseline.unrated + candidate.unrated > 0) reasons.push('unrated-results')
  const comparable = reasons.length === 0 && baseline.acceptanceRate !== null && candidate.acceptanceRate !== null &&
    [...baselineSelected, ...candidateSelected].every(edge => edge.sampleCount >= minimumSamples)
  const delta = { acceptanceRate: comparable ? candidate.acceptanceRate! - baseline.acceptanceRate! : null }
  const verdict = !comparable ? 'insufficient-evidence' : delta.acceptanceRate! > 0 ? 'observed-improvement' :
    delta.acceptanceRate! < 0 ? 'observed-regression' : 'unchanged'
  return { source: 'requester', qualityOnly: true, causalClaim: false, requesterId: input.requesterId,
    baselineTaskIds: baselineSelected.flatMap(edge => edge.taskIds).sort().slice(0, MAX_FEEDBACK_TASKS),
    candidateTaskIds: candidateSelected.flatMap(edge => edge.taskIds).sort().slice(0, MAX_FEEDBACK_TASKS),
    baselineEdges, candidateEdges: [...candidateEdges, ...candidateSelected.filter(edge => edge.state === 'unobserved')],
    comparisonKey, baseline, candidate, delta, verdict, reasons, minimumSamples, evaluatedAt: now }
}

/** Run within the network mutation, including shutdown; never revive or deliver work. */
export function refreshRequesterRewireEvidence(record: NetworkRecord, now: number): NetworkRecord {
  const requesterEdges = accumulateRequesterEdges(record)
  const rewireHistory = record.rewireHistory?.map(row => {
    const previous = row.requesterEvaluation
    const evaluation = evaluateCumulativeRequesterRewire(record, {
      requesterId: row.nodeId, previousPeers: row.previousPeers, nextPeers: row.nextPeers,
    }, now, previous?.baselineEdges ?? requesterEdges.filter(edge => edge.requesterId === row.nodeId &&
      row.previousPeers.includes(edge.holderId) && !row.nextPeers.includes(edge.holderId)).map(edge =>
      edgeFromTasks(record, edge.requesterId, edge.holderId, edge.comparisonKey,
        edge.taskIds.filter(id => (record.tasks[id]?.localFeedback?.checkedAt ?? Infinity) <= row.createdAt))))
    // Timestamps change only with actual evidence, making repeated reads/recovery stable.
    if (previous !== undefined && isDeepStrictEqual({ ...evaluation, evaluatedAt: previous.evaluatedAt }, previous)) return row
    return { ...row, requesterEvaluation: evaluation }
  })
  if (isDeepStrictEqual(requesterEdges, record.requesterEdges) && isDeepStrictEqual(rewireHistory, record.rewireHistory)) return record
  return { ...record, requesterEdges, ...(rewireHistory === undefined ? {} : { rewireHistory }) }
}
