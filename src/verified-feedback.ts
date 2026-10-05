/** Bounded, host-validated observations for local collaborator decisions. */
import type { NetworkRecord, TaskRecord } from './schema.ts'
import { taskResultDigest } from './tasks.ts'

/** Each side of a comparison and each peer snapshot has the same finite bound. */
export const MAX_FEEDBACK_TASKS = 8

export interface VerifiedTaskObservation {
  taskId: string
  status: 'passed' | 'failed' | 'unverified'
  validatorId: string | null
  comparisonKey: string | null
  latencyMs: number | null
  cost: number | null
  costUnit: string | null
  informationKeys: string[]
}

export interface VerifiedPeerFeedback {
  taskIds: string[]
  omittedTasks: number
  openTasks: number
  passed: number
  failed: number
  unverified: number
  /** Holder-reported failure is separate from rejection by a host validator. */
  submittedFailed: number
  observations: VerifiedTaskObservation[]
}

export interface FeedbackAggregate {
  passed: number
  failed: number
  unverified: number
  /** Null whenever the sample contains any unverified or missing task. */
  passRate: number | null
  meanLatencyMs: number | null
  /** Null if any cost or its unit is unknown, or units differ. */
  meanCost: number | null
}

export type RewireEvidenceVerdict =
  | 'observed-improvement'
  | 'observed-regression'
  | 'mixed'
  | 'unchanged'
  | 'insufficient-evidence'

export interface RewireEvaluation {
  verdict: RewireEvidenceVerdict
  /** Observations do not establish the causal effect of changing an edge. */
  causalClaim: false
  baselineTaskIds: string[]
  candidateTaskIds: string[]
  comparisonKey: string | null
  validatorId: string | null
  costUnit: string | null
  baseline: FeedbackAggregate
  candidate: FeedbackAggregate
  /** Candidate minus baseline; negative latency/cost means lower observed usage. */
  delta: { passRate: number | null; meanLatencyMs: number | null; meanCost: number | null }
  reasons: string[]
}

export interface RewireEvidenceInput {
  requesterId: string
  previousPeers: readonly string[]
  nextPeers: readonly string[]
  baselineTaskIds: readonly string[]
  candidateTaskIds: readonly string[]
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function observe(task: TaskRecord | undefined, taskId: string): VerifiedTaskObservation {
  const acceptance = task?.acceptance
  const verified = task?.status === 'completed' && task.result !== null &&
    acceptance != null && acceptance.resultDigest === taskResultDigest(task) &&
    nonempty(acceptance.validatorId) && acceptance.evidence.some(nonempty)
  const metrics = verified ? acceptance.metrics : undefined
  const latency = task?.settledAt == null ? null : task.settledAt - task.createdAt
  const costUnit = nonempty(metrics?.costUnit) ? metrics.costUnit : null
  return {
    taskId,
    status: verified ? acceptance.status : 'unverified',
    validatorId: verified ? acceptance.validatorId : null,
    comparisonKey: nonempty(metrics?.comparisonKey) ? metrics.comparisonKey : null,
    latencyMs: finiteNonnegative(latency) ? latency : null,
    cost: costUnit !== null && finiteNonnegative(metrics?.cost) ? metrics.cost : null,
    costUnit,
    informationKeys: [...new Set(metrics?.informationKeys ?? [])].sort().slice(0, MAX_FEEDBACK_TASKS),
  }
}

/**
 * Return recent terminal observations, without ranking unlike tasks or treating
 * a claimed completion as acceptance. Optional observerId limits the snapshot
 * to work this requester actually commissioned, including disconnected peers.
 */
export function summarizeVerifiedFeedback(
  record: NetworkRecord,
  peerId: string,
  options: { observerId?: string; maxTasks?: number } = {},
): VerifiedPeerFeedback {
  const requestedLimit = options.maxTasks ?? MAX_FEEDBACK_TASKS
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(MAX_FEEDBACK_TASKS, Math.trunc(requestedLimit))) : MAX_FEEDBACK_TASKS
  const held = Object.values(record.tasks).filter(task => task.holderId === peerId &&
    (options.observerId === undefined || task.requesterId === options.observerId))
  const terminal = held.filter(task => task.status !== 'open').sort((left, right) =>
    (right.settledAt ?? -1) - (left.settledAt ?? -1) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  const selected = terminal.slice(0, limit)
  const observations = selected.map(task => observe(task, task.id))
  return {
    taskIds: selected.map(task => task.id),
    omittedTasks: terminal.length - selected.length,
    openTasks: held.filter(task => task.status === 'open').length,
    passed: observations.filter(row => row.status === 'passed').length,
    failed: observations.filter(row => row.status === 'failed').length,
    unverified: observations.filter(row => row.status === 'unverified').length,
    submittedFailed: selected.filter(task => task.status === 'failed' || task.status === 'unreachable').length,
    observations,
  }
}

function sameNonempty(values: readonly (string | null)[]): string | null {
  return values.length > 0 && values[0] !== null && values.every(value => value === values[0]) ? values[0]! : null
}

function meanKnown(values: readonly (number | null)[]): number | null {
  if (values.length === 0 || values.some(value => value === null)) return null
  // Divide before summing so even large finite host measurements stay finite.
  return values.reduce<number>((total, value) => total + value! / values.length, 0)
}

function aggregate(rows: readonly VerifiedTaskObservation[]): FeedbackAggregate {
  const passed = rows.filter(row => row.status === 'passed').length
  const failed = rows.filter(row => row.status === 'failed').length
  const unverified = rows.length - passed - failed
  return {
    passed, failed, unverified,
    passRate: rows.length === 0 || unverified > 0 ? null : passed / rows.length,
    meanLatencyMs: meanKnown(rows.map(row => row.latencyMs)),
    meanCost: sameNonempty(rows.map(row => row.costUnit)) === null ? null : meanKnown(rows.map(row => row.cost)),
  }
}

function difference(candidate: number | null, baseline: number | null): number | null {
  return candidate === null || baseline === null ? null : candidate - baseline
}

/**
 * Compare explicit local samples for nodes actually removed and added by this
 * rewire. The host declares comparable work/budgets via comparisonKey. Complete
 * acceptance and cost coverage are required for a Pareto improvement; missing
 * measurements are never replaced by zero. This neither chooses fixed roles
 * nor proves future or causal benefit. All cited task ids remain reviewable.
 */
export function evaluateRewireEvidence(record: NetworkRecord, input: RewireEvidenceInput): RewireEvaluation {
  const reasons: string[] = []
  if (input.baselineTaskIds.length > MAX_FEEDBACK_TASKS || input.candidateTaskIds.length > MAX_FEEDBACK_TASKS) {
    reasons.push('sample-limit-exceeded')
  }
  // Refuse over-sized evidence rather than accepting a silently chosen subset.
  const baselineTaskIds = [...new Set(input.baselineTaskIds.slice(0, MAX_FEEDBACK_TASKS))].sort()
  const candidateTaskIds = [...new Set(input.candidateTaskIds.slice(0, MAX_FEEDBACK_TASKS))].sort()
  if (baselineTaskIds.length !== input.baselineTaskIds.length || candidateTaskIds.length !== input.candidateTaskIds.length) {
    if (!reasons.includes('sample-limit-exceeded')) reasons.push('duplicate-task-ids')
  }
  if (baselineTaskIds.length === 0 || candidateTaskIds.length === 0) reasons.push('empty-sample')
  if (baselineTaskIds.length !== candidateTaskIds.length) reasons.push('unmatched-sample-counts')
  if (baselineTaskIds.some(id => candidateTaskIds.includes(id))) reasons.push('overlapping-samples')

  const removed = input.previousPeers.filter(id => !input.nextPeers.includes(id))
  const added = input.nextPeers.filter(id => !input.previousPeers.includes(id))
  const checkLocal = (ids: readonly string[], peers: readonly string[], side: string): void => {
    if (ids.some(id => record.tasks[id] === undefined)) reasons.push(`${side}-unknown-task`)
    if (ids.some(id => {
      const task = record.tasks[id]
      return task !== undefined && (task.requesterId !== input.requesterId || !peers.includes(task.holderId) ||
        (task.settledBy !== null && task.settledBy !== task.holderId))
    })) reasons.push(`${side}-not-local-edge-evidence`)
    if (peers.some(id => !ids.some(taskId => record.tasks[taskId]?.holderId === id))) reasons.push(`${side}-uncovered-peer`)
  }
  checkLocal(baselineTaskIds, removed, 'baseline')
  checkLocal(candidateTaskIds, added, 'candidate')

  const baselineRows = baselineTaskIds.map(id => observe(record.tasks[id], id))
  const candidateRows = candidateTaskIds.map(id => observe(record.tasks[id], id))
  const rows = [...baselineRows, ...candidateRows]
  const baseline = aggregate(baselineRows)
  const candidate = aggregate(candidateRows)
  const comparisonKey = sameNonempty(rows.map(row => row.comparisonKey))
  const validatorId = sameNonempty(rows.map(row => row.validatorId))
  const costUnit = sameNonempty(rows.map(row => row.costUnit))
  if (baseline.unverified + candidate.unverified > 0) reasons.push('unverified-results')
  if (comparisonKey === null) reasons.push('missing-or-different-comparison-key')
  if (validatorId === null) reasons.push('missing-or-different-validator')
  if (baseline.meanLatencyMs === null || candidate.meanLatencyMs === null) reasons.push('unknown-latency')
  if (baseline.meanCost === null || candidate.meanCost === null || costUnit === null) reasons.push('unknown-or-incomparable-cost')
  const delta = {
    passRate: comparisonKey !== null && validatorId !== null ? difference(candidate.passRate, baseline.passRate) : null,
    meanLatencyMs: comparisonKey !== null ? difference(candidate.meanLatencyMs, baseline.meanLatencyMs) : null,
    meanCost: comparisonKey !== null && costUnit !== null ? difference(candidate.meanCost, baseline.meanCost) : null,
  }
  let verdict: RewireEvidenceVerdict = 'insufficient-evidence'
  if (reasons.length === 0) {
    const gains = [delta.passRate!, -delta.meanLatencyMs!, -delta.meanCost!]
    const better = gains.some(value => value > 0)
    const worse = gains.some(value => value < 0)
    verdict = better && worse ? 'mixed' : better ? 'observed-improvement' : worse ? 'observed-regression' : 'unchanged'
  }
  return {
    verdict, causalClaim: false, baselineTaskIds, candidateTaskIds,
    comparisonKey, validatorId, costUnit, baseline, candidate, delta, reasons,
  }
}
