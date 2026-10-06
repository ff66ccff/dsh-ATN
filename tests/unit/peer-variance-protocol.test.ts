import { strict as assert } from 'node:assert'
import test from 'node:test'
import * as protocol from '../../experiments/shifting-evidence-protocol.ts'
import { createShiftingEvidenceTask } from '../../experiments/shifting-evidence-task.ts'
import { proveTopologyBinding } from '../../experiments/topology-binding-proof.ts'
import { bindingEvidence } from '../fixtures/binding-evidence.ts'

const makeRun = (mode: string, index: number, purpose = 'comparison') => {
  const conditions = { seed: 17 + index * 14, perNodeSteps: 20, topologyBinding: true as const, agents: 8, chainLength: 2, maxCalls: 160, timeoutMs: 30000 }
  const sourceHashes = { source: 'same' }
  return ({
  runId: `${purpose}-${mode}-${index}`, purpose, mode, model: 'test', execution: 'live-provider', passed: true,
  startedAt: purpose === 'adaptive-probe' ? 1 : 1000, completedAt: purpose === 'adaptive-probe' ? 100 : 2000,
  phase1Submitted: true, phase1Correct: true, phase2Submitted: true, phase2Correct: true,
  submissionDisciplineFailure: false, solvingFailure: false,
  conditions, sourceHashes, ...bindingEvidence(conditions, sourceHashes),
  topologyProof: proveTopologyBinding(createShiftingEvidenceTask(8, 17 + index * 14, 2, true)),
  topologyBinding: { enforced: true, refusedResults: 0, refusals: [] },
  atnTotalInteractions: 12, atnTotalTransferBytes: 100, meanInputTokensPerCall: null,
  relativeInteractions: 1, relativeTransferBytes: 1,
  protocol: { requesterFeedback: { accepted: 1, rejected: 1, needsMore: 0 },
    stepUse: Array.from({ length: 8 }, (_, i) => ({ id: `node-${i}`, stepsUsed: 16 })), explicitRewires: [{ id: 'rewire-1', changed: true }],
    rewireTelemetry: { statusRewireCalls: 1, successfulRewires: 1, unchangedRewires: 0,
      blockedRewires: 0, ablationBlockedRewires: 0, pendingRewires: 0,
      priorStatusQueryCalls: 1, callsWithPriorStatusQuery: 1 } },
}) }
const comparison = () => protocol.SHIFTING_ARMS.flatMap(mode => Array.from({ length: 5 }, (_, i) => makeRun(mode, i)))
const probe = () => Array.from({ length: 5 }, (_, i) => makeRun('adaptive', i, 'adaptive-probe'))
const summarize = protocol.summarizeShiftingRuns as (runs: any[], probes?: any[]) => any
const summarizeProbe = (runs: ReturnType<typeof makeRun>[]) => {
  assert.equal(typeof (protocol as any).summarizeAdaptiveProbe, 'function', 'dedicated adaptive probe summary exists')
  return (protocol as any).summarizeAdaptiveProbe(runs)
}

test('adaptive probe counts attempted, blocked and unchanged rewires separately and fails without changed successes', () => {
  for (const kind of ['none', 'blocked', 'unchanged']) {
    const rows = probe().map(row => ({ ...row, protocol: { ...row.protocol,
      explicitRewires: kind === 'unchanged' ? [{ id: 'rewire-1', changed: false }] : [], rewireTelemetry: {
      ...row.protocol.rewireTelemetry, statusRewireCalls: kind === 'none' ? 0 : 1,
      successfulRewires: 0, unchangedRewires: kind === 'unchanged' ? 1 : 0,
      blockedRewires: kind === 'blocked' ? 1 : 0, ablationBlockedRewires: kind === 'blocked' ? 1 : 0,
    } } }))
    const summary = summarizeProbe(rows)
    assert.equal(summary.probeGatePassed, false)
    assert.equal(summary.runsWithSuccessfulRewire, 0)
    assert.equal(summary.rewireCounts.statusRewireCalls, kind === 'none' ? 0 : 5)
    assert.equal(summary.rewireCounts.successfulRewires, 0)
  }
})

test('adaptive probe requires successful attempts, distinct homogeneous runs, capability and headroom', () => {
  const rows = probe()
  rows[0].protocol.rewireTelemetry.successfulRewires = 0
  rows[0].protocol.rewireTelemetry.statusRewireCalls = 0
  rows[0].protocol.rewireTelemetry.callsWithPriorStatusQuery = 0
  rows[0].protocol.explicitRewires = []
  const summary = summarizeProbe(rows)
  assert.equal(summary.probeGatePassed, true)
  assert.equal(summary.runsWithSuccessfulRewire, 4)
  assert.equal(summary.rewireCounts.callsWithPriorStatusQuery, 4)
  assert.equal(summary.discovery.successRate, 1)
  const blocked = rows.map((row, i) => i ? row : ({ ...row, protocol: { ...row.protocol,
    rewireTelemetry: { ...row.protocol.rewireTelemetry, statusRewireCalls: 1, blockedRewires: 1 } } }))
  assert.equal(summarizeProbe(blocked).probeGatePassed, false, 'one blocked attempt closes admission')
  assert.equal(summarizeProbe(rows.slice(1)).probeGatePassed, false)
  assert.equal(summarizeProbe([...rows, rows[0]]).probeGatePassed, false)
  assert.equal(summarizeProbe(rows.map(row => ({ ...row, execution: 'scripted-test' }))).probeGatePassed, false)
  assert.equal(summarizeProbe(rows.map((row, i) => i ? row : ({ ...row, sourceHashes: { source: 'changed' } }))).probeGatePassed, false)
})

test('topology admission requires separate matching probe, nonzero real rejection, repeats and 80 percent step headroom', () => {
  const rows = comparison(), probes = probe()
  assert.equal(summarize(rows, probes).mayInterpretTopology, true)
  assert.equal(summarize(rows).mayInterpretTopology, false, 'comparison rewires cannot stand in for a prior separate probe')
  assert.equal(summarize([...rows, ...probes], probes).runs.length, 20, 'probe observations never count toward comparison arms')
  assert.equal(summarize(rows.slice(1), probes).mayInterpretTopology, false)
  assert.equal(summarize(rows, probes.map(row => ({ ...row, conditions: { ...row.conditions, perNodeSteps: 32 } }))).mayInterpretTopology, false)
  assert.equal(summarize(rows, probes.map(row => ({ ...row, sourceHashes: { source: 'changed' } }))).mayInterpretTopology, false)
  assert.equal(summarize(rows.map(row => ({ ...row, sourceHashes: {} })), probes.map(row => ({ ...row, sourceHashes: {} }))).mayInterpretTopology, false)
  assert.equal(summarize(rows, probes.map(row => ({ ...row, completedAt: 3000 }))).mayInterpretTopology, false)
  assert.equal(summarize(rows, probes.map(row => ({ ...row, protocol: { ...row.protocol, explicitRewires: [] } }))).mayInterpretTopology, false)
  assert.equal(summarize(rows.map(row => ({ ...row, protocol: { ...row.protocol,
    requesterFeedback: { accepted: 1, rejected: 0, needsMore: 0 } } })), probes.map(row => ({ ...row,
      protocol: { ...row.protocol, requesterFeedback: { accepted: 1, rejected: 0, needsMore: 0 } } }))).mayInterpretTopology, false)
  assert.equal(summarize(rows.map((row, i) => i ? row : ({ ...row, protocol: { ...row.protocol,
    stepUse: [{ id: 'node', stepsUsed: 17 }] } })), probes).mayInterpretTopology, false)
})

test('calibration reports each arm and seed ratio and rejects a configuration if any measured arm exceeds 80 percent', () => {
  const rows = comparison().filter(row => ['fixed', 'adaptive'].includes(row.mode)).map(row => ({ ...row, execution: 'scripted-test' }))
  const summary = summarize(rows)
  assert.equal(summary.calibrationGatePassed, true)
  assert.equal(summary.stepHeadroom.arms.find((arm: any) => arm.mode === 'adaptive').runs.length, 5)
  assert.equal(summary.stepHeadroom.arms.find((arm: any) => arm.mode === 'adaptive').runs[0].maxNodeStepRatio, 0.8)
  assert.equal(summary.mayInterpretTopology, false)
  rows[0].protocol.stepUse[0].stepsUsed = 17
  assert.equal(summarize(rows).calibrationGatePassed, false)
  assert.equal(summarize(rows).stepHeadroom.arms.find((arm: any) => arm.mode === rows[0].mode).runs[0].withinLimit, false)
})

test('malformed or missing identities, review counts, correctness and node coverage cannot open admission', () => {
  const rows = comparison(), probes = probe()
  assert.equal(summarize(rows.map(row => ({ ...row, sourceHashes: undefined })), probes).mayInterpretTopology, false)
  assert.equal(summarize(rows.map(row => ({ ...row, phase1Correct: 'false', phase2Correct: 'false' })), probes).fixedGatePassed, false)
  assert.equal(summarize(rows.map(row => ({ ...row, purpose: 'unknown' })), probes).mayInterpretTopology, false)
  assert.equal(summarize(rows.map(row => ({ ...row, conditions: { ...row.conditions, agents: 9 } })), probes).stepHeadroom.withinLimit, false)
  const malformed = (run: ReturnType<typeof makeRun>) => ({ ...run, protocol: { ...run.protocol,
    requesterFeedback: { ...run.protocol.requesterFeedback, rejected: '1' } } })
  assert.equal(summarize(rows.map(malformed), probes.map(malformed)).feedbackVarianceGatePassed, false)
})

test('comparison preflight refuses missing, unsuccessful, mismatched or later probes', () => {
  const expected = { model: 'test', conditions: makeRun('adaptive', 0).conditions, sourceHashes: { source: 'same' } }
  assert.ok(protocol.assertAdaptiveProbeAdmission(probe() as any, expected, 1000).probeGatePassed)
  assert.throws(() => protocol.assertAdaptiveProbeAdmission([], expected), /admission failed/)
  assert.throws(() => protocol.assertAdaptiveProbeAdmission(probe() as any, { ...expected, model: 'other' }), /model, configuration or source/)
  assert.throws(() => protocol.assertAdaptiveProbeAdmission(probe() as any, expected, 50), /completed before/)
})

test('probe rejection statistics stay separate and cannot supply comparison feedback variance', () => {
  const rows = comparison().map(row => ({ ...row, protocol: { ...row.protocol,
    requesterFeedback: { ...row.protocol.requesterFeedback, rejected: 0 } } }))
  const summary = summarize(rows, probe())
  assert.equal(summary.feedbackVarianceGatePassed, false)
  assert.equal(summary.mayInterpretTopology, false)
  assert.equal(summary.comparisonRejectedReviews, 0)
  assert.equal(summary.probeRejectedReviews, 5)
})

test('structural admission recomputes fixtures and requires constructive confirmation plus positive flow, including zero interceptions', () => {
  const probes = probe(), rows = comparison()
  const expected = { model: 'test', conditions: probes[0].conditions, sourceHashes: { source: 'same' } }
  const seeds = probes.map(row => row.conditions.seed)
  assert.ok(protocol.assertTopologyComparisonPreflight(probes as any, expected, seeds, 1000).probeGatePassed)
  assert.throws(() => protocol.assertTopologyComparisonPreflight(probes.map(row => ({ ...row, topologyProof: null })) as any,
    expected, seeds, 1000), /structural proof/)
  assert.equal(summarize(rows, probes).bindingReferenceGatePassed, true)
  assert.equal(summarize(rows, probes).factFlowAuditGatePassed, true)
  assert.throws(() => protocol.assertTopologyComparisonPreflight(probes.map(row => ({ ...row,
    bindingReference: null })) as any, expected, seeds, 1000), /constructive binding/)
  assert.throws(() => protocol.assertTopologyComparisonPreflight(probes.map(row => ({ ...row,
    factFlowAudit: { ...row.factFlowAudit, passed: false } })) as any, expected, seeds, 1000), /fact-flow/)
  const unaudited = rows.map((row, i) => i ? row : ({ ...row, factFlowAudit: { ...row.factFlowAudit, passed: false } }))
  assert.equal(summarize(unaudited, probes).mayInterpretTopology, false)
  assert.equal(summarize(unaudited, probes).excludedFactFlowRuns.length, 1)
  assert.equal(summarize(unaudited, probes).runs.length, 20, 'failed provenance runs are preserved but excluded from counted arms')
  assert.equal(summarize(rows.map(row => ({ ...row, topologyProof: null })), probes).mayInterpretTopology, false)
  assert.equal(summarize(rows.map(row => ({ ...row, topologyBinding: null })), probes).mayInterpretTopology, false)
  assert.equal(summarize(rows.map((row, i) => i ? row : ({ ...row, conditions: { ...row.conditions, seed: 99 } })), probes).mayInterpretTopology, false)
  const unpaired = rows.map((row, i) => i ? row : ({ ...row, conditions: { ...row.conditions, seed: 99 },
    topologyProof: proveTopologyBinding(createShiftingEvidenceTask(8, 99, 2, true)) }))
  assert.equal(summarize(unpaired, probes).structuralProofGatePassed, true)
  assert.equal(summarize(unpaired, probes).matchedSeeds, false)
  assert.equal(summarize(unpaired, probes).mayInterpretTopology, false)
  assert.equal(summarizeProbe(probes.map(row => ({ ...row, model: 'longcat-2.5-preview-free' }))).eligibleModel, false)
  const equal = summarize(rows, probes)
  assert.equal(equal.mayInterpretTopology, true)
  assert.equal(equal.consistentNonFixedAdvantage, false)
  assert.equal(equal.benefitClaim, 'not-supported', 'fixed failure or equal non-fixed completion never proves adaptive benefit')
})
