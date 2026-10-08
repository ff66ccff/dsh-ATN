/** Live feasibility only: never a power calculation or a success-rate selection gate. */
import { isDeepStrictEqual } from 'node:util'
import type { EqualBudgetDesign } from './equal-budget-run.ts'
import { equalBudgetLiveCoverage, equalBudgetOutputDiagnostics, type EqualBudgetRunObservation } from './equal-budget-statistics.ts'

/** Round 11 reports output/audit limitations without selecting away difficult outcomes. */
function assessRound11Preflight(runs: readonly EqualBudgetRunObservation[], design: EqualBudgetDesign) {
  const plan = design.preflight!
  const selected = runs.filter(run => plan.seeds.includes(run.seed))
  const keys = selected.map(run => `${run.seed}/${run.mode}`)
  const expected = plan.seeds.flatMap(seed => design.modes.map(mode => `${seed}/${mode}`))
  // A malformed input matrix is not a model outcome or an additional feasibility criterion.
  if (new Set(keys).size !== keys.length || keys.some(key => !expected.includes(key))) throw new Error('Invalid round-11 preflight schedule')
  const complete = selected.length === plan.requiredRuns
  const liveCoverage = equalBudgetLiveCoverage(selected)
  const passedRuns = selected.filter(run => run.evaluation.passed).length
  const outputs = selected.map(run => ({ mode: run.mode, seed: run.seed,
    ...equalBudgetOutputDiagnostics(run, design.conditions.maxOutputTokens) }))
  const outputCoverageComplete = complete && outputs.every(output => output.outputCoverageComplete)
  const knownPeaks = outputs.flatMap(output => output.knownMaximumOutput === null ? [] : [output.knownMaximumOutput])
  const knownMaximumOutput = knownPeaks.length ? Math.max(...knownPeaks) : null
  const maximumOutputTokens = outputCoverageComplete ? knownMaximumOutput : null
  const completedOutputs = outputs.filter(output => selected.some(run => run.mode === output.mode && run.seed === output.seed && run.evaluation.passed))
  const completedMaximumOutputTokens = completedOutputs.length && completedOutputs.every(output => output.outputCoverageComplete && output.maximumOutputTokens !== null)
    ? Math.max(...completedOutputs.map(output => output.maximumOutputTokens!)) : null
  const integrity = selected.length > 0 && selected.every(run => run.execution === 'live-provider' && run.causalClaim === false &&
    run.model === design.model && isDeepStrictEqual(run.allocation, design.allocations.find(row => row.mode === run.mode)) && run.factFlowAudit?.passed === true)
  const status = !complete ? 'pending' : !liveCoverage.complete ? 'blocked-real-model-coverage'
    : passedRuns === 0 ? 'stopped-zero-completion' : 'passed'
  const category = status === 'pending' ? 'incomplete-preflight' : status === 'blocked-real-model-coverage' ? 'missing-real-model-dispatch'
    : status === 'stopped-zero-completion' ? 'zero-exact-completion' : 'feasible'
  const reason = status === 'pending' ? 'Finish the first three paired seeds before considering the main batch.'
    : status === 'blocked-real-model-coverage' ? 'Positive integer issuedModelCalls must equal metrics.totals.attempts in every attempted preflight run. Zero-call and unknown-dispatch attempts remain in the denominator; they are not model reasoning failures or architecture conclusions. This final round stops without replacement runs.'
      : status === 'stopped-zero-completion' ? 'No exact completion was observed. The final-round feasibility requirement failed; preserve all attempts and close the research line without a twelfth round or a smaller task.'
        : 'At least one exact completion and complete positive matching live-model dispatch coverage. Truncation, per-call headroom and audit gaps are report-only; this is not evidence of an architecture advantage.'
  return { version: 2, round: 11, status, observedRuns: selected.length, requiredRuns: plan.requiredRuns,
    passedRuns, liveCoverage, mainBatchAllowed: status === 'passed', researchLineTerminated: complete && status !== 'passed',
    gates: [{ id: 'at-least-one-exact-completion', passed: passedRuns > 0 },
      { id: 'positive-matching-real-model-calls', passed: complete && liveCoverage.complete }],
    diagnosis: { category, reason, healthyRuns: selected.filter(run => run.metrics && run.metrics.totals.errors === 0 && run.metrics.totals.aborted === 0 &&
      run.metrics.totals.incomplete === 0 && run.metrics.totals.inFlight === 0 && !/host-|exception|interrupted|timeout/.test(run.stopReason)).length,
      taskConsistency: design.references.every(reference => reference.passed) ? 'constructive-reference-consistent-not-model-feasibility' : 'reference-failed',
      observations: selected.map(run => ({ seed: run.seed, mode: run.mode, passed: run.evaluation.passed,
        stopReason: run.stopReason, modelCalls: run.issuedModelCalls, totalAgents: run.totalAgents, entrySteps: run.entrySteps })) },
    integrity, auditGating: false, outputGating: false,
    output: { maximumOutputTokens, knownMaximumOutput, headroomFraction: maximumOutputTokens === null ? null : 1 - maximumOutputTokens / design.conditions.maxOutputTokens,
      completedMaximumOutputTokens, completedHeadroomFraction: completedMaximumOutputTokens === null ? null : 1 - completedMaximumOutputTokens / design.conditions.maxOutputTokens,
      outputCoverageComplete, truncatedRuns: outputs.filter(output => output.truncatedCalls > 0).length,
      truncatedCalls: outputs.reduce((sum, output) => sum + output.truncatedCalls, 0),
      widespreadTruncation: null, maxOutputTokens: design.conditions.maxOutputTokens, minOutputHeadroom: null, widespreadTruncationRunFraction: null },
    perArm: design.modes.map(mode => { const arm = selected.filter(run => run.mode === mode)
      const unknownAudit = (run: EqualBudgetRunObservation) => !run.factFlowAudit || run.factFlowAudit.unknown === true
      return { mode, runs: outputs.filter(output => output.mode === mode), liveCoverage: equalBudgetLiveCoverage(arm),
        audit: { observedRuns: arm.length, passedRuns: arm.filter(run => !unknownAudit(run) && run.factFlowAudit?.passed === true).length,
          nonPassingRuns: arm.filter(run => run.factFlowAudit?.passed !== true).length,
          missingAuditRuns: arm.filter(run => !run.factFlowAudit).length,
          unknownAuditRuns: arm.filter(unknownAudit).length,
          failedAuditRuns: arm.filter(run => !unknownAudit(run) && run.factFlowAudit?.passed === false).length,
          positiveCompletionEvidenceRuns: arm.filter(run => run.factFlowAudit?.positiveCompletionEvidence === true).length,
          interpretation: 'Missing audit coverage remains unknown; failed or missing positive fact-flow evidence is reported without a main-batch gate.' } } }),
    retainedSeeds: plan.seeds, causalClaim: false,
    studyScope: 'prompt decomposition versus distributed structure under equal visible-call budgets' }
}

export function assessEqualBudgetPreflight(runs: readonly EqualBudgetRunObservation[], design: EqualBudgetDesign) {
  if (design.version === 3 && design.preflight) return assessRound11Preflight(runs, design)
  if (design.version !== 2 || !design.preflight) throw new Error('Live preflight requires a round-10 design')
  const plan = design.preflight
  const selected = runs.filter(run => plan.seeds.includes(run.seed))
  const keys = selected.map(run => `${run.seed}/${run.mode}`)
  const expected = plan.seeds.flatMap(seed => design.modes.map(mode => `${seed}/${mode}`))
  const scheduleValid = new Set(keys).size === keys.length && keys.every(key => expected.includes(key))
  const complete = scheduleValid && selected.length === plan.requiredRuns
  const liveCoverage = equalBudgetLiveCoverage(selected)
  const outputs = selected.map(run => ({ mode: run.mode, seed: run.seed,
    ...equalBudgetOutputDiagnostics(run, design.conditions.maxOutputTokens) }))
  const passedRuns = selected.filter(run => run.evaluation.passed).length
  const truncatedRuns = outputs.filter(output => output.truncatedCalls > 0).length
  const widespreadTruncation = truncatedRuns / plan.requiredRuns >= plan.widespreadTruncationRunFraction!
  const outputCoverageComplete = complete && outputs.every(output => output.outputCoverageComplete && output.truncationCoverageComplete)
  const knownPeaks = outputs.flatMap(output => output.knownMaximumOutput === null ? [] : [output.knownMaximumOutput])
  const knownMaximumOutput = knownPeaks.length ? Math.max(...knownPeaks) : null
  const maximumOutputTokens = outputCoverageComplete ? knownMaximumOutput : null
  const headroomFraction = maximumOutputTokens === null ? null : 1 - maximumOutputTokens / design.conditions.maxOutputTokens
  const completedOutputs = outputs.filter(output => selected.some(run => run.mode === output.mode && run.seed === output.seed && run.evaluation.passed))
  const completedMaximumOutputTokens = outputCoverageComplete && completedOutputs.length && completedOutputs.every(output => output.maximumOutputTokens !== null)
    ? Math.max(...completedOutputs.map(output => output.maximumOutputTokens!)) : null
  const completedHeadroomFraction = completedMaximumOutputTokens === null ? null : 1 - completedMaximumOutputTokens / design.conditions.maxOutputTokens
  const integrity = scheduleValid && selected.every(run => run.execution === 'live-provider' && run.causalClaim === false &&
    run.model === design.model && isDeepStrictEqual(run.allocation, design.allocations.find(row => row.mode === run.mode)) &&
    run.factFlowAudit?.passed === true)
  const healthy = selected.filter(run => run.metrics && run.metrics.totals.attempts > 0 &&
    run.metrics.totals.errors === 0 && run.metrics.totals.aborted === 0 && run.metrics.totals.incomplete === 0 && run.metrics.totals.inFlight === 0 &&
    !/host-|exception|interrupted|timeout/.test(run.stopReason))
  let status = 'pending', category = 'incomplete-preflight', reason = 'Finish the first three paired seeds before considering the main batch.'
  let researchLineTerminated = false
  if (!scheduleValid) {
    status = 'blocked-integrity'; category = 'invalid-schedule'; reason = 'Duplicate or unregistered preflight observations.'
  } else if (complete && !liveCoverage.complete) {
    status = 'blocked-real-model-coverage'; category = 'missing-real-model-dispatch'
    reason = 'All attempted records remain in the denominator, but zero-dispatch or unverified-dispatch attempts cannot certify the required live-model preflight. Stop the main batch and diagnose model routing/transport; do not attribute these records to architecture or replace failed samples.'
  } else if (complete && passedRuns === 0) {
    status = 'stopped-zero-completion'
    if (!integrity || !outputCoverageComplete) {
      category = 'integrity-or-telemetry-failure'
      reason = 'Zero completion stops the main batch, but missing audit/allocation integrity or incomplete output coverage prevents attributing failure to output capacity or decomposition. Preserve all samples for diagnosis.'
    } else if (widespreadTruncation && healthy.length === plan.requiredRuns) {
      category = 'single-call-output-budget'
      reason = 'All 12 live runs failed exact completion and at least 25% hit the common output cap without provider/host failure. The round-9 output bottleneck persists under the current model and Harness; no architecture advantage was observed. Stop this research line; do not shrink the task to seek a passing arm.'
      researchLineTerminated = true
    } else if (healthy.length === plan.requiredRuns && selected.every(run => run.stopReason === 'quiescent-without-submission')) {
      category = 'decomposition-not-completed'
      reason = 'All 12 otherwise healthy runs became quiescent without a submission. Under this model/Harness, the observed read/reason/merge workflow did not complete; this does not establish a general model incapacity. No architecture advantage was observed. Stop this research line rather than keep shrinking the task.'
      researchLineTerminated = true
    } else {
      category = healthy.length < plan.requiredRuns ? 'execution-or-telemetry-failure' : 'incorrect-arithmetic-or-merge'
      reason = 'Zero exact completions stops the main batch. Constructive checks establish task consistency only; retained errors/answers require diagnosis and cannot be replaced by successful reruns. Available evidence does not isolate output budget or decomposition as the cause.'
    }
  } else if (complete && !integrity) {
    status = 'blocked-integrity'; category = 'audit-or-allocation'; reason = 'Live identity, equal allocation, model identity or positive fact-flow audit is incomplete.'
  } else if (complete && widespreadTruncation) {
    status = 'blocked-truncation'; category = 'widespread-truncation'; reason = 'At least 25% of preflight runs hit the output cap. Main batch is blocked; retain this cohort before any permitted separately preregistered unit-size adjustment.'
  } else if (complete && !outputCoverageComplete) {
    status = 'blocked-incomplete-telemetry'; category = 'unknown-output-coverage'; reason = 'Unknown output or finish coverage prevents certifying headroom; unknown is not zero.'
  } else if (complete && (completedHeadroomFraction === null || completedHeadroomFraction < plan.minOutputHeadroom!)) {
    status = 'blocked-output-headroom'; category = 'insufficient-output-headroom'; reason = 'The maximum live per-call output did not demonstrate the preregistered 40% headroom; main batch is blocked.'
  } else if (complete) {
    status = 'passed'; category = 'feasible'; reason = 'At least one exact completion, no widespread truncation, complete output coverage and at least 40% per-call output headroom. This is feasibility only, not statistical evidence of an architecture advantage.'
  }
  return { version: 1, round: 10, status, observedRuns: selected.length, requiredRuns: plan.requiredRuns,
    passedRuns, liveCoverage, mainBatchAllowed: status === 'passed', researchLineTerminated,
    diagnosis: { category, reason, healthyRuns: healthy.length,
      taskConsistency: design.references.every(reference => reference.passed) ? 'constructive-reference-consistent-not-model-feasibility' : 'reference-failed',
      observations: selected.map(run => ({ seed: run.seed, mode: run.mode, passed: run.evaluation.passed,
        stopReason: run.stopReason, modelCalls: run.issuedModelCalls, totalAgents: run.totalAgents, entrySteps: run.entrySteps })) },
    integrity, output: { maximumOutputTokens, knownMaximumOutput, headroomFraction, completedMaximumOutputTokens, completedHeadroomFraction, outputCoverageComplete,
      truncatedRuns, truncatedCalls: outputs.reduce((sum, row) => sum + row.truncatedCalls, 0), widespreadTruncation,
      maxOutputTokens: design.conditions.maxOutputTokens, minOutputHeadroom: plan.minOutputHeadroom,
      widespreadTruncationRunFraction: plan.widespreadTruncationRunFraction },
    perArm: design.modes.map(mode => ({ mode, runs: outputs.filter(row => row.mode === mode) })),
    retainedSeeds: plan.seeds, causalClaim: false,
    studyScope: 'coordination overhead versus parallelism, not context pressure' }
}
