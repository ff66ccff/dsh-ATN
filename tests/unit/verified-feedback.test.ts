/** Host-validated observations and conservative, reviewable edge comparisons. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import type { NetworkRecord, TaskAcceptanceMetrics, TaskRecord } from '../../src/schema.ts'
import { taskResultDigest } from '../../src/tasks.ts'
import { collaborationPeers, rewireNode } from '../../src/topology.ts'
import {
  evaluateRewireEvidence, MAX_FEEDBACK_TASKS, summarizeVerifiedFeedback,
  type RewireEvidenceInput,
} from '../../src/verified-feedback.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'

function accepted(
  id: string,
  holderId: string,
  options: {
    passed?: boolean
    latencyMs?: number
    cost?: number | null
    metrics?: TaskAcceptanceMetrics
    validatorId?: string
    requesterId?: string
  } = {},
): TaskRecord {
  const task = makeTask(id, {
    holderId, requesterId: options.requesterId ?? 'A',
    status: 'completed', settledBy: holderId,
    createdAt: 100, settledAt: 100 + (options.latencyMs ?? 20),
    result: { summary: 'submitted solution', evidence: ['artifact:solution'] },
  })
  return {
    ...task,
    acceptance: {
      status: options.passed === false ? 'failed' : 'passed',
      validatorId: options.validatorId ?? 'host-check-v1',
      summary: 'Independent fixture verdict', evidence: ['checks:fixture-v1'],
      checkedAt: 200, resultDigest: taskResultDigest(task),
      metrics: options.metrics ?? {
        comparisonKey: 'same-workload-and-budget-v1', cost: options.cost === undefined ? 2 : options.cost, costUnit: 'tokens',
      },
    },
  }
}

function network(...tasks: TaskRecord[]): NetworkRecord {
  return makeChain(['A', 'B', 'C', 'D'], { tasks: Object.fromEntries(tasks.map(task => [task.id, task])) })
}

const input: RewireEvidenceInput = {
  requesterId: 'A', previousPeers: ['B'], nextPeers: ['C'], baselineTaskIds: ['old'], candidateTaskIds: ['new'],
}

test('feedback separates host rejection, unverified completion and self-reported failure', () => {
  const passed = accepted('passed', 'B')
  const failed = accepted('rejected', 'B', { passed: false })
  const claimed = makeTask('claimed', { holderId: 'B', status: 'completed', settledAt: 140,
    result: { summary: 'Every peer agreed, so this must be correct.', evidence: ['peer:agreement'] } })
  const selfFailed = makeTask('self-failed', { holderId: 'B', status: 'failed', settledAt: 160 })
  const open = makeTask('open', { holderId: 'B' })
  const summary = summarizeVerifiedFeedback(network(passed, failed, claimed, selfFailed, open), 'B')
  assert.equal(summary.passed, 1)
  assert.equal(summary.failed, 1)
  assert.equal(summary.unverified, 2)
  assert.equal(summary.submittedFailed, 1)
  assert.equal(summary.openTasks, 1)
  assert.equal(summary.observations.find(row => row.taskId === 'claimed')!.cost, null)
  assert.equal(summary.observations.find(row => row.taskId === 'self-failed')!.status, 'unverified')
})

test('feedback snapshots are bounded, stable across record order, and requester-local when requested', () => {
  const tasks = Array.from({ length: 12 }, (_, index) => accepted(`task-${index.toString().padStart(2, '0')}`, 'B'))
  const foreign = accepted('foreign', 'B', { requesterId: 'D', latencyMs: 40 })
  const first = summarizeVerifiedFeedback(network(...tasks, foreign), 'B', { observerId: 'A', maxTasks: 100 })
  const reordered = summarizeVerifiedFeedback(network(foreign, ...tasks.toReversed()), 'B', { observerId: 'A' })
  assert.deepEqual(first, reordered)
  assert.equal(first.taskIds.length, MAX_FEEDBACK_TASKS)
  assert.equal(first.omittedTasks, 4)
  assert.ok(!first.taskIds.includes('foreign'))
  assert.equal(summarizeVerifiedFeedback(network(...tasks), 'B', { maxTasks: Number.NaN }).taskIds.length, MAX_FEEDBACK_TASKS)
})

test('changed submissions invalidate previous host acceptance and cannot support rewiring', () => {
  const original = accepted('new', 'C')
  const changed: TaskRecord = { ...original, result: { summary: 'different answer', evidence: [] } }
  const record = network(accepted('old', 'B', { passed: false }), changed)
  const summary = summarizeVerifiedFeedback(record, 'C')
  assert.equal(summary.unverified, 1)
  assert.equal(summary.observations[0]!.comparisonKey, null)
  const result = evaluateRewireEvidence(record, input)
  assert.equal(result.verdict, 'insufficient-evidence')
  assert.ok(result.reasons.includes('unverified-results'))
  assert.equal(result.delta.passRate, null)
})

test('a matched-budget quality improvement supports an actual edge change; the reverse is a recorded regression', () => {
  const record = rewireNode(network(accepted('old', 'B', { passed: false }), accepted('new', 'C')), 'A', ['B'])
  const control = structuredClone(record)
  const evaluation = evaluateRewireEvidence(record, input)
  assert.equal(evaluation.verdict, 'observed-improvement')
  assert.deepEqual(evaluation.delta, { passRate: 1, meanLatencyMs: 0, meanCost: 0 })
  assert.equal(evaluation.causalClaim, false)
  assert.deepEqual(evaluation.baselineTaskIds, ['old'])
  assert.deepEqual(evaluation.candidateTaskIds, ['new'])
  const rewired = rewireNode(record, 'A', input.nextPeers)
  assert.deepEqual(collaborationPeers(control.nodes, 'A'), ['B'])
  assert.deepEqual(collaborationPeers(rewired.nodes, 'A'), ['C'])
  const regression = evaluateRewireEvidence(rewired, {
    ...input, previousPeers: ['C'], nextPeers: ['B'], baselineTaskIds: ['new'], candidateTaskIds: ['old'],
  })
  assert.equal(regression.verdict, 'observed-regression')
  assert.equal(regression.delta.passRate, -1)
  assert.deepEqual(rewired.tasks, control.tasks, 'edge selection neither regrades nor rewrites observations')
})

test('efficiency improvements, tradeoffs, and unchanged outcomes remain distinct', () => {
  const old = accepted('old', 'B')
  assert.equal(evaluateRewireEvidence(network(old, accepted('new', 'C', { latencyMs: 10, cost: 1 })), input).verdict,
    'observed-improvement')
  assert.equal(evaluateRewireEvidence(network(old, accepted('new', 'C', { latencyMs: 10, cost: 3 })), input).verdict,
    'mixed')
  assert.equal(evaluateRewireEvidence(network(old, accepted('new', 'C')), input).verdict, 'unchanged')
  assert.equal(evaluateRewireEvidence(network(old, accepted('new', 'C', { passed: false, cost: 1 })), input).verdict,
    'mixed', 'cheap failures do not count as a verified improvement')
})

test('unknown costs and incomparable units cannot become free work or certify an improvement', () => {
  for (const metrics of [
    { comparisonKey: 'same-workload-and-budget-v1' },
    { comparisonKey: 'same-workload-and-budget-v1', cost: null, costUnit: 'tokens' },
    { comparisonKey: 'same-workload-and-budget-v1', cost: 0 },
    { comparisonKey: 'same-workload-and-budget-v1', cost: 0, costUnit: 'USD' },
  ]) {
    const result = evaluateRewireEvidence(network(accepted('old', 'B', { passed: false }), accepted('new', 'C', { metrics })), input)
    assert.equal(result.verdict, 'insufficient-evidence')
    assert.equal(result.delta.meanCost, null)
    assert.ok(result.reasons.includes('unknown-or-incomparable-cost'))
  }
  const free = evaluateRewireEvidence(network(accepted('old', 'B'), accepted('new', 'C', { cost: 0 })), input)
  assert.equal(free.verdict, 'observed-improvement', 'an explicitly measured zero in the same unit is valid')
  assert.equal(free.candidate.meanCost, 0)
})

test('unmatched work, verifier policies and sample counts are not ranked', () => {
  const old = accepted('old', 'B', { passed: false })
  for (const replacement of [
    accepted('new', 'C', { validatorId: 'weaker-check-v2' }),
    accepted('new', 'C', { metrics: { cost: 2, costUnit: 'tokens' } }),
    accepted('new', 'C', { metrics: { comparisonKey: 'easier-task', cost: 2, costUnit: 'tokens' } }),
  ]) {
    const result = evaluateRewireEvidence(network(old, replacement), input)
    assert.equal(result.verdict, 'insufficient-evidence')
    assert.equal(result.delta.passRate, null)
  }
  const record = network(old, accepted('new', 'C'), accepted('new2', 'C'))
  const result = evaluateRewireEvidence(record, { ...input, candidateTaskIds: ['new', 'new2'] })
  assert.equal(result.verdict, 'insufficient-evidence')
  assert.ok(result.reasons.includes('unmatched-sample-counts'))
})

test('retained nodes, unrelated requesters and uncovered new edges cannot lend evidence to an edge replacement', () => {
  const old = accepted('old', 'B', { passed: false })
  const candidate = accepted('new', 'C')
  const record = network(old, candidate, accepted('other', 'D'), accepted('foreign', 'C', { requesterId: 'D' }))
  for (const selection of [
    { ...input, previousPeers: ['B', 'C'], nextPeers: ['C', 'D'] },
    { ...input, candidateTaskIds: ['foreign'] },
    { ...input, nextPeers: ['C', 'D'] },
    { ...input, candidateTaskIds: ['other'] },
  ]) assert.equal(evaluateRewireEvidence(record, selection).verdict, 'insufficient-evidence')
})

test('missing, duplicate, overlapping, empty and oversized evidence is rejected with bounded output', () => {
  const record = network(accepted('old', 'B', { passed: false }), accepted('new', 'C'))
  for (const selection of [
    { ...input, candidateTaskIds: ['missing'] },
    { ...input, candidateTaskIds: ['new', 'new'] },
    { ...input, candidateTaskIds: ['old'] },
    { ...input, candidateTaskIds: [] },
    { ...input, candidateTaskIds: Array.from({ length: 100 }, (_, index) => `task-${index}`) },
  ]) {
    const result = evaluateRewireEvidence(record, selection)
    assert.equal(result.verdict, 'insufficient-evidence')
    assert.ok(result.candidateTaskIds.length <= MAX_FEEDBACK_TASKS)
    assert.equal(result.causalClaim, false)
  }
  const missing = evaluateRewireEvidence(record, { ...input, candidateTaskIds: ['missing'] })
  assert.equal(missing.candidate.unverified, 1)
  assert.equal(missing.candidate.passRate, null)
})

test('missing timestamps remain unknown and host information keys are bounded observations, not a quality score', () => {
  const old = accepted('old', 'B', { passed: false })
  const candidate = accepted('new', 'C', { metrics: {
    comparisonKey: 'same-workload-and-budget-v1', cost: 2, costUnit: 'tokens',
    informationKeys: Array.from({ length: 30 }, (_, index) => `fact-${index}`),
  } })
  const invalidTiming = { ...candidate, settledAt: null }
  // Rebind to exercise timing coverage independently from stale acceptance.
  invalidTiming.acceptance = { ...candidate.acceptance!, resultDigest: taskResultDigest(invalidTiming) }
  const record = network(old, invalidTiming)
  const summary = summarizeVerifiedFeedback(record, 'C')
  assert.equal(summary.observations[0]!.informationKeys.length, MAX_FEEDBACK_TASKS)
  assert.equal(summary.observations[0]!.latencyMs, null)
  const result = evaluateRewireEvidence(record, input)
  assert.equal(result.verdict, 'insufficient-evidence')
  assert.equal(result.delta.meanLatencyMs, null)
})
