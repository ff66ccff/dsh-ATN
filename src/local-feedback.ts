/** Free runtime telemetry for local collaboration; no model calls or host verifier. */
import { createHash } from 'node:crypto'
import type { LocalPeerObservation, NetworkRecord, RewireObservations, TaskRecord } from './schema.ts'
import { taskResultDigest } from './tasks.ts'

export const MAX_LOCAL_FEEDBACK_TASKS = 8

export interface LocalTaskObservation {
  taskId: string
  status: TaskRecord['status']
  /** Age while open, or time to settlement. Wall time never implies a model step. */
  elapsedMs: number | null
  latencyMs: number | null
  /** Holder steps during this task's lifetime; overlapping tasks share the window. */
  holderSteps: number | null
  retryOf: string | null
  recovery: boolean
  /** Direct dependency failures are correlated observations, not causal attribution. */
  downstreamFailures: number
}

export interface LocalPeerFeedback extends LocalPeerObservation {
  source: 'runtime'
  lifecycle: NetworkRecord['nodes'][string]['lifecycle'] | null
  /** Sample terminal tasks independently so new open tasks cannot evict them. */
  terminalTaskIds: string[]
  observations: LocalTaskObservation[]
}

function nonnegative(value: number | undefined | null): number | null {
  return value !== undefined && value !== null && Number.isFinite(value) && value >= 0 ? value : null
}

function meanKnown(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some(value => value === null)) return null
  return values.reduce<number>((total, value) => total + value! / values.length, 0)
}

function isFailed(task: TaskRecord): boolean {
  return task.status === 'failed' || task.status === 'unreachable' ||
    (task.status === 'completed' && task.acceptance?.status === 'failed' && task.acceptance.resultDigest === taskResultDigest(task))
}

function isRecovery(record: NetworkRecord, task: TaskRecord): boolean {
  const prior = task.retryOf == null ? undefined : record.tasks[task.retryOf]
  if (prior === undefined) return false
  const holder = record.nodes[prior.holderId]
  return prior.status === 'unreachable' || (prior.holderId !== task.holderId &&
    (holder?.lifecycle === 'failed' || holder?.lifecycle === 'retired'))
}

/**
 * Counts describe all work this requester assigned to this holder. Individual
 * task rows and latency/step averages use at most eight recent tasks. Completion
 * is a holder declaration; only the separate host acceptance channel checks
 * correctness. Missing legacy step counters remain unknown, never free work.
 */
export function summarizeLocalFeedback(
  record: NetworkRecord,
  peerId: string,
  options: { observerId?: string; now?: number; maxTasks?: number } = {},
): LocalPeerFeedback {
  const now = options.now ?? Date.now()
  const requested = options.maxTasks ?? MAX_LOCAL_FEEDBACK_TASKS
  const limit = Number.isFinite(requested)
    ? Math.max(1, Math.min(MAX_LOCAL_FEEDBACK_TASKS, Math.trunc(requested))) : MAX_LOCAL_FEEDBACK_TASKS
  const all = Object.values(record.tasks)
  const held = all.filter(task => task.holderId === peerId &&
    (options.observerId === undefined || task.requesterId === options.observerId))
  const recent = held.toSorted((left, right) =>
    (right.settledAt ?? right.createdAt) - (left.settledAt ?? left.createdAt) || left.id.localeCompare(right.id)).slice(0, limit)
  const downstream = all.filter(task => isFailed(task) &&
    (options.observerId === undefined || task.requesterId === options.observerId || task.holderId === options.observerId))
  const observations = recent.map((task): LocalTaskObservation => {
    const startSteps = task.holderStepsAtCreation
    const endSteps = task.status === 'open' ? record.nodes[peerId]?.stepsUsed : task.holderStepsAtSettlement
    return {
      taskId: task.id,
      status: task.status,
      elapsedMs: nonnegative((task.settledAt ?? now) - task.createdAt),
      latencyMs: task.settledAt === null ? null : nonnegative(task.settledAt - task.createdAt),
      holderSteps: startSteps === undefined || endSteps === undefined ? null : nonnegative(endSteps - startSteps),
      retryOf: task.retryOf ?? null,
      recovery: isRecovery(record, task),
      downstreamFailures: downstream.filter(candidate => candidate.dependsOn?.includes(task.id)).length,
    }
  })
  const terminal = observations.filter(task => task.status !== 'open')
  const stepsUsed = nonnegative(record.nodes[peerId]?.stepsUsed)
  const taskIds = new Set(held.map(task => task.id))
  return {
    source: 'runtime', peerId,
    lifecycle: record.nodes[peerId]?.lifecycle ?? null,
    terminalTaskIds: held.filter(task => task.status !== 'open').toSorted((left, right) =>
      (right.settledAt ?? right.createdAt) - (left.settledAt ?? left.createdAt) || left.id.localeCompare(right.id))
      .slice(0, limit).map(task => task.id),
    assigned: held.length,
    open: held.filter(task => task.status === 'open').length,
    completed: held.filter(task => task.status === 'completed').length,
    failed: held.filter(task => task.status === 'failed').length,
    unreachable: held.filter(task => task.status === 'unreachable').length,
    retries: held.filter(task => task.retryOf != null).length,
    recoveries: held.filter(task => isRecovery(record, task)).length,
    downstreamFailures: downstream.filter(task => task.dependsOn?.some(id => taskIds.has(id))).length,
    meanLatencyMs: meanKnown(terminal.map(task => task.latencyMs)),
    meanHolderSteps: meanKnown(terminal.map(task => task.holderSteps)),
    stepsUsed,
    stepsRemaining: stepsUsed === null ? null : Math.max(0, record.limits.stepBudget - stepsUsed),
    taskIds: recent.map(task => task.id),
    omittedTasks: held.length - recent.length,
    observations,
  }
}

/** Only changed neighbours, lifecycles and settled outcomes justify more context. */
export function materialFingerprint(feedback: readonly LocalPeerFeedback[]): string {
  const material = feedback.map(row => ({
    peerId: row.peerId, lifecycle: row.lifecycle,
    completed: row.completed, failed: row.failed, unreachable: row.unreachable,
    retries: row.retries, recoveries: row.recoveries, downstreamFailures: row.downstreamFailures,
    terminalTaskIds: [...row.terminalTaskIds].sort(),
  })).sort((left, right) => left.peerId.localeCompare(right.peerId))
  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

/** Compatibility name; the fingerprint now excludes continuous activity. */
export const localFeedbackFingerprint = materialFingerprint

function snapshot(record: NetworkRecord, nodeId: string, peerIds: readonly string[], now: number): RewireObservations['before'] {
  return {
    observedAt: now,
    peers: peerIds.map(peerId => {
      const { source: _source, observations: _observations, lifecycle: _lifecycle,
        terminalTaskIds: _terminalTaskIds, ...summary } = summarizeLocalFeedback(record, peerId, { observerId: nodeId, now })
      return summary
    }),
  }
}

/** Freeze pre-rewire observations and initialize the new peer cohort's snapshot. */
export function captureRewireObservations(
  record: NetworkRecord,
  nodeId: string,
  previousPeers: readonly string[],
  nextPeers: readonly string[],
  now: number,
): RewireObservations {
  return {
    causalClaim: false,
    before: snapshot(record, nodeId, previousPeers, now),
    after: snapshot(record, nodeId, nextPeers, now),
  }
}

/**
 * Refresh the latest rewire per caller inside the existing atomic mutation.
 * Older rewires stay frozen when superseded. There is no new model turn, mail,
 * independent write, or claim that different tasks prove a causal improvement.
 */
export function refreshRewireObservations(record: NetworkRecord, now: number): NetworkRecord {
  const history = record.rewireHistory
  if (history === undefined || history.length === 0) return record
  const seen = new Set<string>()
  let changed = false
  const updated = [...history]
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const row = history[index]!
    if (seen.has(row.nodeId)) continue
    seen.add(row.nodeId)
    if (row.observations === undefined) continue
    const after = snapshot(record, row.nodeId, row.nextPeers, now)
    if (JSON.stringify(after.peers) === JSON.stringify(row.observations.after.peers)) continue
    updated[index] = { ...row, observations: { ...row.observations, after } }
    changed = true
  }
  return changed ? { ...record, rewireHistory: updated } : record
}
