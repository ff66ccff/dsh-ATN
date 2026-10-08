import assert from 'node:assert/strict'
import { test } from 'node:test'
import { equalBudgetAllocations, createEqualBudgetAdmission } from '../../experiments/equal-budget.ts'

test('four arms allocate exactly N*S, including the independent synthesis entry', () => {
  const rows = equalBudgetAllocations(16, 32)
  assert.deepEqual(rows.map(row => row.totalSteps), [512, 512, 512, 512])
  for (const row of rows) assert.equal(row.perAgentSteps.reduce((a, b) => a + b, 0), 512)
  assert.deepEqual(rows[0].perAgentSteps, [512])
  assert.equal(rows[1].perAgentSteps.length, 16)
  assert.equal(rows[1].perAgentSteps[0], 32)
})

test('concurrent admission reserves each agent allocation without borrowing unspent slots', () => {
  for (const allocation of equalBudgetAllocations(4, 2)) {
    const gate = createEqualBudgetAdmission(allocation)
    for (let slot = 0; slot < allocation.agents; slot++) gate.register(`session-${slot}`)
    assert.throws(() => gate.register('extra'), /agent-cap/)
    assert.equal(gate.canAdmit(undefined), false)
    for (let call = 0; call < allocation.perAgentSteps[0]; call++) gate.admit('session-0')
    assert.equal(gate.canAdmit('session-0'), false)
    assert.throws(() => gate.admit('session-0'), /step-cap/)
    if (allocation.agents > 1) assert.equal(gate.canAdmit('session-1'), true)
    assert.equal(gate.snapshot().reduce((sum, row) => sum + row.used, 0), allocation.perAgentSteps[0])
  }
})

test('noninteger and unsupported design budgets are refused before execution', () => {
  for (const pair of [[1, 32], [17, 32], [16, 0], [16, 65], [16, 1.5]]) assert.throws(() => equalBudgetAllocations(...pair as [number, number]))
})
