/** No capability or topology interpretation without repeated, homogeneous evidence. */
import { createShiftingEvidenceTask } from './shifting-evidence-task.ts'
import { isComparisonSeed, proveTopologyBinding, type TopologyBindingProof } from './topology-binding-proof.ts'
import { bindingReferenceGate, type BindingReferencePair, type FactFlowAudit } from './topology-binding-audit.ts'
import { completionInterval, meanInterval, exactMcNemar, holmAdjusted } from './comparison-statistics.ts'
import type { referenceCostRatios } from './topology-binding-audit.ts'
import type { TelemetrySnapshot, TelemetryTotals } from './telemetry.ts'
export const SHIFTING_ARMS = ['adaptive', 'fixed', 'fixed-wide', 'no-feedback', 'no-board'] as const
export const SHIFTING_STEP_RATIO_LIMIT = 0.8
export interface ShiftingRewireCounts {
  statusRewireCalls: number; successfulRewires: number; unchangedRewires: number
  blockedRewires: number; ablationBlockedRewires: number; pendingRewires: number
  priorStatusQueryCalls: number; callsWithPriorStatusQuery: number
}
export interface ShiftingProtocolObservation {
  requesterFeedback: { accepted: number; rejected: number; needsMore: number }
  rewireTelemetry: ShiftingRewireCounts
  stepUse: Array<{ id: string; stepsUsed: number; lifecycle?: string }>
  explicitRewires?: Array<{ id: string; changed: boolean; [key: string]: unknown }>
  [key: string]: unknown
}
export interface ShiftingRunObservation {
  runId: string; mode: string; model: string; execution: string; passed: boolean
  purpose?: 'comparison' | 'adaptive-probe'
  startedAt?: number; completedAt?: number
  phase1Submitted: boolean; phase1Correct: boolean; phase2Submitted: boolean; phase2Correct: boolean
  submissionDisciplineFailure: boolean; solvingFailure: boolean
  conditions: { seed: number; [key: string]: unknown }
  sourceHashes: Record<string, string>
  protocol?: ShiftingProtocolObservation | null
  topologyProof?: TopologyBindingProof | null
  topologyBinding?: { enforced: boolean; refusedResults: number; refusals: Array<{ code: string }> } | null
  bindingReference?: BindingReferencePair | null
  factFlowAudit?: FactFlowAudit | null
  issuedModelCalls?: number; entrySteps?: number | null
  atnMessages?: number; stopReason?: string; failures?: unknown[]
  costRelativeToReference?: ReturnType<typeof referenceCostRatios>
  metrics?: Pick<TelemetrySnapshot, 'totals'> | null
  atnTotalInteractions: number; atnTotalTransferBytes: number; meanInputTokensPerCall: number | null
  relativeInteractions: number | null; relativeTransferBytes: number | null
}

const rewireFields = ['statusRewireCalls', 'successfulRewires', 'unchangedRewires', 'blockedRewires',
  'ablationBlockedRewires', 'pendingRewires', 'priorStatusQueryCalls', 'callsWithPriorStatusQuery'] as const
const signature = (run: Pick<ShiftingRunObservation, 'model' | 'execution' | 'conditions' | 'sourceHashes'>) => JSON.stringify({ model: run.model, execution: run.execution,
  conditions: Object.entries(run.conditions).filter(([key]) => key !== 'seed').sort(),
  sourceHashes: Object.entries(run.sourceHashes).sort() })
const hasSourceIdentity = (run: ShiftingRunObservation) => run.sourceHashes && typeof run.sourceHashes === 'object' &&
  Object.entries(run.sourceHashes).length > 0 && Object.entries(run.sourceHashes)
    .every(([key, hash]) => key.length > 0 && typeof hash === 'string' && hash.length > 0) &&
  run.conditions && typeof run.conditions === 'object' && typeof run.model === 'string' && run.model.length > 0
const homogeneous = (runs: readonly ShiftingRunObservation[]) => runs.length > 0 && runs.every(hasSourceIdentity) && new Set(runs.map(signature)).size === 1
const unique = (runs: readonly ShiftingRunObservation[]) => runs.every(run => typeof run.runId === 'string' && run.runId.length > 0) &&
  new Set(runs.map(run => run.runId)).size === runs.length
export const positiveFactFlowGate = (run: ShiftingRunObservation) => {
  const audit = run.factFlowAudit
  return audit?.passed === true && audit.version === 1 && Array.isArray(audit.violations) && audit.violations.length === 0 &&
    Array.isArray(audit.facts) && audit.auditedFacts === audit.facts.length &&
    audit.submittedCheckpoints === Number(run.phase1Submitted) + Number(run.phase2Submitted) &&
    audit.noSubmission === (audit.submittedCheckpoints === 0) &&
    (!run.phase1Correct || audit.facts.filter(fact => fact.phase === 1).length === run.conditions.chainLength) &&
    (!run.phase2Correct || audit.facts.filter(fact => fact.phase === 2).length === run.conditions.chainLength)
}

export function shiftingStepHeadroom(run: Pick<ShiftingRunObservation, 'conditions' | 'protocol'>) {
  const budget = run.conditions?.perNodeSteps
  const agents = run.conditions?.agents
  const rows = run.protocol?.stepUse
  const observed = typeof budget === 'number' && Number.isSafeInteger(budget) && budget > 0 &&
    Array.isArray(rows) && rows.length > 0 && rows.every(row => row && typeof row.id === 'string' && row.id.length > 0 &&
      Number.isSafeInteger(row.stepsUsed) && row.stepsUsed >= 0) && new Set(rows.map(row => row.id)).size === rows.length &&
    (agents === undefined || (Number.isSafeInteger(agents) && (agents as number) > 0 && rows.length === agents))
  const maxNodeSteps = observed ? Math.max(...rows!.map(row => row.stepsUsed)) : null
  const maxNodeStepRatio = maxNodeSteps === null ? null : maxNodeSteps / (budget as number)
  return { perNodeSteps: typeof budget === 'number' ? budget : null, maxNodeSteps, maxNodeStepRatio,
    limit: SHIFTING_STEP_RATIO_LIMIT, observed, withinLimit: observed && maxNodeStepRatio! <= SHIFTING_STEP_RATIO_LIMIT }
}

/** Probe quality validates observations. Completion, discovery and headroom are descriptive. */
export function summarizeAdaptiveProbe(runs: readonly ShiftingRunObservation[]) {
  const validPurpose = runs.length > 0 && runs.every(run => run.mode === 'adaptive' && run.purpose === 'adaptive-probe')
  const liveProvider = runs.length > 0 && runs.every(run => run.execution === 'live-provider')
  const completeTelemetry = runs.length > 0 && runs.every(run => {
    const counts = run.protocol?.rewireTelemetry
    const commits = run.protocol?.explicitRewires
    return counts && rewireFields.every(field => Number.isSafeInteger(counts[field]) && counts[field] >= 0) &&
      counts.statusRewireCalls === counts.successfulRewires + counts.unchangedRewires + counts.blockedRewires + counts.pendingRewires &&
      counts.pendingRewires === 0 && counts.ablationBlockedRewires <= counts.blockedRewires &&
      counts.callsWithPriorStatusQuery <= counts.statusRewireCalls && Array.isArray(commits) &&
      commits.every(row => typeof row.changed === 'boolean' && typeof row.id === 'string' && row.id.length > 0) &&
      new Set(commits.map(row => row.id)).size === commits.length &&
      commits.filter(row => row.changed === true).length === counts.successfulRewires &&
      commits.filter(row => row.changed === false).length === counts.unchangedRewires
  })
  const rewireCounts = Object.fromEntries(rewireFields.map(field => [field,
    runs.reduce((sum, run) => sum + (run.protocol?.rewireTelemetry?.[field] ?? 0), 0)])) as unknown as ShiftingRewireCounts
  const runsWithSuccessfulRewire = runs.filter(run => (run.protocol?.rewireTelemetry?.successfulRewires ?? 0) > 0).length
  const successfulRewireRunRate = runs.length ? runsWithSuccessfulRewire / runs.length : null
  const homogeneousRuns = homogeneous(runs), uniqueRuns = unique(runs)
  const successRate = rewireCounts.statusRewireCalls > 0 ? rewireCounts.successfulRewires / rewireCounts.statusRewireCalls : null
  const discovery = { attempts: rewireCounts.statusRewireCalls, successful: rewireCounts.successfulRewires,
    blocked: rewireCounts.blockedRewires, unchanged: rewireCounts.unchangedRewires, pending: rewireCounts.pendingRewires,
    successRate, discoverabilityProblem: rewireCounts.blockedRewires > 0,
    status: !completeTelemetry ? (rewireCounts.pendingRewires > 0 ? 'pending' : 'invalid-telemetry')
      : rewireCounts.statusRewireCalls === 0 ? 'not-observed' : rewireCounts.blockedRewires > 0 ? 'blocked'
        : successRate === 1 ? 'passed' : 'unchanged',
    passed: completeTelemetry && rewireCounts.statusRewireCalls >= 1 && successRate === 1 }
  const correct = runs.filter(run => run.phase1Correct === true && run.phase2Correct === true).length
  const twoPhaseSuccessRate = runs.length ? correct / runs.length : null
  const eligibleModel = runs.length > 0 && runs.every(run => run.model !== 'longcat-2.5-preview-free')
  const completion = completionInterval(correct, runs.length)
  const stepHeadroomPassed = runs.length > 0 && runs.every(run => shiftingStepHeadroom(run).withinLimit)
  const factFlowAuditGatePassed = runs.length > 0 && runs.every(run => run.conditions.topologyBinding !== true || positiveFactFlowGate(run))
  const bindingReferenceGatePassed = runs.length > 0 && runs.every(run => run.conditions.topologyBinding !== true || bindingReferenceGate(run.bindingReference, run))
  const probeGatePassed = validPurpose && liveProvider && completeTelemetry && homogeneousRuns && uniqueRuns &&
    eligibleModel && runs.length >= 5 && factFlowAuditGatePassed && bindingReferenceGatePassed
  return { probeGatePassed, repeats: runs.length, runsWithSuccessfulRewire, successfulRewireRunRate,
    discovery, correct, twoPhaseSuccessRate, completion, eligibleModel, stepHeadroomPassed,
    validPurpose, liveProvider, completeTelemetry, homogeneous: homogeneousRuns, uniqueRuns, rewireCounts,
    factFlowAuditGatePassed, bindingReferenceGatePassed,
    runs: [...runs], interpretation: 'mechanism-and-adaptive-capability-only', causalClaim: false }
}

/** Stop live comparison before provider calls when the earlier probe is absent or invalid. */
export function assertAdaptiveProbeAdmission(runs: readonly ShiftingRunObservation[],
  expected: Pick<ShiftingRunObservation, 'model' | 'conditions' | 'sourceHashes'>, comparisonStartedAt = Date.now()) {
  const summary = summarizeAdaptiveProbe(runs)
  if (!summary.probeGatePassed) throw new Error('Adaptive probe admission failed: require >=5 distinct homogeneous live observations of an eligible model with valid telemetry and provenance; completion is reported as an interval')
  if (signature(runs[0]) !== signature({ ...expected, execution: 'live-provider' })) {
    throw new Error('Adaptive probe admission failed: model, configuration or source differs from the planned comparison')
  }
  if (!runs.every(run => Number.isSafeInteger(run.completedAt) && run.completedAt! > 0 && run.completedAt! <= comparisonStartedAt)) {
    throw new Error('Adaptive probe admission failed: probe must be completed before the comparison')
  }
  return summary
}

/** Recompute from the reported fixture conditions instead of trusting a stored verdict. */
export function structuralBindingGate(runs: readonly ShiftingRunObservation[]) {
  return runs.length > 0 && runs.every(run => {
    try {
      if (run.conditions?.topologyBinding !== true || run.topologyBinding?.enforced !== true ||
        !Number.isSafeInteger(run.conditions.agents) || !Number.isSafeInteger(run.conditions.chainLength)) return false
      const task = createShiftingEvidenceTask(run.conditions.agents as number, run.conditions.seed,
        run.conditions.chainLength as number, true)
      return isComparisonSeed(task, run.topologyProof)
    } catch { return false }
  })
}

/** Collect comparison directly. Historical probes identify a usable model, not an outcome gate. */
export function assertTopologyComparisonPreflight(probes: readonly ShiftingRunObservation[],
  expected: Pick<ShiftingRunObservation, 'model' | 'conditions' | 'sourceHashes'>, seeds: readonly number[], startedAt = Date.now()) {
  if (seeds.length < 5 || new Set(seeds).size !== seeds.length) throw new Error('Topology comparison admission failed: require at least five distinct seeds')
  if (expected.model === 'longcat-2.5-preview-free') throw new Error('Topology comparison admission failed: LongCat is excluded')
  if (!hasSourceIdentity({ ...expected, execution: 'live-provider' } as ShiftingRunObservation)) throw new Error('Topology comparison admission failed: source or model identity missing')
  for (const seed of seeds) {
    const task = createShiftingEvidenceTask(expected.conditions.agents as number, seed, expected.conditions.chainLength as number, true)
    if (expected.conditions.topologyBinding !== true || !isComparisonSeed(task, proveTopologyBinding(task))) {
      throw new Error(`Topology comparison admission failed: reachable or unbound seed ${seed}`)
    }
  }
  return { preflightPassed: true, seeds: [...seeds], startedAt, probe: summarizeAdaptiveProbe(probes),
    statement: 'No small-sample capability gate. Fresh same-source constructive references and positive fact-flow audits are required for each comparison run.' }
}

function consumption(rows: readonly ShiftingRunObservation[]) {
  const metric = (field: 'issuedModelCalls' | 'atnTotalInteractions' | 'atnTotalTransferBytes' | 'entrySteps' | 'atnMessages' | 'meanInputTokensPerCall') => meanInterval(rows.map(run => run[field]))
  const usageFields: Array<keyof TelemetryTotals['tokens']> = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']
  const knownCalls = (field: keyof TelemetryTotals['tokens']) => rows.reduce((sum, run) => sum + (run.metrics
    ? run.metrics.totals.settledAttempts - run.metrics.totals.tokens[field].unknownCalls : 0), 0)
  const usage = Object.fromEntries(usageFields.map(field => [field, {
    knownTotal: knownCalls(field) ? rows.reduce((sum, run) => sum + (run.metrics?.totals?.tokens?.[field]?.known ?? 0), 0) : null,
    knownCalls: knownCalls(field),
    unknownCalls: rows.reduce((sum, run) => sum + (run.metrics?.totals?.tokens?.[field]?.unknownCalls ?? 0), 0),
    missingRunTelemetry: rows.filter(run => !run.metrics?.totals?.tokens?.[field]).length,
  }]))
  return { runs: rows.length, modelCalls: metric('issuedModelCalls'), interactions: metric('atnTotalInteractions'),
    transferBytes: metric('atnTotalTransferBytes'), entrySteps: metric('entrySteps'), messages: metric('atnMessages'),
    meanInputTokensPerCall: metric('meanInputTokensPerCall'), usage,
    referenceCost: { knownTotal: rows.some(run => run.metrics && run.metrics.totals.settledAttempts > run.metrics.totals.cost.unknownCalls)
      ? rows.reduce((sum, run) => sum + (run.metrics?.totals?.cost?.knownAmount ?? 0), 0) : null,
      knownCalls: rows.reduce((sum, run) => sum + (run.metrics ? run.metrics.totals.settledAttempts - run.metrics.totals.cost.unknownCalls : 0), 0),
      unknownCalls: rows.reduce((sum, run) => sum + (run.metrics?.totals?.cost?.unknownCalls ?? 0), 0),
      missingRunTelemetry: rows.filter(run => !run.metrics?.totals?.cost).length },
    unknownUsagePolicy: 'Known totals are partial when unknownCalls or missingRunTelemetry is nonzero. Unknown usage/cost is never zero; model calls count actual budget admissions independently of token usage.' }
}
export { consumption as shiftingConsumption }
const completed = (run: ShiftingRunObservation) => run.phase1Correct === true && run.phase2Correct === true &&
  (run.conditions.topologyBinding !== true || positiveFactFlowGate(run))

export function summarizeShiftingRuns(observations: readonly ShiftingRunObservation[], probeRuns: readonly ShiftingRunObservation[] = []) {
  const collectedRuns = observations.filter(run => run.purpose !== 'adaptive-probe')
  const runs = collectedRuns
  const excludedFactFlowRuns = collectedRuns.filter(run => run.conditions?.topologyBinding === true && !positiveFactFlowGate(run))
  const validComparisonRuns = runs.length > 0 && runs.every(run => SHIFTING_ARMS.includes(run.mode as typeof SHIFTING_ARMS[number]) &&
    (run.purpose === undefined || run.purpose === 'comparison'))
  const homogeneousRuns = homogeneous(runs), uniqueRuns = unique(runs)
  const arms = SHIFTING_ARMS.map(mode => {
    const rows = runs.filter(run => run.mode === mode)
    const successes = rows.filter(completed), failed = rows.filter(run => !completed(run))
    const correct = successes.length
    const ratios = (field: 'modelCalls' | 'interactions' | 'transferBytes' | 'entrySteps') => meanInterval(successes.map(run => run.costRelativeToReference?.[field].multiple))
    const sum = (field: keyof ShiftingRewireCounts) => rows.reduce((total, run) => total + (run.protocol?.rewireTelemetry?.[field] ?? 0), 0)
    return { mode, repeats: rows.length, correct, successRate: rows.length ? correct / rows.length : null,
      completion: completionInterval(correct, rows.length),
      phase1Submission: completionInterval(rows.filter(run => run.phase1Submitted === true).length, rows.length),
      phase2Submission: completionInterval(rows.filter(run => run.phase2Submitted === true).length, rows.length),
      phase1Completion: completionInterval(rows.filter(run => run.phase1Correct === true).length, rows.length),
      phase2Completion: completionInterval(rows.filter(run => run.phase2Correct === true).length, rows.length),
      efficiency: consumption(successes), failedConsumption: { ...consumption(failed), runsDetail: failed.map(run => ({ runId: run.runId,
        seed: run.conditions.seed, stopReason: run.stopReason ?? 'unknown', issuedModelCalls: run.issuedModelCalls ?? null,
        interactions: run.atnTotalInteractions, transferBytes: run.atnTotalTransferBytes, entrySteps: run.entrySteps ?? null, failures: run.failures ?? [] })) },
      costMultiples: { modelCalls: { ...ratios('modelCalls'), status: 'undefined-zero-reference' },
        interactions: ratios('interactions'), transferBytes: ratios('transferBytes'), entrySteps: ratios('entrySteps'),
        baselineTopology: mode === 'fixed' || mode === 'fixed-wide' ? mode : 'adaptive',
        statement: 'Successes only, each compared with its same-seed, same-topology constructive reference. An incomplete reference is not an efficiency benchmark for a completed task.' },
      feedback: { accepted: rows.reduce((sum, run) => sum + (run.protocol?.requesterFeedback.accepted ?? 0), 0),
        rejected: rows.reduce((sum, run) => sum + (run.protocol?.requesterFeedback.rejected ?? 0), 0) },
      rewires: Object.fromEntries(rewireFields.map(field => [field, sum(field)])),
      maxNodeStepRatio: rows.length && rows.every(run => shiftingStepHeadroom(run).observed)
        ? Math.max(...rows.map(run => shiftingStepHeadroom(run).maxNodeStepRatio!)) : null,
      phase1SubmittedRate: rows.length ? rows.filter(run => run.phase1Submitted).length / rows.length : null,
      phase2SubmittedRate: rows.length ? rows.filter(run => run.phase2Submitted).length / rows.length : null,
      submissionDisciplineFailures: rows.filter(run => run.submissionDisciplineFailure).length,
      solvingFailures: rows.filter(run => run.solvingFailure).length }
  })
  const stepArms = SHIFTING_ARMS.map(mode => {
    const rows = runs.filter(run => run.mode === mode).map(run => ({ runId: run.runId, seed: run.conditions.seed, ...shiftingStepHeadroom(run) }))
    return { mode, runs: rows, withinLimit: rows.length > 0 && rows.every(row => row.withinLimit) }
  })
  const stepHeadroom = { limit: SHIFTING_STEP_RATIO_LIMIT, arms: stepArms,
    withinLimit: runs.length > 0 && runs.every(run => shiftingStepHeadroom(run).withinLimit) }
  const fixed = arms.find(arm => arm.mode === 'fixed')!, adaptive = arms.find(arm => arm.mode === 'adaptive')!
  const validOutcomes = runs.every(run => [run.phase1Correct, run.phase2Correct, run.phase1Submitted, run.phase2Submitted].every(value => typeof value === 'boolean'))
  // Legacy calibration field names now describe data coverage, never a success threshold.
  const fixedGatePassed = validComparisonRuns && homogeneousRuns && uniqueRuns && validOutcomes && fixed.repeats >= 5
  const calibrationGatePassed = fixedGatePassed && adaptive.repeats >= 5 && stepHeadroom.withinLimit
  const everyArmRepeated = arms.every(arm => arm.repeats >= 5)
  const pairedSeeds = SHIFTING_ARMS.map(mode => runs.filter(run => run.mode === mode).map(run => run.conditions.seed).sort((a, b) => a - b))
  const matchedSeeds = pairedSeeds.every(seeds => new Set(seeds).size === seeds.length && JSON.stringify(seeds) === JSON.stringify(pairedSeeds[0]))
  const liveProvider = runs.length > 0 && runs.every(run => run.execution === 'live-provider')
  const probe = summarizeAdaptiveProbe(probeRuns)
  const probeMatchesComparison = homogeneousRuns && probe.homogeneous && probeRuns.length > 0 && signature(runs[0]) === signature(probeRuns[0])
  const separateProbeRuns = probeRuns.length > 0 && probeRuns.every(probeRun => runs.every(run => run.runId !== probeRun.runId))
  const probePrecedesComparison = runs.length > 0 && probeRuns.length > 0 &&
    runs.every(run => Number.isSafeInteger(run.startedAt) && run.startedAt! > 0) &&
    probeRuns.every(run => Number.isSafeInteger(run.completedAt) && run.completedAt! > 0) &&
    Math.max(...probeRuns.map(run => run.completedAt!)) <= Math.min(...runs.map(run => run.startedAt!))
  const adaptiveProbeGatePassed = probe.probeGatePassed && probeMatchesComparison && separateProbeRuns && probePrecedesComparison
  const rejectedCount = (rows: readonly ShiftingRunObservation[]) => rows.filter(run => run.execution === 'live-provider')
    .reduce((sum, run) => {
      const rejected = run.protocol?.requesterFeedback?.rejected
      return sum + (Number.isSafeInteger(rejected) && rejected! >= 0 ? rejected! : 0)
    }, 0)
  const comparisonRejectedReviews = rejectedCount(runs), probeRejectedReviews = rejectedCount(probeRuns)
  const feedbackVarianceGatePassed = comparisonRejectedReviews > 0
  const structuralProofGatePassed = structuralBindingGate(runs)
  const bindingReferenceGatePassed = runs.length > 0 && runs.every(run => bindingReferenceGate(run.bindingReference, run))
  const factFlowAuditGatePassed = collectedRuns.length > 0 && excludedFactFlowRuns.length === 0 && runs.every(positiveFactFlowGate)
  const hasComparableSignal = adaptive.correct >= 1
  const telemetryComplete = runs.length > 0 && runs.every(run => shiftingStepHeadroom(run).observed &&
    ['accepted', 'rejected', 'needsMore'].every(field => {
      const value = run.protocol?.requesterFeedback[field as keyof ShiftingProtocolObservation['requesterFeedback']]
      return Number.isSafeInteger(value) && value! >= 0
    }) && rewireFields.every(field => {
      const value = run.protocol?.rewireTelemetry[field]
      return Number.isSafeInteger(value) && value! >= 0
    }))
  const eligibleModel = runs.length > 0 && runs.every(run => run.model !== 'longcat-2.5-preview-free')
  const mayInterpretTopology = validComparisonRuns && homogeneousRuns && uniqueRuns && structuralProofGatePassed &&
    bindingReferenceGatePassed && factFlowAuditGatePassed && everyArmRepeated && matchedSeeds && liveProvider && validOutcomes &&
    telemetryComplete && eligibleModel && hasComparableSignal
  const pairwise = SHIFTING_ARMS.flatMap((a, index) => SHIFTING_ARMS.slice(index + 1).map(b => {
    const left = runs.filter(run => run.mode === a), right = runs.filter(run => run.mode === b)
    const pairs = left.flatMap(run => { const other = right.find(row => row.conditions.seed === run.conditions.seed); return other ? [{ a: run, b: other }] : [] })
    const aOnly = pairs.filter(pair => completed(pair.a) && !completed(pair.b)).length
    const bOnly = pairs.filter(pair => !completed(pair.a) && completed(pair.b)).length
    const successfulPairs = pairs.filter(pair => completed(pair.a) && completed(pair.b))
    const modelCallDifference = meanInterval(successfulPairs.map(pair => typeof pair.a.issuedModelCalls === 'number' && typeof pair.b.issuedModelCalls === 'number'
      ? pair.a.issuedModelCalls - pair.b.issuedModelCalls : null))
    return { a, b, pairedSeeds: pairs.length, aOnly, bOnly, pValue: pairs.length ? exactMcNemar(aOnly, bOnly) : null,
      modelCallDifference, successfulPairs: successfulPairs.length,
      efficiencyStatement: 'Conditional paired mean A minus B on jointly completed seeds; absent or overlapping zero intervals are not distinguishable. This does not correct selection on success.' }
  }))
  const adjusted = holmAdjusted(pairwise.map(pair => pair.pValue ?? 1))
  const comparisons = pairwise.map((pair, index) => ({ ...pair, holmPValue: pair.pValue === null ? null : adjusted[index],
    distinguishableCompletion: mayInterpretTopology && pair.pValue !== null && adjusted[index] < 0.05,
    completionStatement: !pair.pairedSeeds ? 'not-measured' : adjusted[index] < 0.05 && mayInterpretTopology ? 'detectable-paired-difference' : 'not-distinguishable-at-this-sample-size' }))
  const nonFixedControls = arms.filter(arm => ['fixed-wide', 'no-feedback', 'no-board'].includes(arm.mode))
  const consistentNonFixedAdvantage = mayInterpretTopology && nonFixedControls.every(arm =>
    adaptive.completion.interval!.lower > arm.completion.interval!.upper && comparisons.some(pair =>
      pair.a === 'adaptive' && pair.b === arm.mode && pair.distinguishableCompletion))
  return { fixedGatePassed, calibrationGatePassed, everyArmRepeated, matchedSeeds, homogeneous: homogeneousRuns, uniqueRuns, liveProvider,
    validComparisonRuns, validOutcomes, telemetryComplete, eligibleModel, hasComparableSignal, adaptiveProbeGatePassed, probeMatchesComparison, separateProbeRuns, probePrecedesComparison,
    structuralProofGatePassed, bindingReferenceGatePassed, factFlowAuditGatePassed,
    feedbackVarianceGatePassed, rejectedReviews: comparisonRejectedReviews, comparisonRejectedReviews, probeRejectedReviews, stepHeadroom,
    mayInterpretTopology, interpretation: mayInterpretTopology ? 'descriptive-comparison-only' : !hasComparableSignal ? 'no-comparable-signal' : 'incomplete-or-invalid-comparison',
    consistentNonFixedAdvantage, benefitClaim: consistentNonFixedAdvantage ? 'descriptive-nonfixed-advantage-only' : 'not-supported',
    primaryMetric: 'model calls per two-phase completed run', arms, comparisons,
    indistinguishablePairs: comparisons.filter(pair => pair.completionStatement === 'not-distinguishable-at-this-sample-size').map(pair => `${pair.a} vs ${pair.b}`),
    runs: [...collectedRuns], excludedFactFlowRuns, probe, excludedProbeRuns: observations.length - collectedRuns.length, causalClaim: false }
}
