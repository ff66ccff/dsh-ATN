import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { completionInterval, completionPower, exactMcNemar, meanInterval, studentT95, holmAdjusted } from '../../experiments/comparison-statistics.ts'
import { selectStaticWidePeers, STATIC_WIDE_POLICY } from '../../experiments/static-wide-topology.ts'
import { summarizeAdaptiveProbe, summarizeShiftingRuns, SHIFTING_ARMS, type ShiftingRunObservation } from '../../experiments/shifting-evidence-protocol.ts'
import { bindingEvidence } from '../fixtures/binding-evidence.ts'
import { createShiftingEvidenceTask } from '../../experiments/shifting-evidence-task.ts'
import { proveTopologyBinding } from '../../experiments/topology-binding-proof.ts'

const run = (mode: string, index: number, correct = true): ShiftingRunObservation => {
  const conditions = { seed: 17 + index * 14, perNodeSteps: 48, agents: 8, chainLength: 2, topologyBinding: true as const, maxCalls: 384, timeoutMs: 600000 }
  const sourceHashes = { source: 'same' }
  return { runId: `${mode}-${index}`, mode, model: 'deepseek-v4.1-flash', execution: 'live-provider', purpose: 'comparison',
    passed: correct, phase1Submitted: correct, phase2Submitted: correct, phase1Correct: correct, phase2Correct: correct,
    submissionDisciplineFailure: false, solvingFailure: !correct, conditions, sourceHashes,
    ...bindingEvidence(conditions, sourceHashes),
    ...(!correct ? { factFlowAudit: { version: 1, passed: true, submittedCheckpoints: 0, auditedFacts: 0, facts: [], violations: [], noSubmission: true, interpretation: 'No asserted facts.' } } : {}),
    topologyProof: proveTopologyBinding(createShiftingEvidenceTask(8, conditions.seed, 2, true)),
    topologyBinding: { enforced: true, refusedResults: 0, refusals: [] }, issuedModelCalls: correct ? [10, 20, 30, 40, 50][index] : 100 + index,
    atnTotalInteractions: correct ? 20 : 200, atnTotalTransferBytes: correct ? 1000 : 10000, entrySteps: correct ? 12 : 48,
    meanInputTokensPerCall: null, relativeInteractions: null, relativeTransferBytes: null, stopReason: correct ? 'phase-2-submitted' : 'timeout',
    protocol: { requesterFeedback: { accepted: correct ? 4 : 0, rejected: 0, needsMore: 0 },
      rewireTelemetry: { statusRewireCalls: 0, successfulRewires: 0, unchangedRewires: 0, blockedRewires: 0, ablationBlockedRewires: 0,
        pendingRewires: 0, priorStatusQueryCalls: 0, callsWithPriorStatusQuery: 0 }, explicitRewires: [],
      stepUse: Array.from({ length: 8 }, (_, i) => ({ id: `node-${i}`, stepsUsed: correct ? 12 : 48 })) } }
}

test('REVISED-INTERVAL: 3/5 and 4/5 report Wilson intervals and power, never a point-estimate capability verdict', () => {
  const a = completionInterval(3, 5), b = completionInterval(4, 5)
  assert.ok(Math.abs(a.interval!.lower - 0.2307242812760128) < 1e-12)
  assert.ok(Math.abs(a.interval!.upper - 0.882379225767352) < 1e-12)
  assert.ok(Math.abs(b.interval!.lower - 0.37553462976252533) < 1e-12)
  assert.ok(Math.abs(b.interval!.upper - 0.9637758913675698) < 1e-12)
  assert.ok(a.interval!.upper > b.interval!.lower)
  for (const correct of [3, 4]) {
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...run('adaptive', i, i < correct), purpose: 'adaptive-probe' as const }))
    const summary = summarizeAdaptiveProbe(rows)
    assert.equal('capabilityGatePassed' in summary, false)
    assert.equal(summary.probeGatePassed, true)
    assert.equal(summary.completion.successes, correct)
    assert.match(summary.completion.power.caution, /60 个百分点/)
    assert.equal(summary.completion.power.minimumDetectableEffect, null)
  }
})

test('REVISED-POWER: five exact paired observations cannot reject even the extreme difference', () => {
  assert.equal(exactMcNemar(5, 0), 0.0625)
  assert.equal(exactMcNemar(3, 2), 1)
  assert.equal(completionPower(5).maximumPowerAtThisN, 0)
  assert.equal(completionPower(5).minimumDetectableEffectPercentagePoints, null)
  assert.ok(completionPower(6).minimumDetectableEffect! > 0.96)
  assert.deepEqual(holmAdjusted([0.03, 0.01, 0.5]), [0.06, 0.03, 0.5])
})

test('REVISED-EFFICIENCY: three successes and two failures have separate means, intervals and usage coverage', () => {
  const rows = Array.from({ length: 5 }, (_, i) => run('adaptive', i, i < 3))
  const arm = summarizeShiftingRuns(rows).arms.find(arm => arm.mode === 'adaptive')!
  assert.equal(arm.completion.successes, 3)
  assert.equal(arm.efficiency.runs, 3)
  assert.equal(arm.efficiency.modelCalls.mean, 20)
  assert.equal(arm.efficiency.modelCalls.totalKnown, 60)
  assert.equal(arm.failedConsumption.runs, 2)
  assert.equal(arm.failedConsumption.modelCalls.mean, 103.5)
  assert.equal(arm.failedConsumption.modelCalls.totalKnown, 207)
  assert.equal(arm.failedConsumption.runsDetail.length, 2)
  assert.ok(arm.efficiency.modelCalls.interval!.upper < 45)
  assert.equal(arm.efficiency.meanInputTokensPerCall.knownRuns, 0)
  assert.equal(arm.efficiency.meanInputTokensPerCall.unknownRuns, 3)
  assert.equal(arm.efficiency.meanInputTokensPerCall.mean, null)
  assert.equal(arm.efficiency.usage.inputTokens.knownTotal, null)
  assert.equal(arm.efficiency.usage.inputTokens.missingRunTelemetry, 3)
  assert.equal(arm.costMultiples.modelCalls.mean, null)
  assert.equal(arm.costMultiples.modelCalls.status, 'undefined-zero-reference')
  assert.equal(meanInterval([null, undefined]).mean, null)
  assert.equal(meanInterval([12]).interval, null)
  assert.ok(Math.abs(studentT95(2) - 4.30265272974946) < 1e-10)
  assert.ok(Math.abs(studentT95(4) - 2.7764451051977987) < 1e-10)
})

test('REVISED-SIGNAL: direct five-arm comparison requires one adaptive completion only and never claims small-sample benefit', () => {
  const rows = SHIFTING_ARMS.flatMap(mode => Array.from({ length: 5 }, (_, i) => run(mode, i, mode === 'adaptive' && i === 0)))
  const summary = summarizeShiftingRuns(rows)
  assert.equal(summary.mayInterpretTopology, true, 'a single completion is the specified post-comparison signal')
  assert.equal(summary.stepHeadroom.withinLimit, false, 'budget exhaustion is retained without an outcome gate')
  assert.equal(summary.indistinguishablePairs.length, 10)
  assert.equal(summary.benefitClaim, 'not-supported')
  assert.equal(summary.causalClaim, false)
  const zero = summarizeShiftingRuns(SHIFTING_ARMS.flatMap(mode => Array.from({ length: 5 }, (_, i) => run(mode, i, false))))
  assert.equal(zero.hasComparableSignal, false)
  assert.equal(zero.mayInterpretTopology, false)
  assert.equal(zero.interpretation, 'no-comparable-signal')
  const extreme = summarizeShiftingRuns(SHIFTING_ARMS.flatMap(mode => Array.from({ length: 5 }, (_, i) => run(mode, i, mode === 'adaptive'))))
  assert.equal(extreme.comparisons.find(pair => pair.a === 'adaptive' && pair.b === 'fixed-wide')!.pValue, 0.0625)
  assert.equal(extreme.benefitClaim, 'not-supported', 'disjoint marginal intervals cannot replace a paired test')
})

test('REVISED-WIDE-INPUTS: static selector takes only public identities and is blind to both phases and fixture', async () => {
  const nodes = Array.from({ length: 8 }, (_, i) => `node-${i}`), selected = selectStaticWidePeers(nodes)
  assert.deepEqual(selected[nodes[0]], ['node-7', 'node-1', 'node-2', 'node-3'])
  assert.equal(STATIC_WIDE_POLICY.usesFixture, false)
  assert.equal(STATIC_WIDE_POLICY.usesPhaseInformation, false)
  for (const peers of Object.values(selected)) assert.equal(new Set(peers).size, 4)
  const text = await readFile(new URL('../../experiments/static-wide-topology.ts', import.meta.url), 'utf8')
  const source = ts.createSourceFile('selector.ts', text, ts.ScriptTarget.Latest, true)
  assert.equal(source.statements.filter(ts.isImportDeclaration).length, 0, 'no fixture/scenario imports are available')
  const fn = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === 'selectStaticWidePeers')!
  assert.equal(fn.parameters.length, 1)
  assert.equal(fn.parameters[0].name.getText(source), 'publicNodeIds')
  assert.doesNotMatch(fn.body!.getText(source), /scenario|fixture|phase|seed|evidence|task\./i)
  assert.throws(() => selectStaticWidePeers(['a', 'b']), /at least five/)
})
