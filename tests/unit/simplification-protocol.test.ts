import { strict as assert } from 'node:assert'
import test from 'node:test'
import { assertSimplificationDesign, summarizeSimplificationRuns, SIMPLIFICATION_COST_CRITERION,
  type SimplificationDesign, type SimplificationObservation } from '../../experiments/simplification-protocol.ts'
import { simplificationPower } from '../../experiments/simplification-statistics.ts'
import { SIMPLIFICATION_ARMS, shiftingMechanisms } from '../../experiments/simplification-arms.ts'
import { bindingEvidence } from '../fixtures/binding-evidence.ts'

function fixture(failedMode?: string) {
  const power = simplificationPower(12), frozenAt = new Date().toISOString()
  const design: SimplificationDesign = { frozenAt, power, seeds: Array.from({ length: 12 }, (_, i) => 17 + i * 14),
    model: 'deepseek-v4.1-flash', sourceHashes: { fixture: 'same' }, criterion: 'corrected', margin: .25, lowPowerAcknowledged: true,
    maintainerDecision: { selectedBy: 'maintainer', rationale: 'test registered tolerance and budget', evidence: 'test fixture' },
    costCriterion: SIMPLIFICATION_COST_CRITERION,
    conditions: { agents: 8, chainLength: 2, topologyBinding: true, perNodeSteps: 48, maxCalls: 384,
      maxOutputTokens: 4096, timeoutMs: 600000, observedTokenLimit: 8000000, autoAdvance: false } }
  const rows: SimplificationObservation[] = SIMPLIFICATION_ARMS.flatMap(mode => design.seeds.map(seed => {
    const passed = mode !== failedMode, conditions = { ...design.conditions, seed } as any
    const evidence = bindingEvidence(conditions, design.sourceHashes), mechanisms = shiftingMechanisms(mode)
    const factFlowAudit = passed ? evidence.factFlowAudit : { version: 1 as const, passed: true, submittedCheckpoints: 0, auditedFacts: 0,
      facts: [], violations: [], noSubmission: true, interpretation: 'No asserted facts.' }
    return { runId: `${mode}-${seed}`, mode, model: design.model, execution: 'live-provider', purpose: 'comparison',
      sourceHashes: design.sourceHashes, conditions, startedAt: Date.parse(frozenAt) + 1, rawAudit: { passed: true },
      passed, phase1Submitted: passed, phase2Submitted: passed, phase1Correct: passed, phase2Correct: passed,
      submissionDisciplineFailure: !passed, solvingFailure: !passed, factFlowAudit,
      mechanisms, reference: { ...evidence.bindingReference.adaptive, topologyMode: mode, requesterRatings: mechanisms.requesterFeedback ? 6 : 0 },
      issuedModelCalls: passed ? mode === 'adaptive' ? 40 : 30 : 100, entrySteps: passed ? 20 : 48,
      atnTotalInteractions: passed ? mode === 'adaptive' ? 40 : 20 : 100, atnTotalTransferBytes: passed ? 1000 : 5000,
      meanInputTokensPerCall: null, relativeInteractions: null, relativeTransferBytes: null,
      stopReason: passed ? 'phase-2-submitted' : 'host-error:Error', failures: passed ? [] : [{ code: 'UNKNOWN', status: null }] }
  }))
  return { design, rows }
}

test('SIMPLIFICATION-DECISION: removal needs both the single ablation and minimal, never cheap calls alone', () => {
  const { design, rows } = fixture('minimal'), result = summarizeSimplificationRuns(rows, design)
  assert.equal(result.readyForDecision, true)
  assert.equal(result.comparisons.find(row => row.mode === 'no-feedback')!.nonInferiorityPassed, true)
  assert.equal(result.comparisons.find(row => row.mode === 'minimal')!.nonInferiorityPassed, false)
  for (const row of result.recommendations) {
    assert.equal(row.conclusion, '不确定')
    assert.equal(row.defaultAction, '保留')
    assert.equal(row.causalClaim, false)
  }
  assert.equal(result.failedRunsRetained, 12)
  assert.equal(result.arms.find(row => row.mode === 'minimal')!.failedConsumption.modelCalls.totalKnown, 1200)
  assert.equal(result.arms.find(row => row.mode === 'minimal')!.completedConsumption.modelCalls.mean, null)
  assert.equal(result.arms[0].completedConsumption.usage.inputTokens.knownTotal, null)
  assert.equal(result.arms[0].completedConsumption.usage.inputTokens.missingRunTelemetry, 12)
})

test('SIMPLIFICATION-DATA: duplicate, missing, unaudited, changed-source and pre-registration runs prevent recommendations', () => {
  const { design, rows } = fixture()
  assert.equal(summarizeSimplificationRuns(rows, design).recommendations[0].conclusion, '移除')
  const variants = [rows.slice(1), [...rows, rows[0]],
    rows.map((row, i) => i ? row : { ...row, rawAudit: { passed: false } }),
    rows.map((row, i) => i ? row : { ...row, sourceHashes: { fixture: 'changed' } }),
    rows.map((row, i) => i ? row : { ...row, startedAt: Date.parse(design.frozenAt) - 1 })]
  for (const variant of variants) {
    const result = summarizeSimplificationRuns(variant, design)
    assert.equal(result.readyForDecision, false)
    assert.ok(result.recommendations.every(row => row.defaultAction === '保留'))
  }
  assert.throws(() => assertSimplificationDesign({ ...design, power: simplificationPower(10), seeds: design.seeds.slice(0, 10) }), /Seeds/)
  assert.throws(() => assertSimplificationDesign({ ...design, lowPowerAcknowledged: false }), /Low power/)
  assert.throws(() => assertSimplificationDesign({ ...design, seeds: [...design.seeds].reverse() }), /Seeds/)
  assert.throws(() => assertSimplificationDesign({ ...design, conditions: { ...design.conditions, perNodeSteps: 49 } }), /frozen/)
})

test('SIMPLIFICATION-LITERAL: the superseded sign rule cannot be registered or authorize removal', () => {
  const { design, rows } = fixture('no-feedback')
  assert.throws(() => summarizeSimplificationRuns(rows, { ...design, criterion: 'literal-no-removal' } as any), /only lower/)
  const result = summarizeSimplificationRuns(rows, design)
  const comparison = result.comparisons.find(row => row.mode === 'no-feedback')!
  assert.ok(comparison.riskDifference.interval.upper < design.margin, 'the superseded rule would wrongly pass')
  assert.equal(comparison.riskDifference.estimate, -1)
  assert.equal(comparison.nonInferiorityPassed, false)
  assert.equal(result.recommendations.find(row => row.mode === 'no-feedback')!.defaultAction, '保留')
  assert.equal(result.recommendations.find(row => row.mode === 'no-feedback')!.conclusion, '不确定')
})

test('SIMPLIFICATION-COST: noninferiority alone and sub-threshold savings cannot support removal', () => {
  const { design, rows } = fixture()
  for (const interactions of [40, 39]) {
    const result = summarizeSimplificationRuns(rows.map(row => ({ ...row, atnTotalInteractions: row.mode === 'adaptive' ? 40 : interactions })), design)
    assert.ok(result.comparisons.every(row => row.nonInferiorityPassed))
    assert.ok(result.recommendations.every(row => !row.substantiveCostReduction && row.defaultAction === '保留'))
  }
  assert.throws(() => assertSimplificationDesign({ ...design, maintainerDecision: { ...design.maintainerDecision, rationale: '' } }), /Maintainer/)
  assert.throws(() => assertSimplificationDesign({ ...design, costCriterion: { ...design.costCriterion, minimumRelativeReduction: .01 } } as any), /cost criterion/)
  const otherPower = simplificationPower(12, .30)
  assert.doesNotThrow(() => assertSimplificationDesign({ ...design, margin: .30, power: otherPower, frozenAt: new Date().toISOString() }))
})

test('SIMPLIFICATION-FAILURE-COST: cheap jointly completed pairs cannot hide expensive failures', () => {
  const { design, rows } = fixture()
  const expensive = rows.map(row => row.mode === 'no-feedback' && row.conditions.seed === 17
    ? { ...row, passed: false, phase1Submitted: false, phase2Submitted: false, phase1Correct: false, phase2Correct: false,
      factFlowAudit: { version: 1 as const, passed: true, submittedCheckpoints: 0, auditedFacts: 0, facts: [], violations: [], noSubmission: true, interpretation: 'No asserted facts.' },
      atnTotalInteractions: 1000, issuedModelCalls: 384 } : row)
  const result = summarizeSimplificationRuns(expensive, design), arm = result.arms.find(row => row.mode === 'no-feedback')!
  const comparison = result.comparisons.find(row => row.mode === 'no-feedback')!
  assert.equal(result.readyForDecision, true)
  assert.equal(arm.allConsumption.interactions.totalKnown, 1220)
  assert.equal(arm.failedConsumption.modelCalls.totalKnown, 384)
  assert.equal(comparison.costSavings.pairedRuns, 12)
  assert.equal(comparison.jointlyCompletedCostSavings.interactions.mean, 20)
  assert.ok(comparison.costSavings.interactions.mean! < 0)
  assert.equal(result.recommendations.find(row => row.mode === 'no-feedback')!.substantiveCostReduction, false)
})

test('SIMPLIFICATION-COVERAGE: unknown cost measurements and untested minimal preserve uncertainty', () => {
  const { design, rows } = fixture()
  const result = summarizeSimplificationRuns(rows.map((row, i) => i === 12 ? { ...row, atnTotalInteractions: null } as any : row), design)
  assert.equal(result.comparisons[0].costSavings.interactions.unknownRuns, 1)
  assert.equal(result.recommendations[0].substantiveCostReduction, false)
  const three = summarizeSimplificationRuns(rows.filter(row => row.mode !== 'minimal'), { ...design, modes: ['adaptive', 'no-feedback', 'no-board'] })
  assert.equal(three.plannedRuns, 36)
  assert.equal(three.readyForDecision, true)
  assert.deepEqual(three.untestedArms, ['minimal'])
  assert.ok(three.recommendations.every(row => row.defaultAction === '保留'))
})
