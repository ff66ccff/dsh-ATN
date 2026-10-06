import { strict as assert } from 'node:assert'
import test from 'node:test'
import { summarizeAdaptiveProbe, type ShiftingRunObservation } from '../../experiments/shifting-evidence-protocol.ts'

function probes(attempts: number, successes: number, blocked: number, correct = true): ShiftingRunObservation[] {
  return Array.from({ length: 5 }, (_, i) => ({ runId: `probe-${i}`, purpose: 'adaptive-probe', mode: 'adaptive',
    model: 'deepseek-v4.1-flash', execution: 'live-provider', passed: correct, phase1Submitted: true, phase2Submitted: true,
    phase1Correct: correct, phase2Correct: correct, submissionDisciplineFailure: false, solvingFailure: !correct,
    conditions: { seed: 17 + 14 * i, perNodeSteps: 48 }, sourceHashes: { code: 'same' },
    atnTotalInteractions: 1, atnTotalTransferBytes: 1, meanInputTokensPerCall: null, relativeInteractions: 1, relativeTransferBytes: 1,
    protocol: { requesterFeedback: { accepted: 1, rejected: 1, needsMore: 0 }, stepUse: [{ id: 'node', stepsUsed: 20 }],
      explicitRewires: i === 0 && successes ? [{ id: 'edge', changed: true }] : [],
      rewireTelemetry: { statusRewireCalls: i === 0 ? attempts : 0, successfulRewires: i === 0 ? successes : 0,
        blockedRewires: i === 0 ? blocked : 0, unchangedRewires: 0, pendingRewires: 0, ablationBlockedRewires: 0,
        priorStatusQueryCalls: 1, callsWithPriorStatusQuery: 0 } } }))
}

test('BIND-DISCOVERY: one successful attempt passes regardless of rewiring frequency', () => {
  const summary = summarizeAdaptiveProbe(probes(1, 1, 0))
  assert.equal(summary.probeGatePassed, true)
  assert.equal((summary as any).discovery.status, 'passed')
  assert.equal((summary as any).discovery.successRate, 1)
})

test('BIND-DISCOVERY: zero attempts and all-blocked attempts have different diagnostic states', () => {
  const zero = summarizeAdaptiveProbe(probes(0, 0, 0)) as any
  const blocked = summarizeAdaptiveProbe(probes(1, 0, 1)) as any
  assert.equal(zero.discovery?.status, 'not-observed')
  assert.equal(blocked.discovery?.status, 'blocked')
  assert.equal(zero.probeGatePassed, false)
  assert.equal(blocked.probeGatePassed, false)
})

test('BIND-CAPABILITY: rewires alone never qualify a model that fails both checkpoints', () => {
  const summary = summarizeAdaptiveProbe(probes(1, 1, 0, false)) as any
  assert.equal(summary.capabilityGatePassed, false)
  assert.equal(summary.probeGatePassed, false)
})
