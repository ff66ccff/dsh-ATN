/** The P0/P1 experiment includes its own negative control and never needs a paid model. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { runFeedbackMilestoneArm } from '../../experiments/feedback-milestone.ts'

test('P0/P1 milestone distinguishes missing feedback from requester-local evidence without promoting it to host verification', async () => {
  const control = await runFeedbackMilestoneArm(false)
  const treatment = await runFeedbackMilestoneArm(true)
  assert.equal(control.nodeCount, treatment.nodeCount)
  assert.deepEqual(control.localFeedback, { accepted: 0, rejected: 0, needsMore: 0 })
  assert.deepEqual(treatment.localFeedback, { accepted: 1, rejected: 1, needsMore: 1 })
  assert.ok(control.explicitRewires.every(row => row.verdict === 'insufficient-evidence'))
  assert.ok(treatment.explicitRewires.some(row => row.verdict === 'observed-improvement' && row.evidenceSource === 'requester'))
  assert.ok(treatment.explicitRewires.every(row => row.hostVerdict === 'insufficient-evidence'))
  for (const arm of [control, treatment]) {
    assert.equal(arm.paidModelCalls, 0)
    assert.equal(arm.causalClaim, false)
    assert.deepEqual(arm.discovery.beforePublication, [])
    assert.equal(arm.discovery.afterPublication?.[0], arm.discovery.candidateNodeId)
    assert.equal(arm.hostAcceptance.beforeIndependentCheck, false)
    assert.equal(arm.hostAcceptance.afterIndependentCheck, true)
  }
})
