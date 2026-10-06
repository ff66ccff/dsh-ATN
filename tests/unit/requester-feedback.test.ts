/** Local feedback closes a decision loop without granting host verification. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { networkRecordSchema, type NetworkRecord, type RequesterFeedback, type TaskRecord } from '../../src/schema.ts'
import { isTaskAccepted, taskResultDigest } from '../../src/tasks.ts'
import { evaluateRewireEvidence, summarizeVerifiedFeedback } from '../../src/verified-feedback.ts'
import { evaluateRequesterRewireEvidence, recordRequesterFeedback, RequesterFeedbackError,
  selectRequesterRewireSamples, summarizeRequesterFeedback, evaluateCumulativeRequesterRewire, refreshRequesterRewireEvidence,
  type RequesterFeedbackInput } from '../../src/requester-feedback.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'

function submitted(id: string, holderId = 'B', overrides: Partial<TaskRecord> = {}): TaskRecord {
  return makeTask(id, { holderId, requesterId: 'A', status: 'completed', settledBy: holderId,
    createdAt: 10, settledAt: 20, result: { summary: 'submitted answer', evidence: ['artifact:answer'] }, ...overrides })
}

function network(...tasks: TaskRecord[]): NetworkRecord {
  const record = makeChain(['A', 'B', 'C', 'D', 'E'], { tasks: Object.fromEntries(tasks.map(task => [task.id, task])) })
  // Original comparison-contract fixtures exercise the configurable one-sample case.
  return { ...record, limits: { ...record.limits, requesterMinSamples: 1 } }
}

const review: RequesterFeedbackInput = {
  taskId: 'task', status: 'accepted', summary: 'Matches my request.', evidence: ['check:local'], comparisonKey: 'same-contract-v1',
}

function rated(id: string, holderId: string, status: RequesterFeedback['status'] = 'accepted',
  options: { requesterId?: string; comparisonKey?: string; checkedAt?: number } = {}): TaskRecord {
  const task = submitted(id, holderId, { requesterId: options.requesterId ?? 'A' })
  return recordRequesterFeedback(network(task), task.requesterId,
    { ...review, taskId: id, status, comparisonKey: options.comparisonKey ?? review.comparisonKey }, options.checkedAt ?? 30).task
}

const edges = { requesterId: 'A', previousPeers: ['B'], nextPeers: ['C'] }
const samples = { ...edges, baselineTaskIds: ['old'], candidateTaskIds: ['new'] }

test('requester opinions are durable, digest-bound, immutable inputs and never host acceptance', () => {
  const before = network(submitted('task'))
  const result = recordRequesterFeedback(before, 'A', review, 30)
  assert.equal(before.tasks.task.localFeedback, undefined)
  assert.equal(result.feedback.requesterId, 'A')
  assert.equal(result.feedback.resultDigest, taskResultDigest(result.task))
  assert.equal(result.feedback.checkedAt, 30)
  assert.equal(result.task.acceptance, undefined)
  assert.equal(isTaskAccepted(result.task), false)
  assert.deepEqual(networkRecordSchema.parse(result.record).tasks.task.localFeedback, result.feedback)
  assert.equal(summarizeVerifiedFeedback(result.record, 'B').passed, 0)
  assert.equal(summarizeVerifiedFeedback(result.record, 'B').unverified, 1)
  assert.deepEqual(result.record.mails, before.mails, 'a local opinion neither delivers mail nor wakes its holder')
  assert.deepEqual(result.record.nodes, before.nodes)
  assert.equal(result.record.stepsUsed, before.stepsUsed)
})

test('only the requester can rate an actual completed submission from another holder', () => {
  assert.throws(() => recordRequesterFeedback(network(submitted('task')), 'C', review, 30),
    { name: 'RequesterFeedbackError', code: 'not-requester' })
  assert.throws(() => recordRequesterFeedback(network(submitted('task', 'A')), 'A', review, 30),
    { name: 'RequesterFeedbackError', code: 'self-rating' })
  assert.throws(() => recordRequesterFeedback(network(), 'A', review, 30),
    { name: 'RequesterFeedbackError', code: 'unknown-task' })
  for (const overrides of [
    { status: 'open' as const }, { status: 'failed' as const }, { status: 'unreachable' as const },
    { result: null }, { settledAt: null }, { settledBy: null }, { settledBy: 'D' }, { kind: 'delivery' as const },
  ]) assert.throws(() => recordRequesterFeedback(network(submitted('task', 'B', overrides)), 'A', review, 30),
    { name: 'RequesterFeedbackError', code: 'not-submitted' })
})

test('exact retries are idempotent; needs-more may resolve once under its original contract', () => {
  const pending = { ...review, status: 'needs-more' as const, summary: 'Need a source for the claim.' }
  const first = recordRequesterFeedback(network(submitted('task')), 'A', pending, 30)
  const retry = recordRequesterFeedback(first.record, 'A', pending, 40)
  assert.equal(retry.record, first.record)
  assert.equal(retry.feedback.checkedAt, 30)
  assert.throws(() => recordRequesterFeedback(first.record, 'A', { ...pending, summary: 'Different pending assessment' }, 40),
    { code: 'already-reviewed' })
  assert.throws(() => recordRequesterFeedback(first.record, 'A', { ...review, comparisonKey: 'easier-contract' }, 40),
    { code: 'already-reviewed' })
  const terminal = recordRequesterFeedback(first.record, 'A', review, 40)
  assert.equal(terminal.feedback.status, 'accepted')
  assert.equal(terminal.feedback.checkedAt, 40)
  assert.equal(recordRequesterFeedback(terminal.record, 'A', review, 50).record, terminal.record)
  for (const input of [{ ...review, status: 'rejected' as const }, pending, { ...review, summary: 'Rewording' }]) {
    assert.throws(() => recordRequesterFeedback(terminal.record, 'A', input, 50), { code: 'already-reviewed' })
  }
})

test('invalid times, empty claims, oversized references and UTF-8 payloads fail without mutation', () => {
  const record = network(submitted('task'))
  for (const now of [0, 19, Number.NaN, Number.POSITIVE_INFINITY, 20.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => recordRequesterFeedback(record, 'A', review, now), { code: 'invalid-time' })
  }
  for (const input of [
    { ...review, summary: '  ' }, { ...review, summary: 'x'.repeat(1025) },
    { ...review, evidence: [] }, { ...review, evidence: [''] }, { ...review, evidence: ['x'.repeat(513)] },
    { ...review, evidence: Array(9).fill('check') }, { ...review, comparisonKey: 'x'.repeat(161) },
    { ...review, summary: '证'.repeat(1024), evidence: ['据'.repeat(512)] },
  ]) assert.throws(() => recordRequesterFeedback(record, 'A', input, 30), { code: 'invalid-feedback' })
  assert.throws(() => recordRequesterFeedback({ ...record, limits: { ...record.limits, maxMessageBytes: 64 } }, 'A', review, 30),
    { code: 'invalid-feedback' })
  assert.equal(record.tasks.task.localFeedback, undefined)
})

test('a changed submission or forged requester cannot retain a valid feedback signal', () => {
  const original = rated('task', 'B')
  const changed = { ...original, result: { summary: 'changed submission', evidence: [] } }
  assert.equal(summarizeRequesterFeedback(network(changed), 'B').accepted, 0)
  assert.throws(() => recordRequesterFeedback(network(changed), 'A', review, 40), { code: 'stale-feedback' })
  const forged = { ...original, localFeedback: { ...original.localFeedback!, requesterId: 'D' } }
  assert.equal(summarizeRequesterFeedback(network(forged), 'B').accepted, 0)
  const delegated = { ...original, settledBy: 'D' }
  delegated.localFeedback = { ...delegated.localFeedback!, resultDigest: taskResultDigest(delegated) }
  assert.equal(summarizeRequesterFeedback(network(delegated), 'B').accepted, 0)
})

test('feedback separates pending requests from rejection and bounds local samples deterministically', () => {
  const record = network(rated('accepted', 'B'), rated('rejected', 'B', 'rejected'), rated('pending', 'B', 'needs-more'),
    submitted('unrated'), makeTask('open'), rated('foreign', 'B', 'accepted', { requesterId: 'D' }))
  const summary = summarizeRequesterFeedback(record, 'B', { observerId: 'A' })
  assert.equal(summary.source, 'requester')
  assert.equal(summary.accepted, 1)
  assert.equal(summary.rejected, 1)
  assert.equal(summary.needsMore, 1)
  assert.equal(summary.unrated, 1)
  assert.equal(summary.acceptanceRate, 0.5)
  assert.equal(summary.openTasks, 1)
  assert.equal(summarizeRequesterFeedback(network(rated('pending', 'B', 'needs-more')), 'B').acceptanceRate, null)
  const many = Array.from({ length: 12 }, (_, index) => rated(`task-${index}`, 'B'))
  const forward = summarizeRequesterFeedback(network(...many), 'B', { maxTasks: Number.POSITIVE_INFINITY })
  const reverse = summarizeRequesterFeedback(network(...many.toReversed()), 'B', { maxTasks: 100 })
  assert.deepEqual(forward, reverse)
  assert.equal(forward.taskIds.length, 8)
  assert.equal(forward.omittedTasks, 4)
})

test('matched requester opinions support a quality-only comparison while host verdict stays insufficient', () => {
  const record = network(rated('old', 'B', 'rejected'), rated('new', 'C'))
  const result = evaluateRequesterRewireEvidence(record, samples)
  assert.equal(result.verdict, 'observed-improvement')
  assert.equal(result.delta.acceptanceRate, 1)
  assert.equal(result.qualityOnly, true)
  assert.equal(result.causalClaim, false)
  assert.equal(result.source, 'requester')
  assert.equal(evaluateRewireEvidence(record, samples).verdict, 'insufficient-evidence')
  assert.equal(evaluateRequesterRewireEvidence(record, {
    requesterId: 'A', previousPeers: ['C'], nextPeers: ['B'], baselineTaskIds: ['new'], candidateTaskIds: ['old'],
  }).verdict, 'observed-regression')
  assert.equal(evaluateRequesterRewireEvidence(network(rated('old', 'B'), rated('new', 'C')), samples).verdict, 'unchanged')
})

test('a late review of an older submission enters the bounded feedback snapshot', () => {
  const old = submitted('old')
  const newer = Array.from({ length: 10 }, (_, index) => submitted(`new-${index}`, 'B', { settledAt: 100 + index }))
  const original = network(old, ...newer)
  assert.ok(!summarizeRequesterFeedback(original, 'B').taskIds.includes('old'))
  const reviewed = recordRequesterFeedback(original, 'A', { ...review, taskId: 'old' }, 500).record
  const summary = summarizeRequesterFeedback(reviewed, 'B')
  assert.equal(summary.taskIds[0], 'old')
  assert.equal(summary.accepted, 1)
  assert.equal(summary.omittedTasks, 3)
})

test('pending, unlike contracts, forged ratings and unrelated peers cannot certify an edge choice', () => {
  for (const candidate of [
    rated('new', 'C', 'needs-more'), submitted('new', 'C'),
    rated('new', 'C', 'accepted', { requesterId: 'D' }),
    rated('new', 'C', 'accepted', { comparisonKey: 'easier-contract' }), rated('new', 'D'),
  ]) {
    const result = evaluateRequesterRewireEvidence(network(rated('old', 'B', 'rejected'), candidate), samples)
    assert.equal(result.verdict, 'insufficient-evidence')
    assert.equal(result.delta.acceptanceRate, null)
  }
  const record = network(rated('old', 'B', 'rejected'), rated('new', 'C'))
  for (const input of [
    { ...samples, nextPeers: ['C', 'D'] }, { ...samples, previousPeers: ['B', 'C'], nextPeers: ['C', 'D'] },
    { ...samples, candidateTaskIds: [] }, { ...samples, candidateTaskIds: ['new', 'new'] },
    { ...samples, candidateTaskIds: ['old'] }, { ...samples, candidateTaskIds: ['missing'] },
    { ...samples, candidateTaskIds: Array(100).fill('new') },
  ]) {
    const result = evaluateRequesterRewireEvidence(record, input)
    assert.equal(result.verdict, 'insufficient-evidence')
    assert.equal(result.delta.acceptanceRate, null)
    assert.ok(result.candidateTaskIds.length <= 8)
  }
})

test('host rejection suppresses contradictory positive local signals while preserving both opinions', () => {
  const accepted = rated('new', 'C')
  const hostRejected: TaskRecord = { ...accepted, acceptance: {
    status: 'failed', validatorId: 'exact-oracle', summary: 'Wrong answer', evidence: ['oracle:failure'],
    resultDigest: taskResultDigest(accepted), checkedAt: 40,
  } }
  const record = network(rated('old', 'B', 'rejected'), hostRejected)
  const summary = summarizeRequesterFeedback(record, 'C')
  assert.equal(summary.accepted, 0)
  assert.equal(summary.rejected, 0, 'the host opinion must not be relabeled as requester rejection')
  assert.equal(summary.unrated, 1)
  assert.equal(summary.observations[0].hostRejected, true)
  assert.equal(record.tasks.new.localFeedback?.status, 'accepted')
  assert.equal(evaluateRequesterRewireEvidence(record, samples).verdict, 'insufficient-evidence')
  assert.deepEqual(selectRequesterRewireSamples(record, edges), { baselineTaskIds: ['old'], candidateTaskIds: [] })
})

test('automatic evidence uses recent symmetric same-contract samples and covers every changed peer', () => {
  const record = network(rated('old-b', 'B', 'rejected'), rated('old-d', 'D', 'rejected'),
    rated('new-c', 'C'), rated('new-e', 'E'), rated('old-extra', 'B'),
    rated('unmatched-key', 'C', 'accepted', { comparisonKey: 'different', checkedAt: 100 }))
  const changes = { requesterId: 'A', previousPeers: ['B', 'D'], nextPeers: ['C', 'E'] }
  const picked = selectRequesterRewireSamples(record, changes)
  assert.equal(picked.baselineTaskIds.length, 2)
  assert.equal(picked.candidateTaskIds.length, 2)
  assert.ok(picked.baselineTaskIds.includes('old-d'))
  assert.deepEqual(picked.candidateTaskIds, ['new-c', 'new-e'])
  assert.equal(evaluateRequesterRewireEvidence(record, { ...changes, ...picked }).verdict, 'observed-improvement')
  assert.deepEqual(selectRequesterRewireSamples(network(...Object.values(record.tasks).toReversed()), changes), picked)
  assert.deepEqual(selectRequesterRewireSamples(network(rated('old', 'B'), rated('new', 'C')), changes),
    { baselineTaskIds: [], candidateTaskIds: [] })
})

test('legacy records remain loadable without local feedback or knowledge publications', () => {
  const parsed = networkRecordSchema.parse(network(submitted('task')))
  assert.equal(parsed.tasks.task.localFeedback, undefined)
  assert.equal(parsed.nodes.B.knowledgeFingerprint, undefined)
  assert.equal(summarizeRequesterFeedback(parsed, 'B').acceptanceRate, null)
  assert.ok(RequesterFeedbackError.prototype instanceof Error)
})

test('cumulative edge counts retain all ratings while displayed sample ids remain bounded', () => {
  const tasks = Array.from({ length: 12 }, (_, index) => [
    rated(`old-${index}`, 'B', 'rejected'), rated(`new-${index}`, 'C', 'accepted'),
  ]).flat()
  const original = network(...tasks)
  const record = refreshRequesterRewireEvidence({ ...original, limits: { ...original.limits, requesterMinSamples: 2 } }, 50)
  assert.equal(record.requesterEdges?.length, 2)
  assert.ok(record.requesterEdges?.every(edge => edge.sampleCount === 12 && edge.taskIds.length === 12))
  const result = evaluateCumulativeRequesterRewire(record, edges, 50)
  assert.equal(result.baseline.rejected, 12)
  assert.equal(result.candidate.accepted, 12)
  assert.equal(result.baselineTaskIds.length, 8)
  assert.equal(result.candidateTaskIds.length, 8)
  assert.equal(result.verdict, 'observed-improvement')
  assert.deepEqual(networkRecordSchema.parse(record).requesterEdges, record.requesterEdges)
})

test('cumulative minimum is per edge, per contract and terminal submissions; pending reviews never pad it', () => {
  const original = network(rated('old-1', 'B', 'rejected'), rated('old-2', 'B', 'rejected'),
    rated('new-1', 'C'), rated('new-pending', 'C', 'needs-more'),
    rated('new-other-contract', 'C', 'accepted', { comparisonKey: 'different-contract' }))
  const record = { ...original, limits: { ...original.limits, requesterMinSamples: 2 } }
  const result = evaluateCumulativeRequesterRewire(record, edges, 50)
  assert.equal(result.verdict, 'insufficient-evidence')
  assert.ok(result.reasons.includes('candidate-below-minimum-samples'))
  assert.ok(result.reasons.includes('pending-requester-feedback'))
  const resolved = recordRequesterFeedback(record, 'A', { ...review, taskId: 'new-pending' }, 60).record
  const comparable = evaluateCumulativeRequesterRewire(resolved, edges, 60)
  assert.equal(comparable.verdict, 'observed-improvement')
  assert.equal(comparable.candidate.accepted, 2)
  assert.equal(resolved.requesterEdges?.find(edge => edge.holderId === 'C' && edge.comparisonKey === review.comparisonKey)?.sampleCount, 2)
})
