import { strict as assert } from 'node:assert'
import test from 'node:test'
import { runSimplificationReferences } from '../../experiments/simplification-reference.ts'

test('SIMPLIFICATION-REFERENCE: all four actual configurations collect every fact without model calls', async () => {
  const result = await runSimplificationReferences([17, 87])
  assert.equal(result.passed, true)
  assert.equal(result.rows.length, 8)
  for (const row of result.rows) {
    assert.equal(row.reference.issuedModelCalls, 0)
    assert.equal(row.reference.obtainedRequiredFactCount, 4)
    assert.equal(row.reference.passed, true)
    assert.equal(row.reference.factFlowAudit?.passed, true)
    assert.ok(row.reference.entrySteps <= 48)
    assert.equal(row.reference.requesterRatings, ['no-feedback', 'minimal'].includes(row.mode) ? 0 : 6)
  }
  const full = result.rows.find(row => row.mode === 'adaptive')!.reference
  const minimal = result.rows.find(row => row.mode === 'minimal')!.reference
  assert.equal(full.entrySteps - minimal.entrySteps, 6)
  assert.equal(minimal.board.reads + minimal.board.writes, 0)
})
