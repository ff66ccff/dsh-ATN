import { strict as assert } from 'node:assert'
import test from 'node:test'
import { auditEqualBudgetFactFlow, buildEqualBudgetAuditFacts, textContainsEqualBudgetResult, type EqualBudgetFactEvent } from '../../experiments/equal-budget-audit.ts'
import { getEqualBudgetTask } from '../../experiments/equal-budget-task.ts'

const documents = [{ id: 'branch-a-ledger', text: 'Unique branch A ledger: gross=21.' },
  { id: 'branch-a-adjustment', text: 'Unique branch A adjustment: subtract=4.' }]
const facts = [{ id: 'branch-a', documentIds: documents.map(row => row.id), result: { branch: 'a', total: 17 } }]
const answer = JSON.stringify({ results: [facts[0].result], total: 17 })
const read = (seq: number, agent: string, documentId: string): EqualBudgetFactEvent => ({ kind: 'read', seq, agent, documentId })
const transfer = (seq: number, from: string, to: string, content = answer, delivered = true): EqualBudgetFactEvent =>
  ({ kind: 'transport', seq, sentSeq: seq, from, to, transport: 'atn', content, delivered })
const audit = (events: EqualBudgetFactEvent[], seq = 20) => auditEqualBudgetFactFlow({ documents, facts, events,
  submission: { seq, agent: 'entry', answer } })

test('EQUAL-AUDIT: direct source reads ground a single-agent submission', () => {
  const result = audit(documents.map((row, index) => read(index, 'entry', row.id)))
  assert.equal(result.positiveCompletionEvidence, true)
  assert.equal(result.auditedFacts, 1)
})

test('EQUAL-AUDIT: native, ATN and independent delivered results use the same positive witness rule', () => {
  for (const transport of ['atn', 'native', 'independent'] as const) {
    const result = audit([...documents.map((row, index) => read(index, 'worker', row.id)),
      { kind: 'transport', seq: 3, sentSeq: 2, from: 'worker', to: 'entry', content: answer, delivered: true, transport }])
    assert.equal(result.positiveCompletionEvidence, true)
    assert.equal(result.facts[0].path.at(-1)?.transport, transport)
  }
})

test('EQUAL-AUDIT: arbitrary forwarding is permitted after a grounded local result', () => {
  const result = audit([...documents.map((row, index) => read(index, 'worker', row.id)),
    transfer(3, 'worker', 'relay'), transfer(4, 'relay', 'entry')])
  assert.equal(result.positiveCompletionEvidence, true)
  assert.deepEqual(result.facts[0].path.filter(row => row.kind === 'transport').map(row => row.agent), ['relay', 'entry'])
})

test('EQUAL-AUDIT: distributed document reads require source content to reach the combining worker', () => {
  const result = audit([read(0, 'worker-1', documents[0].id), read(1, 'worker-2', documents[1].id),
    transfer(2, 'worker-1', 'worker-2', JSON.stringify({ text: documents[0].text })), transfer(3, 'worker-2', 'entry')])
  assert.equal(result.positiveCompletionEvidence, true)
  assert.equal(audit([read(0, 'worker-1', documents[0].id), read(1, 'worker-2', documents[1].id),
    transfer(2, 'worker-1', 'worker-2', documents[0].id), transfer(3, 'worker-2', 'entry')]).passed, false)
})

test('EQUAL-AUDIT: permissions, ungrounded correct guesses, bare citations and undelivered messages are not evidence', () => {
  assert.equal(audit([]).passed, false)
  assert.equal(audit([transfer(1, 'worker', 'entry')]).passed, false)
  const reads = documents.map((row, index) => read(index, 'worker', row.id))
  assert.equal(audit([...reads, transfer(3, 'worker', 'entry', documents.map(row => row.id).join(','))]).passed, false)
  assert.equal(audit([...reads, transfer(3, 'worker', 'entry', answer, false)]).passed, false)
})

test('EQUAL-AUDIT: later reads or deliveries cannot retroactively justify a submission', () => {
  assert.equal(audit([transfer(0, 'worker', 'entry'), ...documents.map((row, index) => read(index + 1, 'worker', row.id))]).passed, false)
  assert.equal(audit([...documents.map((row, index) => read(index, 'worker', row.id)), transfer(4, 'worker', 'entry')], 3).passed, false)
  assert.equal(audit([read(0, 'entry', documents[0].id), read(0, 'entry', documents[1].id)]).passed, false)
})

test('EQUAL-AUDIT: reads after sending cannot retroactively ground a delayed message', () => {
  const sentBeforeReading = { kind: 'transport', seq: 5, sentSeq: 0, from: 'worker', to: 'entry',
    content: answer, delivered: true, transport: 'native' } as const
  const reads = documents.map((row, index) => read(index + 1, 'worker', row.id))
  assert.equal(audit([...reads, sentBeforeReading]).positiveCompletionEvidence, false)
  const unknown = { ...sentBeforeReading, sentSeq: undefined }
  const missingBoundary = audit([...reads, unknown])
  assert.equal(missingBoundary.transportSendBoundaryUnknown, 1)
  assert.equal(missingBoundary.positiveCompletionEvidence, false)
})

test('EQUAL-AUDIT: missing submission stays explicit and cannot become completion evidence', () => {
  const result = auditEqualBudgetFactFlow({ documents, facts, events: [], submission: null })
  assert.equal(result.noSubmission, true)
  assert.equal(result.auditedFacts, 0)
  assert.equal(result.positiveCompletionEvidence, false)
})

test('EQUAL-AUDIT: result recognition handles wrappers and fenced or escaped JSON without accepting altered values', () => {
  assert.equal(textContainsEqualBudgetResult('Evidence:\n```json\n' + answer + '\n```', facts[0].result), true)
  assert.equal(textContainsEqualBudgetResult(JSON.stringify({ summary: answer }), facts[0].result), true)
  assert.equal(textContainsEqualBudgetResult(JSON.stringify({ branch: 'a', total: 18 }), facts[0].result), false)
  assert.equal(textContainsEqualBudgetResult('branch a 17', facts[0].result), false)
})

test('EQUAL-AUDIT: actual submitted shard values are grounded without using oracle correctness', () => {
  const task = getEqualBudgetTask(17, 1)
  const wrongAnswer = JSON.stringify({ shards: { 'shard-01': { netByAccount: { A: -987654, B: 0, C: 0, D: 0 },
    countedEventCount: 0, excludedEventCount: 0, deduplicatedEventCount: 0 } } })
  const submittedFacts = buildEqualBudgetAuditFacts(task, wrongAnswer)
  assert.equal(submittedFacts.length, 1)
  assert.deepEqual(submittedFacts[0].result, JSON.parse(wrongAnswer).shards)
  assert.equal(auditEqualBudgetFactFlow({ documents: task.documents, facts: submittedFacts,
    events: task.documents.map((document, index) => read(index, 'entry', document.id)),
    submission: { seq: 10, agent: 'entry', answer: wrongAnswer } }).positiveCompletionEvidence, true)
  assert.deepEqual(buildEqualBudgetAuditFacts(task, 'not JSON'), [])
  const malformed = auditEqualBudgetFactFlow({ documents: task.documents, facts: [], events: [],
    submission: { seq: 1, agent: 'entry', answer: '{}' } })
  assert.equal(malformed.passed, false)
  assert.equal(malformed.positiveCompletionEvidence, false)
})

test('EQUAL-AUDIT: compact totals require positive paths from every shard, including identified forwarded local balances', () => {
  const task = getEqualBudgetTask(17, 16, { ordersPerShard: 10, compactAnswer: true })
  // Deliberately not oracle values: this audit measures observed evidence flow, not correctness.
  const compact = JSON.stringify({ mergedNetByAccount: { A: -987654, B: 2, C: 3, D: 4 }, grandTotal: -987645,
    evidence: task.documents.map(document => document.id) })
  const dependencies = buildEqualBudgetAuditFacts(task, compact)
  assert.equal(dependencies.length, 16)
  assert.deepEqual(dependencies.map(fact => fact.localResultShard), task.shardIds)
  const workerReads = task.documents.map((document, index) => read(index, 'worker', document.id))
  const localResults = Object.fromEntries(task.shardIds.map(id => [id, { netByAccount: { A: 1, B: 2, C: 3, D: 4 } }]))
  const check = (events: EqualBudgetFactEvent[]) => auditEqualBudgetFactFlow({ documents: task.documents, facts: dependencies, events,
    submission: { seq: 100, agent: 'entry', answer: compact } })
  assert.equal(check(task.documents.map((document, index) => read(index, 'entry', document.id))).positiveCompletionEvidence, true)
  for (const transport of ['atn', 'native', 'independent'] as const) {
    const result = check([...workerReads, { kind: 'transport', seq: 50, sentSeq: 49, from: 'worker', to: 'entry',
      transport, delivered: true, content: JSON.stringify({ shards: localResults }) }])
    assert.equal(result.positiveCompletionEvidence, true)
    assert.equal(result.auditedFacts, 16)
  }
  assert.equal(check([...workerReads, transfer(50, 'worker', 'entry', compact)]).passed, false, 'the merged answer itself supplies no identified local balances')
  assert.equal(check([...workerReads, transfer(50, 'worker', 'entry', JSON.stringify({ evidence: task.documents.map(document => document.id) }))]).passed, false)
  assert.equal(check([transfer(50, 'worker', 'entry', JSON.stringify({ shards: localResults }))]).passed, false, 'local values need grounded sources')
  const missing = { ...localResults }; delete missing['shard-16']
  const partial = check([...workerReads, transfer(50, 'worker', 'entry', JSON.stringify({ shards: missing }))])
  assert.equal(partial.passed, false)
  assert.equal(partial.auditedFacts, 15)
  assert.ok(partial.violations.includes('missing-positive-source-path:shard-16'))
  const incomplete = { ...localResults, 'shard-16': { netByAccount: { A: 1, B: 2, C: 3 } } }
  assert.equal(check([...workerReads, transfer(50, 'worker', 'entry', JSON.stringify({ shards: incomplete }))]).passed, false)
  const delayed = { ...transfer(50, 'worker', 'entry', JSON.stringify({ shards: localResults })), sentSeq: 1 }
  assert.equal(check([...workerReads, delayed]).passed, false, 'sources read after sending remain unavailable')
  assert.deepEqual(buildEqualBudgetAuditFacts(task, '{"mergedNetByAccount":{"A":1},"grandTotal":1}'), [])
})
