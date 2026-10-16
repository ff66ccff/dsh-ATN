import assert from 'node:assert/strict'
import test from 'node:test'
import { establishSemantics, classifyMail, exactlyOne, type SemanticGate } from '../../experiments/probe-liveness-audit-v2.ts'
import { runLivenessControls } from '../fixtures/probe-liveness-controls.ts'

test('LIVENESS-V2: semantic gate blocks classification; association refuses ambiguity', async () => {
  const gate = await establishSemantics()
  assert.equal(gate.complete, true)
  assert.throws(() => classifyMail({} as SemanticGate, { mail: 'm', input: true, modelStarted: true, delivered: true, terminalAtDelivery: false }), /Semantic gate/)
  assert.throws(() => exactlyOne([1, 2], 'ambiguous receipt'), /7.4/)
})

test('LIVENESS-V2: actual kernel proves both fault classes, normal negative and terminal controls', async () => {
  const results = await runLivenessControls(await establishSemantics())
  assert.equal(results.length, 5)
  assert.equal(results.filter(row => row.classification.defect).length, 2)
  assert.ok(results.every(row => row.genuineKernel && row.idle))
})
