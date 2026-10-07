/** Removal recommendations require the registered primary test AND the joint ablation. */
import { isDeepStrictEqual } from 'node:util'
import { SIMPLIFICATION_ARMS, shiftingMechanisms, type SimplificationArm } from './simplification-arms.ts'
import { completionInterval, meanInterval } from './comparison-statistics.ts'
import { pairedRiskDifference, minimumPairedSeeds, type simplificationPower } from './simplification-statistics.ts'
import { shiftingConsumption, positiveFactFlowGate, type ShiftingRunObservation } from './shifting-evidence-protocol.ts'

export interface SimplificationDesign {
  frozenAt: string
  seeds: number[]
  model: string
  sourceHashes: Record<string, string>
  conditions: Record<string, unknown>
  criterion: 'corrected'
  margin: number
  lowPowerAcknowledged: boolean
  power: ReturnType<typeof simplificationPower>
  modes?: SimplificationArm[]
  maintainerDecision: { selectedBy: 'maintainer'; rationale: string; evidence: string }
  costCriterion: typeof SIMPLIFICATION_COST_CRITERION
}

/** Operational meaning of substantive coordination savings, fixed before any outcomes. */
export const SIMPLIFICATION_COST_CRITERION = {
  primaryMetric: 'atnTotalInteractions', population: 'all registered runs including failures',
  minimumRelativeReduction: 0.10, confidenceLevel: 0.95,
  rule: 'Complete paired telemetry; adaptive-minus-ablation Student-t 95% lower bound > 0 and mean reduction >= 10% of paired adaptive mean.',
  rationale: 'A ten-percent reduction is a practical coordination reduction; all four cost quantities remain reported. Completion loss tolerance is evaluated separately.',
} as const

export function registeredSimplificationArms(design: Pick<SimplificationDesign, 'modes'>) {
  const modes = design.modes ?? [...SIMPLIFICATION_ARMS]
  if (modes.length < 2 || !modes.includes('adaptive') || !isDeepStrictEqual(modes, SIMPLIFICATION_ARMS.filter(mode => modes.includes(mode)))) {
    throw new Error('Register unique canonical arms including adaptive; reduce arms rather than seeds')
  }
  return modes
}
export type SimplificationObservation = ShiftingRunObservation & {
  rawAudit?: { passed: boolean }
  mechanisms?: ReturnType<typeof shiftingMechanisms>
  reference?: { topologyMode: string; passed: boolean; obtainedRequiredFactCount: number; requiredFactCount: number;
    issuedModelCalls: number; requesterRatings: number; board: { reads: number; writes: number }; factFlowAudit: { passed: boolean } | null }
}

export function assertSimplificationDesign(design: SimplificationDesign) {
  if (design.criterion !== 'corrected') throw new Error('Unregistered noninferiority criterion: only lower 95% bound > -delta is valid')
  const minimumSeeds = minimumPairedSeeds(design.margin)
  registeredSimplificationArms(design)
  if (design.seeds.length < minimumSeeds || new Set(design.seeds).size !== design.seeds.length ||
    design.seeds.some((seed, i) => seed !== 17 + i * 14)) throw new Error(`Seeds must follow the frozen 17 + 14*i rule, n >= ${minimumSeeds}`)
  if (design.power.pairedSeeds !== design.seeds.length || design.power.margin !== design.margin ||
    !design.power.readyToRun || design.power.issuedModelCalls !== 0 ||
    design.power.bestCaseSampleSize.minimumSeeds !== minimumSeeds ||
    !pairedRiskDifference(design.seeds.length, 0, 0, design.margin).nonInferiorityPassed) throw new Error('Power analysis does not permit this design')
  if (design.power.lowPowerAcknowledgementRequired && !design.lowPowerAcknowledged) throw new Error('Low power requires an explicit pre-run budget decision')
  if (design.maintainerDecision?.selectedBy !== 'maintainer' || !design.maintainerDecision.rationale.trim() || !design.maintainerDecision.evidence.trim()) {
    throw new Error('Maintainer delta and budget rationale must be registered before running')
  }
  if (!isDeepStrictEqual(design.costCriterion, SIMPLIFICATION_COST_CRITERION)) throw new Error('Substantive cost criterion must be frozen before running')
  if (design.model !== 'deepseek-v4.1-flash') throw new Error('The model is frozen')
  const expected = { agents: 8, chainLength: 2, topologyBinding: true, perNodeSteps: 48, maxCalls: 384,
    maxOutputTokens: 4096, timeoutMs: 600_000, observedTokenLimit: 8_000_000, autoAdvance: false }
  if (!isDeepStrictEqual(design.conditions, expected)) throw new Error('Task configuration and per-run budgets are frozen')
  const prepared = Date.parse(design.frozenAt), powerAt = Date.parse(design.power.generatedAt)
  if (!Number.isFinite(prepared) || !Number.isFinite(powerAt) || powerAt > prepared) throw new Error('Power analysis must precede registration and live runs')
  if (!Object.keys(design.sourceHashes).length) throw new Error('Source identity is required')
}

export function summarizeSimplificationRuns(rows: readonly SimplificationObservation[], design: SimplificationDesign) {
  assertSimplificationDesign(design)
  const modes = registeredSimplificationArms(design)
  const completed = (run: SimplificationObservation) => run.phase1Correct && run.phase2Correct && positiveFactFlowGate(run)
  const conditions = (run: SimplificationObservation) => Object.fromEntries(Object.entries(run.conditions).filter(([key]) => key !== 'seed'))
  const checks = {
    completeSample: rows.length === design.seeds.length * modes.length && modes.every(mode =>
      design.seeds.every(seed => rows.filter(run => run.mode === mode && run.conditions.seed === seed).length === 1)),
    registeredArms: rows.every(run => modes.includes(run.mode as SimplificationArm) && design.seeds.includes(run.conditions.seed)),
    uniqueRuns: new Set(rows.map(run => run.runId)).size === rows.length,
    liveProvider: rows.every(run => run.execution === 'live-provider' && run.purpose === 'comparison'),
    frozenConditions: rows.every(run => run.model === design.model && isDeepStrictEqual(conditions(run), design.conditions) &&
      isDeepStrictEqual(run.sourceHashes, design.sourceHashes)),
    preregistered: rows.every(run => typeof run.startedAt === 'number' && run.startedAt >= Date.parse(design.frozenAt)),
    outcomesConsistent: rows.every(run => [run.phase1Correct, run.phase2Correct, run.phase1Submitted, run.phase2Submitted, run.passed].every(value => typeof value === 'boolean') &&
      (!run.phase1Correct || run.phase1Submitted) && (!run.phase2Correct || run.phase2Submitted) && run.passed === (run.phase1Correct && run.phase2Correct)),
    positiveFactFlow: rows.every(positiveFactFlowGate), rawAudits: rows.every(run => run.rawAudit?.passed === true),
    mechanismConfigurations: rows.every(run => {
      const expected = shiftingMechanisms(run.mode), reference = run.reference
      return isDeepStrictEqual(run.mechanisms, expected) && reference?.topologyMode === run.mode && reference.passed &&
        reference.issuedModelCalls === 0 && reference.obtainedRequiredFactCount === reference.requiredFactCount && reference.requiredFactCount === 4 &&
        reference.factFlowAudit?.passed === true && (expected.requesterFeedback || reference.requesterRatings === 0) &&
        (expected.sharedBoard || reference.board.reads + reference.board.writes === 0)
    }),
    completedControlSignal: rows.some(run => run.mode === 'adaptive' && completed(run)),
  }
  const readyForDecision = rows.length > 0 && Object.values(checks).every(Boolean)
  const arms = SIMPLIFICATION_ARMS.map(mode => {
    const observations = rows.filter(run => run.mode === mode), successes = observations.filter(completed), failures = observations.filter(run => !completed(run))
    return { mode, runs: observations.length, completion: completionInterval(successes.length, observations.length),
      registered: modes.includes(mode), allConsumption: shiftingConsumption(observations),
      completedConsumption: shiftingConsumption(successes), failedConsumption: { ...shiftingConsumption(failures),
        runsDetail: failures.map(run => ({ runId: run.runId, seed: run.conditions.seed, stopReason: run.stopReason ?? 'unknown',
          calls: run.issuedModelCalls ?? null, interactions: run.atnTotalInteractions, transferBytes: run.atnTotalTransferBytes,
          entrySteps: run.entrySteps ?? null, failures: run.failures ?? [] })) } }
  })
  const adaptive = rows.filter(run => run.mode === 'adaptive')
  const comparisons = SIMPLIFICATION_ARMS.filter(mode => mode !== 'adaptive').map(mode => {
    const pairs = adaptive.flatMap(base => {
      const others = rows.filter(run => run.mode === mode && run.conditions.seed === base.conditions.seed)
      return others.length === 1 ? [{ base, ablation: others[0] }] : []
    })
    const gains = pairs.filter(pair => completed(pair.ablation) && !completed(pair.base)).length
    const losses = pairs.filter(pair => !completed(pair.ablation) && completed(pair.base)).length
    const riskDifference = pairedRiskDifference(pairs.length, gains, losses, design.margin)
    const successes = pairs.filter(pair => completed(pair.base) && completed(pair.ablation))
    const savings = (field: 'issuedModelCalls' | 'atnTotalInteractions' | 'atnTotalTransferBytes' | 'entrySteps') =>
      meanInterval(successes.map(pair => typeof pair.base[field] === 'number' && typeof pair.ablation[field] === 'number'
        ? pair.base[field]! - pair.ablation[field]! : null))
    return { mode, pairedSeeds: pairs.map(pair => pair.base.conditions.seed), riskDifference,
      observedDiscordantPairs: gains + losses,
      registered: modes.includes(mode), criterionSupported: readyForDecision && modes.includes(mode),
      nonInferiorityPassed: readyForDecision && modes.includes(mode) && riskDifference.nonInferiorityPassed,
      costSavings: (() => {
        const allSavings = (field: 'issuedModelCalls' | 'atnTotalInteractions' | 'atnTotalTransferBytes' | 'entrySteps') => {
          const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
          const known = pairs.filter(pair => valid(pair.base[field]) && valid(pair.ablation[field]))
          const result = meanInterval(pairs.map(pair => valid(pair.base[field]) && valid(pair.ablation[field]) ? pair.base[field]! - pair.ablation[field]! : null))
          const baseMean = known.length ? known.reduce((sum, pair) => sum + pair.base[field]!, 0) / known.length : null
          return { ...result, pairedAdaptiveMean: baseMean,
            relativeReduction: baseMean !== null && baseMean > 0 && result.mean !== null ? result.mean / baseMean : null,
            population: 'All paired seeds, including failed runs; positive means adaptive consumes more.' }
        }
        return { pairedRuns: pairs.length, jointlyCompletedPairs: successes.length,
          modelCalls: allSavings('issuedModelCalls'), interactions: allSavings('atnTotalInteractions'),
          transferBytes: allSavings('atnTotalTransferBytes'), entrySteps: allSavings('entrySteps') }
      })(),
      jointlyCompletedCostSavings: { pairs: successes.length, modelCalls: savings('issuedModelCalls'), interactions: savings('atnTotalInteractions'),
        transferBytes: savings('atnTotalTransferBytes'), entrySteps: savings('entrySteps'), meaning: 'Conditional descriptive subgroup only; not the primary cost axis.' },
      discordanceInterpretation: riskDifference.nonInferiorityPassed ? `The registered paired interval excludes a loss of ${100 * design.margin}pp despite the observed discordance.`
        : `The observed pairs do not exclude a loss of ${100 * design.margin}pp; default retain. McNemar superiority never supports removal.` }
  })
  const joint = comparisons.find(row => row.mode === 'minimal')!
  const costPassed = (comparison: typeof comparisons[number]) => {
    const primary = comparison.costSavings.interactions
    return readyForDecision && comparison.registered && primary.knownRuns === design.seeds.length && primary.unknownRuns === 0 &&
      primary.interval !== null && primary.interval.lower > 0 && primary.relativeReduction !== null &&
      primary.relativeReduction >= design.costCriterion.minimumRelativeReduction
  }
  const recommendations = comparisons.map(comparison => {
    const jointPassed = joint.nonInferiorityPassed
    const substantiveCostReduction = costPassed(comparison), jointCostReduction = costPassed(joint)
    const removalSupported = substantiveCostReduction && jointCostReduction && comparison.nonInferiorityPassed && jointPassed
    return { mode: comparison.mode, mechanism: comparison.mode === 'no-feedback' ? '请求者评价' : comparison.mode === 'no-board' ? '共享白板' : '两者同时移除',
      conclusion: removalSupported ? '移除' : '不确定', defaultAction: removalSupported ? '交维护者决定是否在后续版本移除' : '保留',
      nonInferiorityPassed: comparison.nonInferiorityPassed, jointNonInferiorityPassed: jointPassed,
      substantiveCostReduction, jointSubstantiveCostReduction: jointCostReduction,
      reason: removalSupported ? '单项及同时移除的全样本成本判据与预登记非劣性判据均通过。'
        : !comparison.registered ? '本臂未登记／未检验，默认保留。' : !readyForDecision ? '真实样本、冻结条件或审计未完成／未通过。'
        : !comparison.nonInferiorityPassed ? `配对风险差区间未排除 ${100 * design.margin}pp 完成率损失。`
        : !joint.registered ? 'minimal 未检验，补偿性交互不确定。' : !jointPassed ? 'minimal 未通过，补偿性交互仍未排除。'
        : !substantiveCostReduction ? '全样本成本轴未显示预登记的实质性下降，或成本遥测不完整。' : 'minimal 的全样本成本轴未通过。',
      riskDifference: comparison.riskDifference, costSavings: comparison.costSavings,
      scope: '只适用于当前拓扑绑定、事实少、两阶段依赖链任务族；不自动删除机制。',
      untestedRationale: comparison.mode === 'no-feedback' ? '跨任务、长期质量学习及复杂／模糊结果上的请求者评价价值未检验。'
        : comparison.mode === 'no-board' ? '事实多、广播频繁时共享白板避免重复唤醒和重复传输的价值未检验。'
          : '在更多事实、广播及跨任务学习场景中两机制的交互价值未检验。',
      benefitClaim: 'not-claimed', causalClaim: false }
  })
  return { version: 2, reconciledAt: new Date().toISOString(), primaryMetric: 'cost axis: model calls, ATN interactions, transfer bytes and entry steps on all runs',
    completionMetric: 'report-only audited two-phase completion; noninferiority claimed only when lower 95% bound > -delta',
    plannedRuns: design.seeds.length * modes.length, observedRuns: rows.length, design, checks, readyForDecision, arms, comparisons, recommendations,
    untestedArms: SIMPLIFICATION_ARMS.filter(mode => !modes.includes(mode)),
    failedRunsRetained: rows.filter(run => !completed(run)).length, unknownUsagePolicy: 'Unknown usage and cost are null with coverage; never zero. Failures are included in the primary cost axis and also reported separately.',
    costMeaning: 'Model cost is a catalog reference-price estimate, never a subscription bill. stepBudget counts agent steps, not tokens, HTTP requests or spending.',
    interactionInterpretation: 'minimal tests simultaneous removal. It is not a separately powered formal factorial interaction test.',
    multiplicity: 'Three nominal paired 95% intervals are reported. Removal requires each relevant single ablation AND minimal to pass; no family-wide 95% claim is made.',
    causalClaim: false, benefitClaim: 'not-claimed' }
}
