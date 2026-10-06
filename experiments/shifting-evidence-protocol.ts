/** No capability or topology interpretation without repeated, homogeneous evidence. */
import { createShiftingEvidenceTask } from './shifting-evidence-task.ts'
import { isComparisonSeed, proveTopologyBinding, type TopologyBindingProof } from './topology-binding-proof.ts'
import { bindingReferenceGate, type BindingReferencePair, type FactFlowAudit } from './topology-binding-audit.ts'
export const SHIFTING_ARMS = ['adaptive', 'fixed', 'no-feedback', 'no-board'] as const
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

/** Attempts, capability and headroom are separate gates; run frequency is descriptive only. */
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
  const capabilityGatePassed = validPurpose && liveProvider && homogeneousRuns && uniqueRuns && eligibleModel &&
    runs.length >= 5 && twoPhaseSuccessRate! >= 0.8
  const stepHeadroomPassed = runs.length > 0 && runs.every(run => shiftingStepHeadroom(run).withinLimit)
  const factFlowAuditGatePassed = runs.length > 0 && runs.every(run => run.conditions.topologyBinding !== true || positiveFactFlowGate(run))
  const bindingReferenceGatePassed = runs.length > 0 && runs.every(run => run.conditions.topologyBinding !== true || bindingReferenceGate(run.bindingReference, run))
  const probeGatePassed = validPurpose && liveProvider && completeTelemetry && homogeneousRuns && uniqueRuns &&
    discovery.passed && capabilityGatePassed && stepHeadroomPassed && factFlowAuditGatePassed && bindingReferenceGatePassed
  return { probeGatePassed, repeats: runs.length, runsWithSuccessfulRewire, successfulRewireRunRate,
    discovery, correct, twoPhaseSuccessRate, capabilityGatePassed, eligibleModel, stepHeadroomPassed,
    validPurpose, liveProvider, completeTelemetry, homogeneous: homogeneousRuns, uniqueRuns, rewireCounts,
    factFlowAuditGatePassed, bindingReferenceGatePassed,
    runs: [...runs], interpretation: 'mechanism-and-adaptive-capability-only', causalClaim: false }
}

/** Stop live comparison before provider calls when the earlier probe is absent or invalid. */
export function assertAdaptiveProbeAdmission(runs: readonly ShiftingRunObservation[],
  expected: Pick<ShiftingRunObservation, 'model' | 'conditions' | 'sourceHashes'>, comparisonStartedAt = Date.now()) {
  const summary = summarizeAdaptiveProbe(runs)
  if (!summary.probeGatePassed) throw new Error('Adaptive probe admission failed: require >=5 distinct same-source/config live adaptive probes, >=80% two-phase correctness, <=80% node steps and 100% successful rewire attempts (at least one)')
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

/** Only the pre-observation conditions can be checked before collecting comparison data. */
export function assertTopologyComparisonPreflight(probes: readonly ShiftingRunObservation[],
  expected: Pick<ShiftingRunObservation, 'model' | 'conditions' | 'sourceHashes'>, seeds: readonly number[], startedAt = Date.now()) {
  if (seeds.length < 5 || new Set(seeds).size !== seeds.length) throw new Error('Topology comparison admission failed: require at least five distinct seeds')
  if (!structuralBindingGate(probes)) throw new Error('Topology comparison admission failed: fixture-bound structural proof missing or invalid')
  if (!probes.every(run => bindingReferenceGate(run.bindingReference, run))) throw new Error('Topology comparison admission failed: constructive binding confirmation missing or invalid')
  if (!probes.every(positiveFactFlowGate)) throw new Error('Topology comparison admission failed: positive fact-flow audit missing or failed')
  const probe = assertAdaptiveProbeAdmission(probes, expected, startedAt)
  for (const seed of seeds) {
    if (!probes.some(run => run.conditions.seed === seed && bindingReferenceGate(run.bindingReference, run))) {
      throw new Error(`Topology comparison admission failed: no constructive reference for seed ${seed}`)
    }
    const task = createShiftingEvidenceTask(expected.conditions.agents as number, seed, expected.conditions.chainLength as number, true)
    if (expected.conditions.topologyBinding !== true || !isComparisonSeed(task, proveTopologyBinding(task))) {
      throw new Error(`Topology comparison admission failed: reachable or unbound seed ${seed}`)
    }
  }
  return probe
}

export function summarizeShiftingRuns(observations: readonly ShiftingRunObservation[], probeRuns: readonly ShiftingRunObservation[] = []) {
  const collectedRuns = observations.filter(run => run.purpose !== 'adaptive-probe')
  const runs = collectedRuns.filter(run => run.conditions?.topologyBinding !== true || positiveFactFlowGate(run))
  const excludedFactFlowRuns = collectedRuns.filter(run => !runs.includes(run))
  const validComparisonRuns = runs.length > 0 && runs.every(run => SHIFTING_ARMS.includes(run.mode as typeof SHIFTING_ARMS[number]) &&
    (run.purpose === undefined || run.purpose === 'comparison'))
  const homogeneousRuns = homogeneous(runs), uniqueRuns = unique(runs)
  const arms = SHIFTING_ARMS.map(mode => {
    const rows = runs.filter(run => run.mode === mode)
    const correct = rows.filter(run => run.phase1Correct === true && run.phase2Correct === true).length
    return { mode, repeats: rows.length, correct, successRate: rows.length ? correct / rows.length : null,
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
  const fixedGatePassed = validComparisonRuns && homogeneousRuns && uniqueRuns && fixed.repeats >= 5 && fixed.successRate! >= 0.8
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
  const structuralProofGatePassed = structuralBindingGate(runs) && structuralBindingGate(probeRuns)
  const bindingReferenceGatePassed = runs.length > 0 && [...runs, ...probeRuns].every(run => bindingReferenceGate(run.bindingReference, run))
  const factFlowAuditGatePassed = collectedRuns.length > 0 && excludedFactFlowRuns.length === 0 && [...runs, ...probeRuns].every(positiveFactFlowGate)
  const mayInterpretTopology = validComparisonRuns && homogeneousRuns && uniqueRuns && structuralProofGatePassed &&
    bindingReferenceGatePassed && factFlowAuditGatePassed && everyArmRepeated && matchedSeeds && liveProvider && adaptiveProbeGatePassed &&
    feedbackVarianceGatePassed && stepHeadroom.withinLimit
  const nonFixedControls = arms.filter(arm => ['no-feedback', 'no-board'].includes(arm.mode))
  const consistentNonFixedAdvantage = mayInterpretTopology && nonFixedControls.every(arm => adaptive.successRate! > arm.successRate!)
  return { fixedGatePassed, calibrationGatePassed, everyArmRepeated, matchedSeeds, homogeneous: homogeneousRuns, uniqueRuns, liveProvider,
    validComparisonRuns, adaptiveProbeGatePassed, probeMatchesComparison, separateProbeRuns, probePrecedesComparison,
    structuralProofGatePassed, bindingReferenceGatePassed, factFlowAuditGatePassed,
    feedbackVarianceGatePassed, rejectedReviews: comparisonRejectedReviews, comparisonRejectedReviews, probeRejectedReviews, stepHeadroom,
    mayInterpretTopology, interpretation: mayInterpretTopology ? 'descriptive-comparison-only' : 'feasibility-only',
    consistentNonFixedAdvantage, benefitClaim: consistentNonFixedAdvantage ? 'descriptive-nonfixed-advantage-only' : 'not-supported',
    arms, runs: [...collectedRuns], excludedFactFlowRuns, probe, excludedProbeRuns: observations.length - collectedRuns.length, causalClaim: false }
}
