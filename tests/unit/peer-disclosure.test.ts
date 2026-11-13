import { strict as assert } from 'node:assert'
import test from 'node:test'
import { projectPeerSummary, isFullPeerSummary } from '../../src/peer-disclosure.ts'
import { recordRequesterFeedback } from '../../src/requester-feedback.ts'
import { taskResultDigest } from '../../src/tasks.ts'
import { defineCustodyPolicy } from '../../src/information-boundary.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'
import { topologyFeedbackMessage } from '../../src/topology-feedback.ts'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

function text(message: UserMessage | undefined): string {
  assert.ok(message)
  return message.content.map(part => part.type === 'text' ? part.text : '').join('\n')
}

test('DISCLOSURE-02: coarse metadata is an allowlist of trusted catalog topics and observed-only categories', () => {
  const record = makeChain(['A', 'B'], { limits: { ...makeChain([]).limits, peerDisclosure: 'coarse' } })
  record.tasks.secret = makeTask('HIDDEN_TASK_762341', { description: 'HIDDEN_TASK_PROSE', context: 'HIDDEN_CONTEXT',
    createdAt: 762341, holderStepsAtCreation: 92347 })
  record.nodes.B.knowledgeFingerprint = { source: 'host-custody', documents: ['HIDDEN_SAVED_DOCUMENT'],
    topics: ['HIDDEN_SAVED_TOPIC'], contributions: [], updatedAt: 883421 }
  const owned = Array.from({ length: 40 }, (_, index) => `HIDDEN_ASSET_${index}`)
  const described: string[] = []
  const policy = defineCustodyPolicy({ custody: () => owned, extractClaims: () => [],
    describeArtifact: id => { described.push(id); return id === owned.at(-1) ? { topics: ['trusted catalog topic'] } : {} } })
  const before = structuredClone(record)
  assert.deepEqual(projectPeerSummary(record, 'B', 'A', policy, 981237), {
    id: 'B', lifecycle: 'active', topics: ['trusted catalog topic'], availability: 'occupied',
    outcomes: { requester: 'pending', host: 'pending' },
  })
  assert.deepEqual(described, owned, 'describe the actual owned ids, not a truncated document summary')
  assert.deepEqual(projectPeerSummary(record, 'B', 'A', defineCustodyPolicy({ custody: () => owned, extractClaims: () => [] })), {
    id: 'B', lifecycle: 'active', availability: 'occupied', outcomes: { requester: 'pending', host: 'pending' },
  })
  assert.doesNotMatch(JSON.stringify(projectPeerSummary(record, 'B', 'A')), /HIDDEN|762341|92347|883421|981237/)
  assert.deepEqual(record, before)
})

test('DISCLOSURE-08: empty, unrated, positive, negative and contradictory observations remain source-separated', () => {
  let record = makeChain(['A', 'B'], { limits: { ...makeChain([]).limits, peerDisclosure: 'coarse' } })
  const categories = () => {
    const row = projectPeerSummary(record, 'B', 'A')
    assert.ok('outcomes' in row)
    return row.outcomes
  }
  assert.deepEqual(categories(), { requester: 'unobserved', host: 'unobserved' })
  const empty = projectPeerSummary(record, 'B', 'A')
  assert.ok('availability' in empty)
  assert.equal(empty.availability, 'no-current-obligations', 'absence of obligations is not a health or free-capacity assertion')
  record.tasks.HIDDEN_POSITIVE_TASK = makeTask('HIDDEN_POSITIVE_TASK', { status: 'completed', settledAt: 10, settledBy: 'B',
    result: { summary: 'HIDDEN_RESULT', evidence: ['HIDDEN_RESULT_DOC'] } })
  assert.deepEqual(categories(), { requester: 'pending', host: 'pending' })
  record = recordRequesterFeedback(record, 'A', { taskId: 'HIDDEN_POSITIVE_TASK', status: 'accepted',
    summary: 'HIDDEN_REQUESTER_PROSE', evidence: ['HIDDEN_REQUESTER_DOC'] }, 11).record
  assert.deepEqual(categories(), { requester: 'positive-only', host: 'pending' })
  const positive = record.tasks.HIDDEN_POSITIVE_TASK
  positive.acceptance = { status: 'passed', validatorId: 'HIDDEN_VALIDATOR', summary: 'HIDDEN_HOST_PROSE',
    evidence: ['HIDDEN_HOST_DOC'], checkedAt: 12, resultDigest: taskResultDigest(positive),
    metrics: { cost: 88321, costUnit: 'HIDDEN_COST', comparisonKey: 'HIDDEN_COMPARISON' } }
  assert.deepEqual(categories(), { requester: 'positive-only', host: 'positive-only' })
  const initial = topologyFeedbackMessage(record, 'A', [], 12)
  const events = [{ type: 'user/message', data: initial }]
  record.nodes.A.stepsUsed = 10
  record.tasks.same = { ...structuredClone(positive), id: 'HIDDEN_ANOTHER_TASK', createdAt: 97321, settledAt: 97322 }
  record.tasks.same.acceptance!.resultDigest = taskResultDigest(record.tasks.same)
  record.tasks.same.localFeedback!.resultDigest = taskResultDigest(record.tasks.same)
  record.tasks.same.localFeedback!.checkedAt = 97323
  assert.equal(topologyFeedbackMessage(record, 'A', events, 97324), undefined, 'more same-category terminal observations do not replay exact counts')
  delete record.tasks.same
  positive.acceptance.status = 'failed'
  assert.deepEqual(categories(), { requester: 'pending', host: 'negative-only' }, 'host rejection suppresses contradictory requester acceptance, not its independent source')
  record.tasks.HIDDEN_NEGATIVE_TASK = makeTask('HIDDEN_NEGATIVE_TASK', { status: 'completed', settledAt: 15, settledBy: 'B',
    result: { summary: 'HIDDEN_NEGATIVE_RESULT', evidence: [] } })
  record = recordRequesterFeedback(record, 'A', { taskId: 'HIDDEN_NEGATIVE_TASK', status: 'rejected',
    summary: 'HIDDEN_REJECTION', evidence: ['HIDDEN_REJECTION_DOC'] }, 16).record
  assert.deepEqual(categories(), { requester: 'mixed', host: 'mixed' })
  delete record.tasks.HIDDEN_POSITIVE_TASK
  assert.deepEqual(categories(), { requester: 'negative-only', host: 'pending' })
  assert.doesNotMatch(JSON.stringify(projectPeerSummary(record, 'B', 'A')), /HIDDEN|88321|97321|97322|97323/)
})

test('DISCLOSURE-09: default and absent legacy mode preserve full bounded response fields exactly', () => {
  const record = makeChain(['A', 'B'])
  record.tasks.work = makeTask('work', { status: 'failed', settledAt: 10, description: 'Full visible task',
    result: { summary: 'Full visible result', evidence: ['explicit-evidence'] } })
  const full = projectPeerSummary(record, 'B', 'A', undefined, 20)
  assert.ok(isFullPeerSummary(full))
  assert.deepEqual(full.taskSummaries, ['Full visible task'])
  assert.deepEqual(full.recentResults, ['[failed] Full visible result'])
  const { peerDisclosure: _mode, ...legacyLimits } = record.limits
  const legacy = { ...record, limits: legacyLimits }
  assert.deepEqual(projectPeerSummary(legacy, 'B', 'A', undefined, 20), full)
  assert.equal(text(topologyFeedbackMessage(legacy, 'A', [], 20)), text(topologyFeedbackMessage(record, 'A', [], 20)))
})

test('DISCLOSURE-10: restricted feedback keeps complete multibyte JSON and declines oversized mandatory identities', () => {
  const record = makeChain(['A', 'B'], { limits: { ...makeChain([]).limits, peerDisclosure: 'coarse' } })
  const topic = '证据主题'.repeat(20)
  const policy = defineCustodyPolicy({ custody: () => ['HIDDEN_DOC'], extractClaims: () => [], describeArtifact: () => ({ topics: [topic] }) })
  const feedback = text(topologyFeedbackMessage(record, 'A', [], 20, policy))
  assert.ok(Buffer.byteLength(feedback) <= 4096)
  assert.ok(!feedback.includes('�'))
  const cards = JSON.parse(feedback.split('Peer cards: ')[1])
  assert.deepEqual(cards[0].topics, [topic])
  record.id = '路由'.repeat(2000)
  assert.equal(topologyFeedbackMessage(record, 'A', [], 20, policy), undefined, 'fixed core cannot fit: no truncated route identity or partial JSON')
  record.id = 'net-1'
  const hugeCatalog = defineCustodyPolicy({ custody: () => ['HIDDEN_DOC'], extractClaims: () => [],
    describeArtifact: () => ({ topics: Array.from({ length: 16 }, (_, i) => `${i}${topic}`) }) })
  assert.equal(topologyFeedbackMessage(record, 'A', [], 20, hugeCatalog), undefined, 'oversized projected JSON is declined whole')
})

test('DISCLOSURE-03: restricted feedback hashes only visible cards and keeps delayed changes owed until logged', () => {
  const record = makeChain(['A', 'B'], { limits: { ...makeChain([]).limits, peerDisclosure: 'coarse' } })
  record.nodes.A.stepsUsed = 1
  record.tasks.hidden = makeTask('HIDDEN_TASK_872341', { description: 'HIDDEN_PROSE', createdAt: 1 })
  const policy = defineCustodyPolicy({ custody: () => ['HIDDEN_DOC'], extractClaims: () => [],
    describeArtifact: () => ({ topics: ['trusted topic'] }) })
  const initial = topologyFeedbackMessage(record, 'A', [], 10, policy)
  assert.match(text(initial), /peerDisclosure=coarse/)
  assert.match(text(initial), /trusted topic/)
  assert.doesNotMatch(JSON.stringify(initial), /HIDDEN|872341|elapsed|assigned=|observations/)
  assert.doesNotMatch(text(initial), /telemetry|Fingerprint/)
  const events = [{ type: 'user/message', data: initial }]
  record.nodes.B.stepsUsed = 73481
  record.tasks.another = makeTask('HIDDEN_TASK_99999', { description: 'HIDDEN_CHANGED_PROSE', createdAt: 15 })
  record.nodes.A.stepsUsed = 10
  assert.equal(topologyFeedbackMessage(record, 'A', events, 88342, policy), undefined,
    'same occupied/pending category does not replay hidden task numbers, ids or ages')
  record.limits.peerDisclosure = 'minimal'
  record.nodes.A.stepsUsed = 2
  assert.equal(topologyFeedbackMessage(record, 'A', events, 20, policy), undefined)
  record.nodes.A.stepsUsed = 3
  assert.equal(topologyFeedbackMessage(record, 'A', events, 20, policy), undefined)
  record.nodes.A.stepsUsed = 4
  const minimal = topologyFeedbackMessage(record, 'A', events, 20, policy)
  assert.match(text(minimal), /peerDisclosure=minimal/)
  assert.doesNotMatch(text(minimal), /trusted topic|occupied|pending/)
  assert.ok(topologyFeedbackMessage(record, 'A', events, 20, policy), 'unlogged generation does not acknowledge mode change')
  events.push({ type: 'user/message', data: minimal })
  record.nodes.A.stepsUsed = 7
  assert.equal(topologyFeedbackMessage(record, 'A', events, 21, policy), undefined)
  record.nodes.B.lifecycle = 'retired'
  record.nodes.B.note = 'HIDDEN_EXIT_PROSE'
  const departed = topologyFeedbackMessage(record, 'A', events, 22, policy)
  assert.match(text(departed), /Removed: B \(retired\)/)
  assert.doesNotMatch(JSON.stringify(departed), /HIDDEN_EXIT_PROSE|exit reason/)
})
