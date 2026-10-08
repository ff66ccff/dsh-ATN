/** A descriptive discovery index must never manufacture correctness or popularity. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { refreshKnowledge, scoreKnowledgeQuery, summarizeKnowledge, type KnowledgeMetadata } from '../../src/knowledge.ts'
import { defineCustodyPolicy } from '../../src/information-boundary.ts'
import {
  MAX_KNOWLEDGE_ITEMS, MAX_KNOWLEDGE_TEXT_LENGTH, networkRecordSchema, nodeRecordSchema,
  type RequesterFeedback, type TaskRecord,
} from '../../src/schema.ts'
import { taskResultDigest } from '../../src/tasks.ts'
import { makeChain, makeNode, makeTask } from '../fixtures/network.ts'

const empty: KnowledgeMetadata = { documents: [], topics: [], contributions: [] }

/** Trusted host fixture; the production API has no agent publication path. */
function hostProjection(record: ReturnType<typeof makeChain>, nodeId: string,
  input: typeof empty, now: number) {
  return refreshKnowledge(record, defineCustodyPolicy({
    custody: id => id === nodeId ? input.documents : record.nodes[id]?.knowledgeFingerprint?.documents ?? [],
    extractClaims: () => [],
    describeArtifact: id => ({ topics: input.documents.includes(id) ? input.topics : Object.values(record.nodes)
      .filter(node => node.knowledgeFingerprint?.documents.includes(id)).flatMap(node => node.knowledgeFingerprint!.topics) }),
  }), now)
}

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

test('host custody projection replaces the bounded index without mail, steps, tasks or peer edges', () => {
  const record = makeChain(['A', 'B'])
  const next = hostProjection(record, 'B', {
    documents: ['docs/slot-5.md', 'docs/slot-5.md'],
    topics: ['slot 5', 'slot 5'], contributions: ['Untrusted claim is discarded'],
  }, 10)
  assert.equal(record.nodes.B.knowledgeFingerprint, undefined)
  assert.deepEqual(next.nodes.A.peerIds, record.nodes.A.peerIds)
  assert.equal(next.tasks, record.tasks)
  assert.equal(next.mails, record.mails)
  assert.equal(next.stepsUsed, record.stepsUsed)
  assert.equal(next.nodes.B.stepsUsed, record.nodes.B.stepsUsed)
  assert.deepEqual(next.nodes.B.knowledgeFingerprint, {
    source: 'host-custody', documents: ['docs/slot-5.md'], topics: ['slot 5'], contributions: [], updatedAt: 10,
  })
  assert.equal(hostProjection(next, 'B', {
    documents: ['docs/slot-5.md'], topics: ['slot 5'], contributions: [],
  }, 11), next, 'an identical replacement does not churn timestamps')
  const cleared = hostProjection(next, 'B', empty, 12)
  assert.deepEqual(cleared.nodes.B.knowledgeFingerprint, { ...empty, source: 'host-custody', updatedAt: 12 })
  assert.deepEqual(networkRecordSchema.parse(next), next)
})

test('discovery is bounded without truncating the policy custody set or accepting legacy popularity', () => {
  const record = makeChain(['A', 'B'])
  const documents = Array.from({ length: MAX_KNOWLEDGE_ITEMS + 1 }, (_, index) => `doc-${index}`)
  const policy = defineCustodyPolicy({ custody: () => documents, extractClaims: () => [documents.at(-1)!],
    describeArtifact: () => ({ topics: ['a'.repeat(MAX_KNOWLEDGE_TEXT_LENGTH + 1)] }) })
  const next = refreshKnowledge(record, policy, 10)
  assert.equal(next.nodes.B.knowledgeFingerprint?.documents.length, MAX_KNOWLEDGE_ITEMS)
  assert.deepEqual(next.nodes.B.knowledgeFingerprint?.topics, [])
  assert.doesNotThrow(() => policy(record, record.nodes.B, { channel: 'send.note', input: { to: 'A', kind: 'note', body: '' } }))
  assert.equal(record.nodes.B.knowledgeFingerprint, undefined)
  assert.equal(nodeRecordSchema.parse(makeNode('B')).knowledgeFingerprint, undefined, 'legacy records still load')
})

test('unmarked legacy self-reports cannot supply discovery metadata or claim custody', () => {
  const record = makeChain(['A', 'B'])
  record.nodes.B.knowledgeFingerprint = { documents: ['foreign.json'], topics: ['forged-topic'], contributions: ['1000 accepted'], updatedAt: 10 }
  assert.deepEqual(summarizeKnowledge(record, 'B').documents, [])
  assert.deepEqual(summarizeKnowledge(record, 'B').topics, [])
  assert.deepEqual(summarizeKnowledge(record, 'B').contributions, [])
  assert.equal(scoreKnowledgeQuery(record, 'B', 'foreign'), 0)
  assert.deepEqual(summarizeKnowledge(record, 'missing').documents, [])
})

test('host fingerprints distinguish identical generic tasks using documents and topics', () => {
  let record = makeChain(['A', 'B', 'C', 'D'])
  for (const holderId of ['B', 'C', 'D']) record.tasks[holderId] = makeTask(holderId, {
    holderId, description: 'Contribute to the shared objective using your local evidence.',
  })
  assert.equal(scoreKnowledgeQuery(record, 'B', 'slot 5'), 0)
  record = hostProjection(record, 'B', { ...empty, documents: ['docs/amber-source.md'], topics: ['slot 5'] }, 10)
  record = hostProjection(record, 'C', { ...empty, documents: ['docs/slot-6.md'], topics: ['slot 6'] }, 10)
  record = hostProjection(record, 'D', { ...empty, documents: ['docs/witness map'], topics: ['Joined witness map'] }, 10)
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
  let next = hostProjection(record, 'B', { ...empty, documents: ['cobalt'], topics: ['cobalt'] }, 10)
  const declaredScore = scoreKnowledgeQuery(next, 'B', 'cobalt')
  next = hostProjection(next, 'B', { documents: ['cobalt'], topics: ['cobalt'], contributions: ['cobalt cobalt'] }, 11)
  assert.equal(scoreKnowledgeQuery(next, 'B', 'cobalt'), declaredScore)
})

test('knowledge separates requester opinions, host checks, custody metadata and runtime load', () => {
  let record = hostProjection(makeChain(['A', 'B', 'C']), 'B', {
    ...empty, documents: ['own.json'], contributions: ['I have 1000 accepted contributions'],
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
  assert.equal(summary.source, 'host-custody')
  assert.equal(summary.requesterAccepted, 1)
  assert.equal(summary.requesterRejected, 1)
  assert.equal(summary.requesterNeedsMore, 1)
  assert.equal(summary.requesterAcceptanceRate, 0.5)
  assert.equal(summary.hostPassed, 1)
  assert.equal(summary.hostFailed, 0)
  assert.equal(summary.currentLoad, 1)
  assert.equal(summary.updatedAt, 10)
  assert.deepEqual(summary.contributions, [])
  summary.documents.push('mutated')
  assert.equal(record.nodes.B.knowledgeFingerprint!.documents.length, 1)
  const legacy = summarizeKnowledge(record, 'C')
  assert.deepEqual(legacy.documents, [])
  assert.equal(legacy.updatedAt, 10)
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
