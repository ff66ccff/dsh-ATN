import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  constructEqualBudgetAnswer, constructEqualBudgetShardAnswer, constructEqualBudgetSubmission, evaluateEqualBudgetTask,
  getEqualBudgetTask, mergeEqualBudgetShardAnswers, renderEqualBudgetPrompt, verifyEqualBudgetSolvability,
  EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION, renderEqualBudgetSingleScaffoldedPrompt,
  type EqualBudgetSolvabilityAllocation, type EqualBudgetTask,
} from '../../experiments/equal-budget-task.ts'
import { equalBudgetAllocations, EQUAL_BUDGET_V3_MODES } from '../../experiments/equal-budget.ts'

const allocations: EqualBudgetSolvabilityAllocation[] = [
  { mode: 'single', agents: 1, entrySteps: 16 * 32 },
  { mode: 'independent-pool', agents: 16, entrySteps: 32 },
  { mode: 'native-team', agents: 16, entrySteps: 32 },
  { mode: 'atn-adaptive', agents: 16, entrySteps: 32 },
]

test('equal-budget fixture has eight independent meaningful ledger shards and a compact document index', () => {
  const task = getEqualBudgetTask(17)
  assert.equal(task.shardIds.length, 8)
  assert.equal(task.ordersPerShard, 40)
  assert.equal(task.documents.length, 25)
  assert.equal(new Set(task.documents.map(document => document.id)).size, task.documents.length)
  for (const shard of task.shardIds) {
    const orders = task.documents.find(document => document.id === `${shard}/orders`)!
    assert.equal(orders.text.split('\n').length - 1, 40)
    const ownDocuments = task.documents.filter(document => document.id.startsWith(`${shard}/`))
    for (const document of ownDocuments) for (const other of task.shardIds.filter(id => id !== shard)) assert.ok(!document.text.includes(other))
  }
  const prompt = renderEqualBudgetPrompt(task)
  for (const document of task.documents) {
    assert.ok(prompt.includes(document.id))
    assert.ok(!prompt.includes(document.text))
  }
  assert.match(prompt, /read_document/)
  assert.doesNotMatch(prompt, /constructEqualBudget|evaluateEqualBudget|EXPECTED|atn_rewire|spawn_teammate/)
  assert.ok(Buffer.byteLength(prompt) < 4_000)
  assert.ok(Buffer.byteLength(JSON.stringify(constructEqualBudgetAnswer(task))) < 16_384)
})

test('equal-budget fixture seeds are reproducible and detached and alter actual evidence', () => {
  const first = getEqualBudgetTask(17)
  assert.deepEqual(first, getEqualBudgetTask(17))
  assert.notDeepEqual(first.documents, getEqualBudgetTask(18).documents)
  assert.notDeepEqual(constructEqualBudgetAnswer(first), constructEqualBudgetAnswer(getEqualBudgetTask(18)))
  ;(first.documents[1] as { text: string }).text = 'caller mutation'
  assert.notEqual(getEqualBudgetTask(17).documents[1].text, 'caller mutation')
  for (const seed of [-1, 1.5, Number.NaN, 2 ** 32]) assert.throws(() => getEqualBudgetTask(seed), /seed/)
  for (const shards of [0, 1.5, 33, Number.NaN]) assert.throws(() => getEqualBudgetTask(17, shards), /shards/)
})

test('constructive solver applies inclusive cutoffs, latest eligible corrections and distinct-id deduplication', () => {
  const source = getEqualBudgetTask(17, 1), shard = source.shardIds[0]
  const task: EqualBudgetTask = { ...source, documents: [source.documents[0],
    { id: `${shard}/orders`, text: 'order,account\no1,A\no2,B\no3,D' },
    { id: `${shard}/corrections`, text: [
      'order,revision,account,status,effectiveAt',
      'o1,4,A,rejected,2030-01-01T11:00:00Z',
      'o1,2,C,approved,2030-01-01T12:00:00Z',
      'o1,1,B,approved,2030-01-01T11:00:00Z',
      'o1,3,D,approved,2030-01-01T12:00:01Z',
      'o2,1,A,pending,2030-01-01T11:00:00Z',
      'o3,1,A,approved,2030-01-01T12:00:00Z',
    ].join('\n') },
    { id: `${shard}/events`, text: [
      'id,order,type,amount,time',
      'e1,o1,capture,100,2030-01-01T12:00:00Z',
      'e2,o1,refund,30,2030-01-01T11:00:00Z',
      'e1,o1,capture,100,2030-01-01T12:00:00Z',
      'e1,o1,capture,100,2030-01-01T12:00:00Z',
      'e3,o1,authorization,70,2030-01-01T12:00:00Z',
      'e3,o1,authorization,70,2030-01-01T12:00:00Z',
      'e4,o2,capture,40,2030-01-01T11:00:00Z',
      'e5,o2,refund,10,2030-01-01T12:00:01Z',
      'e6,o3,capture,90,2030-01-01T13:00:00Z',
    ].join('\n') },
  ] }
  const expected = { netByAccount: { A: 0, B: 40, C: 70, D: 0 }, countedEventCount: 3, excludedEventCount: 3, deduplicatedEventCount: 2 }
  assert.deepEqual(constructEqualBudgetShardAnswer(task, shard), expected)
  assert.deepEqual(constructEqualBudgetAnswer(task).mergedNetByAccount, expected.netByAccount)
  assert.equal(constructEqualBudgetAnswer(task).grandTotal, 110)
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify(constructEqualBudgetAnswer(task))).passed, true)
})

test('each shard can be solved using only its evidence and shared policy; a changed shard changes the final merge', () => {
  const task = getEqualBudgetTask(45), before = constructEqualBudgetAnswer(task), changedShard = task.shardIds[3]
  for (const shard of task.shardIds) {
    const localTask = { ...task, documents: task.documents.filter(document => document.id === 'policy' || document.id.startsWith(`${shard}/`)) }
    assert.deepEqual(constructEqualBudgetShardAnswer(localTask, shard), before.shards[shard])
  }
  const changed = { ...task, documents: task.documents.map(document => document.id === `${changedShard}/events`
    ? { ...document, text: document.text.replace(new RegExp(`(${changedShard}-o01-c,${changedShard}-o01,capture,)(\\d+)`), (_, prefix: string, amount: string) => `${prefix}${Number(amount) + 7}`) }
    : document) }
  const after = constructEqualBudgetAnswer(changed)
  for (const shard of task.shardIds) if (shard !== changedShard) assert.deepEqual(after.shards[shard], before.shards[shard])
  assert.notDeepEqual(after.shards[changedShard], before.shards[changedShard])
  assert.equal(after.grandTotal, before.grandTotal + 7)
  assert.equal(evaluateEqualBudgetTask(changed, JSON.stringify(before)).passed, false)
})

test('exact evaluation requires every local answer, the correct merge, and precise integer types', () => {
  const task = getEqualBudgetTask(59), answer = constructEqualBudgetAnswer(task), firstShard = task.shardIds[0]
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify(answer)).passed, true)
  assert.equal(evaluateEqualBudgetTask(task, `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``).passed, true)
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify({ ...answer, evidence: [...answer.evidence].reverse() })).passed, true)
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify({ ...answer, grandTotal: answer.grandTotal + 1 })).passed, false)
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify({ ...answer, mergedNetByAccount: answer.shards[firstShard].netByAccount })).passed, false)
  const partial = { ...answer.shards }; delete partial[firstShard]
  assert.throws(() => mergeEqualBudgetShardAnswers(task, partial), /every shard/)
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify({ ...answer, shards: partial })).passed, false)
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify({ shards: answer.shards })).passed, false)
  const wrong = { ...answer, shards: { ...answer.shards, [firstShard]: { ...answer.shards[firstShard], countedEventCount: String(answer.shards[firstShard].countedEventCount) } } }
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify(wrong)).passed, false)
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify({ ...answer, evidence: [...answer.evidence, 'policy'] })).passed, false)
  assert.equal(evaluateEqualBudgetTask(task, JSON.stringify({ ...answer, completed: true })).passed, false)
  assert.equal(evaluateEqualBudgetTask(task, 'Completed successfully').error, 'invalid-json')
  assert.equal(evaluateEqualBudgetTask(task, '{}\n{}').error, 'invalid-json')
  assert.equal(evaluateEqualBudgetTask(task, '[]').error, 'answer-must-be-object')
  assert.equal(evaluateEqualBudgetTask(task, ' '.repeat(16_385)).error, 'answer-too-large')
})

test('all four arms have a zero-model-call configuration witness within the per-agent step allocation', () => {
  for (const seed of [17, 31, 45, 59, 73, 87, 101, 115, 129, 143, 157, 171, 185, 199]) {
    const task = getEqualBudgetTask(seed), proof = verifyEqualBudgetSolvability(task, allocations)
    assert.equal(proof.issuedModelCalls, 0)
    assert.equal(proof.configurationCheckOnly, true)
    assert.equal(proof.causalClaim, false)
    assert.equal(proof.sufficientSerialSteps, 26)
    assert.equal(proof.passed, true)
    assert.equal(proof.arms.length, 4)
    for (const arm of proof.arms) {
      assert.equal(arm.passed, true)
      assert.deepEqual(arm.documentIds, task.documents.map(document => document.id))
    }
  }
  const task = getEqualBudgetTask(17)
  const boundaryProof = verifyEqualBudgetSolvability(task, allocations.map(allocation => ({ ...allocation, entrySteps: 26 })))
  assert.equal(boundaryProof.passed, false)
  assert.deepEqual(boundaryProof.arms.map(arm => arm.passed), [true, true, true, false])
  assert.equal(boundaryProof.arms[3].sufficientSerialSteps, 27)
  assert.equal(verifyEqualBudgetSolvability(task, allocations.map(allocation => ({ ...allocation, entrySteps: 25 }))).passed, false)
  assert.throws(() => verifyEqualBudgetSolvability(task, allocations.slice(0, 3)), /four arms/)
  assert.throws(() => verifyEqualBudgetSolvability(task, [allocations[0], allocations[0], allocations[2], allocations[3]]), /four arms/)
})

test('revision two scales independent units to sixteen shards and keeps the exact submitted artifact compact', () => {
  for (const ordersPerShard of [8, 10, 12]) {
    const task = getEqualBudgetTask(17, 16, { ordersPerShard, compactAnswer: true })
    assert.equal(task.revision, 2)
    assert.equal(task.shardIds.length, 16)
    assert.equal(task.documents.length, 49)
    for (const shard of task.shardIds) assert.equal(task.documents.find(document => document.id === `${shard}/orders`)!.text.split('\n').length - 1, ordersPerShard)
    const full = constructEqualBudgetAnswer(task), answer = constructEqualBudgetSubmission(task)
    assert.deepEqual(Object.keys(answer).sort(), ['evidence', 'grandTotal', 'mergedNetByAccount'])
    assert.deepEqual(answer.mergedNetByAccount, full.mergedNetByAccount)
    assert.equal(answer.grandTotal, full.grandTotal)
    assert.ok(Buffer.byteLength(JSON.stringify(answer)) < 1_500)
    assert.equal(evaluateEqualBudgetTask(task, JSON.stringify(answer)).passed, true)
    assert.equal(evaluateEqualBudgetTask(task, JSON.stringify(full)).passed, false, 'local detail is not part of the compact wire artifact')
    for (const invalid of [
      { ...answer, grandTotal: answer.grandTotal + 1 },
      { ...answer, mergedNetByAccount: { ...answer.mergedNetByAccount, A: String(answer.mergedNetByAccount.A) } },
      { ...answer, mergedNetByAccount: { ...answer.mergedNetByAccount, A: answer.mergedNetByAccount.A + 1 } },
      { ...answer, evidence: answer.evidence.slice(1) },
      { ...answer, evidence: [...answer.evidence, 'policy'] },
    ]) assert.equal(evaluateEqualBudgetTask(task, JSON.stringify(invalid)).passed, false)
    const prompt = renderEqualBudgetPrompt(task)
    assert.match(prompt, /one shard at a time/)
    for (const document of task.documents) {
      assert.ok(prompt.includes(document.id))
      assert.ok(!prompt.includes(document.text))
    }
    const witness = verifyEqualBudgetSolvability(task, allocations, { documentReadsPerStep: 2 })
    assert.equal(witness.passed, true)
    assert.equal(witness.issuedModelCalls, 0)
    assert.equal(witness.configurationCheckOnly, true)
    assert.equal(witness.documentReadsPerStep, 2)
    assert.deepEqual(witness.arms.map(arm => arm.sufficientSerialSteps), [26, 26, 26, 27])
    assert.equal(verifyEqualBudgetSolvability(task, allocations).passed, false, 'one-read-per-call witness cannot fit the team entry allocation')
  }
  for (const ordersPerShard of [0, 7, 13, 9.5, Number.NaN]) assert.throws(() => getEqualBudgetTask(17, 16, { ordersPerShard, compactAnswer: true }), /ordersPerShard/)
  for (const documentReadsPerStep of [0, 3, 1.5, Number.NaN]) assert.throws(() => verifyEqualBudgetSolvability(getEqualBudgetTask(17), allocations, { documentReadsPerStep }), /documentReadsPerStep/)
})

test('V3 scaffold adds only the sequential shard procedure to the unchanged single prompt', () => {
  const task = getEqualBudgetTask(17, 16, { ordersPerShard: 10, compactAnswer: true })
  const before = structuredClone(task), base = renderEqualBudgetPrompt(task), scaffold = renderEqualBudgetSingleScaffoldedPrompt(task)
  assert.equal(scaffold, `${base}\n\n${EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION}`)
  assert.match(EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION, /one shard per model call/)
  assert.match(EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION, /accumulated intermediate results/)
  assert.match(EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION, /After every shard.*merge/)
  assert.deepEqual(task, before)
  assert.equal(renderEqualBudgetPrompt(task), base)
  for (const document of task.documents) assert.ok(!scaffold.includes(document.text), 'scaffold supplies no extra fixture facts')
})

test('V3 configuration witness supports preregistered five-arm and reduced three-arm selections without changing legacy validation', () => {
  const task = getEqualBudgetTask(17, 16, { ordersPerShard: 10, compactAnswer: true })
  for (const modes of [EQUAL_BUDGET_V3_MODES, ['single', 'single-scaffolded', 'atn-adaptive'] as const]) {
    const selected = equalBudgetAllocations(16, 32, modes).map(row => ({ mode: row.mode, agents: row.agents, entrySteps: row.perAgentSteps[0] }))
    const witness = verifyEqualBudgetSolvability(task, selected, { documentReadsPerStep: 2, modes })
    assert.equal(witness.passed, true)
    assert.equal(witness.issuedModelCalls, 0)
    assert.deepEqual(witness.arms.map(arm => arm.mode), modes)
    const single = witness.arms.find(arm => arm.mode === 'single')!, scaffold = witness.arms.find(arm => arm.mode === 'single-scaffolded')!
    assert.deepEqual({ ...scaffold, mode: 'single' }, single)
    assert.throws(() => verifyEqualBudgetSolvability(task, selected, { documentReadsPerStep: 2 }), /four arms/)
    assert.throws(() => verifyEqualBudgetSolvability(task, selected.slice(1), { documentReadsPerStep: 2, modes }), /selected arms/)
  }
})
