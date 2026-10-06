/** A descriptive discovery index must never manufacture correctness or popularity. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { KnowledgeError, publishKnowledge, scoreKnowledgeQuery, summarizeKnowledge } from '../../src/knowledge.ts'
import {
  MAX_KNOWLEDGE_ITEMS, MAX_KNOWLEDGE_TEXT_LENGTH, networkRecordSchema, nodeRecordSchema,
  type RequesterFeedback, type TaskRecord,
} from '../../src/schema.ts'
import { taskResultDigest } from '../../src/tasks.ts'
import { makeChain, makeNode, makeTask } from '../fixtures/network.ts'

const empty = { documents: [], topics: [], contributions: [] }

function rated(id: string, status: RequesterFeedback['status'], overrides: Partial<TaskRecord> = {}): TaskRecord {
  const task = makeTask(id, {
    status: 'completed', result: { summary: 'submitted result', evidence: ['result.json'] },
    settledAt: 20, settledBy: 'B', ...overrides,
  })
  task.localFeedback = {
    status, requesterId: task.requesterId, summary: 'Checked against the requested local evidence.',
    evidence: ['requester-check.json'], comparisonKey: 'lookup-v1', resultDigest: taskResultDigest(task), checkedAt: 25,
  }
  return task
}

test('knowledge publication replaces the bounded index without mail, steps, tasks or peer mutation', () => {
  const record = makeChain(['A', 'B'])
  const next = publishKnowledge(record, 'B', {
    documents: [' docs/slot-5.md ', 'docs/slot-5.md'],
    topics: ['Slot 5', 'slot 5'], contributions: ['Validated local subtotal'],
  }, 10)
  assert.equal(record.nodes.B.knowledgeFingerprint, undefined)
  assert.equal(next.nodes.A, record.nodes.A)
  assert.equal(next.tasks, record.tasks)
  assert.equal(next.mails, record.mails)
  assert.equal(next.stepsUsed, record.stepsUsed)
  assert.equal(next.nodes.B.stepsUsed, record.nodes.B.stepsUsed)
  assert.deepEqual(next.nodes.B.knowledgeFingerprint, {
    documents: ['docs/slot-5.md'], topics: ['Slot 5'], contributions: ['Validated local subtotal'], updatedAt: 10,
  })
  assert.equal(publishKnowledge(next, 'B', {
    documents: ['docs/slot-5.md'], topics: ['Slot 5'], contributions: ['Validated local subtotal'],
  }, 11), next, 'an identical replacement does not churn timestamps')
  const cleared = publishKnowledge(next, 'B', empty, 12)
  assert.deepEqual(cleared.nodes.B.knowledgeFingerprint, { ...empty, updatedAt: 12 })
  assert.deepEqual(networkRecordSchema.parse(next), next)
})

test('publication refuses invalid bounds and ratings instead of silently clipping or accepting popularity', () => {
  const record = makeChain(['A', 'B'])
  for (const input of [
    { ...empty, documents: Array.from({ length: MAX_KNOWLEDGE_ITEMS + 1 }, (_, index) => `doc-${index}`) },
    { ...empty, topics: ['a'.repeat(MAX_KNOWLEDGE_TEXT_LENGTH + 1)] },
    { ...empty, contributions: [' '] },
    { ...empty, requesterAccepted: 1000 },
    { ...empty, hostPassed: 1000 },
  ]) {
    assert.throws(() => publishKnowledge(record, 'B', input, 10),
      (error: unknown) => error instanceof KnowledgeError && error.code === 'invalid-knowledge')
  }
  assert.equal(record.nodes.B.knowledgeFingerprint, undefined)
  assert.throws(() => publishKnowledge(record, 'B', empty, Number.NaN), /invalid/i)
  assert.throws(() => publishKnowledge(record, 'B', empty, -1), KnowledgeError)
  assert.equal(nodeRecordSchema.parse(makeNode('B')).knowledgeFingerprint, undefined, 'legacy records still load')
})

test('only active published callers in an open live network can publish', () => {
  const record = makeChain(['A', 'B'])
  assert.throws(() => publishKnowledge(record, 'missing', empty, 0), /not part of the network/)
  assert.throws(() => publishKnowledge({ ...record, status: 'completed' }, 'B', empty, 0), /open network/)
  assert.throws(() => publishKnowledge(record, 'B', empty, record.deadlineAt), /open network/)
  for (const lifecycle of ['provisioning', 'draining', 'failed', 'retired'] as const) {
    assert.throws(() => publishKnowledge({ ...record, nodes: {
      ...record.nodes, B: { ...record.nodes.B, lifecycle },
    } }, 'B', empty, 0), /active published node/)
  }
  assert.throws(() => publishKnowledge({ ...record, nodes: {
    ...record.nodes, B: { ...record.nodes.B, creationState: 'pending' },
  } }, 'B', empty, 0), /active published node/)
})

test('fingerprints distinguish identical generic tasks using documents, topics and contributions', () => {
  let record = makeChain(['A', 'B', 'C', 'D'])
  for (const holderId of ['B', 'C', 'D']) record.tasks[holderId] = makeTask(holderId, {
    holderId, description: 'Contribute to the shared objective using your local evidence.',
  })
  assert.equal(scoreKnowledgeQuery(record, 'B', 'slot 5'), 0)
  record = publishKnowledge(record, 'B', { ...empty, documents: ['docs/amber-source.md'], topics: ['slot 5'] }, 10)
  record = publishKnowledge(record, 'C', { ...empty, topics: ['slot 6'] }, 10)
  record = publishKnowledge(record, 'D', { ...empty, contributions: ['Joined witness map'] }, 10)
  assert.ok(scoreKnowledgeQuery(record, 'B', '  SLOT   5  ') > scoreKnowledgeQuery(record, 'C', 'slot 5'))
  assert.ok(scoreKnowledgeQuery(record, 'B', 'amber-source') > 0)
  assert.equal(scoreKnowledgeQuery(record, 'C', 'amber-source'), 0)
  assert.ok(scoreKnowledgeQuery(record, 'D', 'witness map') > 0)
  assert.equal(scoreKnowledgeQuery(record, 'B', ''), 0)
  assert.equal(scoreKnowledgeQuery(record, 'B', '*'), 1)
  assert.equal(scoreKnowledgeQuery(record, 'missing', '*'), 0)
})

test('legacy task context and results remain searchable without frequency-based score inflation', () => {
  const record = makeChain(['A', 'B'])
  record.tasks.one = makeTask('one', { context: 'Cobalt source', result: { summary: 'Witness map', evidence: [] } })
  assert.ok(scoreKnowledgeQuery(record, 'B', 'local thing') > 0)
  assert.ok(scoreKnowledgeQuery(record, 'B', 'cobalt') > 0)
  assert.ok(scoreKnowledgeQuery(record, 'B', 'witness') > 0)
  const originalScore = scoreKnowledgeQuery(record, 'B', 'cobalt')
  for (let index = 0; index < 10; index++) record.tasks[`repeat-${index}`] = makeTask(`repeat-${index}`, { context: 'Cobalt source' })
  assert.equal(scoreKnowledgeQuery(record, 'B', 'cobalt'), originalScore)
  let next = publishKnowledge(record, 'B', { ...empty, topics: ['cobalt'] }, 10)
  const declaredScore = scoreKnowledgeQuery(next, 'B', 'cobalt')
  next = publishKnowledge(next, 'B', { documents: ['cobalt'], topics: ['cobalt'], contributions: ['cobalt cobalt'] }, 11)
  assert.equal(scoreKnowledgeQuery(next, 'B', 'cobalt'), declaredScore)
})

test('knowledge separates requester opinions, host checks, declared claims and runtime load', () => {
  let record = publishKnowledge(makeChain(['A', 'B', 'C']), 'B', {
    ...empty, contributions: ['I have 1000 accepted contributions'],
  }, 10)
  record.tasks = {
    accepted: rated('accepted', 'accepted'), rejected: rated('rejected', 'rejected'),
    uncertain: rated('uncertain', 'needs-more'), open: makeTask('open'),
    unreviewed: makeTask('unreviewed', { status: 'completed', settledAt: 20 }),
  }
  const checked = record.tasks.accepted
  checked.acceptance = { status: 'passed', validatorId: 'fixture-v1', summary: 'Independent exact check',
    evidence: ['host.json'], resultDigest: taskResultDigest(checked), checkedAt: 30 }
  const summary = summarizeKnowledge(record, 'B')
  assert.equal(summary.source, 'self-reported')
  assert.equal(summary.requesterAccepted, 1)
  assert.equal(summary.requesterRejected, 1)
  assert.equal(summary.requesterNeedsMore, 1)
  assert.equal(summary.requesterAcceptanceRate, 0.5)
  assert.equal(summary.hostPassed, 1)
  assert.equal(summary.hostFailed, 0)
  assert.equal(summary.currentLoad, 1)
  assert.equal(summary.updatedAt, 10)
  assert.deepEqual(summary.contributions, ['I have 1000 accepted contributions'])
  summary.contributions.push('mutated')
  assert.equal(record.nodes.B.knowledgeFingerprint!.contributions.length, 1)
  const legacy = summarizeKnowledge(record, 'C')
  assert.deepEqual(legacy.documents, [])
  assert.equal(legacy.updatedAt, null)
  assert.equal(legacy.requesterAcceptanceRate, null)
})

test('stale digests, self-ratings, host-rejected submissions and nonholder settlement add no positive reputation', () => {
  const record = makeChain(['A', 'B', 'C'])
  const stale = rated('stale', 'accepted')
  stale.result = { summary: 'Changed after review', evidence: [] }
  const rejectedByHost = rated('host-rejected', 'accepted')
  rejectedByHost.acceptance = { status: 'failed', validatorId: 'fixture-v1', summary: 'Independent rejection',
    evidence: ['host.json'], resultDigest: taskResultDigest(rejectedByHost), checkedAt: 30 }
  const forged = rated('forged', 'accepted')
  forged.localFeedback!.requesterId = 'C'
  record.tasks = {
    stale, rejectedByHost, forged,
    self: rated('self', 'accepted', { requesterId: 'B' }),
    proxy: rated('proxy', 'accepted', { settledBy: 'C' }),
  }
  const summary = summarizeKnowledge(record, 'B')
  assert.equal(summary.requesterAccepted, 0)
  assert.equal(summary.requesterAcceptanceRate, null)
  assert.equal(summary.hostPassed, 0)
  assert.equal(summary.hostFailed, 1)
  assert.equal(record.tasks.rejectedByHost.localFeedback!.status, 'accepted', 'host rejection does not rewrite a recorded local opinion')
})
