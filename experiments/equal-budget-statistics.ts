/** Equal-budget descriptive evidence. Missing telemetry is never a zero observation. */
import { completionInterval, exactMcNemar, holmAdjusted } from './comparison-statistics.ts'
import { pairedRiskDifference } from './simplification-statistics.ts'
import type { TelemetrySnapshot } from './telemetry.ts'

export const EQUAL_BUDGET_REPORT_MODES = ['single', 'independent-pool', 'native-team', 'atn-adaptive'] as const
export const EQUAL_BUDGET_V3_REPORT_MODES = ['single', 'single-scaffolded', 'independent-pool', 'native-team', 'atn-adaptive'] as const
export type EqualBudgetReportMode = typeof EQUAL_BUDGET_V3_REPORT_MODES[number]
export interface EqualBudgetAllocation {
  mode?: string
  agents: number
  perAgentSteps: readonly number[]
  totalSteps: number
}
export interface EqualBudgetReportDesign {
  version?: number
  round?: number
  modes: readonly string[]
  seeds: readonly number[]
  allocations: readonly EqualBudgetAllocation[]
  modelContextLimit: number | null
  model?: string
  frozenAt?: string
  conditions?: { maxOutputTokens: number }
  preflight?: { seeds: readonly number[]; seedsRequired: number; minOutputHeadroom?: number; widespreadTruncationRunFraction?: number }
  scaffoldPrompt?: { instruction: string; prompts: readonly { seed: number; path: string; text: string; sha256: string }[] }
}
export interface EqualBudgetPreflightReport {
  status: string
  observedRuns: number
  requiredRuns: number
  passedRuns: number
  researchLineTerminated: boolean
  mainBatchAllowed: boolean
  diagnosis: { category: string; reason: string }
}
export interface EqualBudgetRunObservation {
  runId: string
  mode: string
  seed: number
  execution?: string
  model: string
  startedAt: number | null
  completedAt: number | null
  evaluation: { passed: boolean }
  stopReason: string
  issuedModelCalls: number | null
  totalAgents: number | null
  entrySteps: number | null
  agentSteps?: Record<string, number>
  agentSessions?: Record<string, string[]>
  allocation: EqualBudgetAllocation
  metrics: TelemetrySnapshot | null
  protocolInteractions: number | null
  protocolTransferBytes: number | null
  factFlowAudit?: { passed: boolean; unknown?: boolean; noSubmission?: boolean; positiveCompletionEvidence?: boolean;
    submittedFacts?: number; auditedFacts?: number; transportSendBoundaryUnknown?: number; violations?: readonly string[] }
  causalClaim?: false
}
type Interval = { lower: number; upper: number }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0

/** A live-provider configuration does not establish that the invocation reached model dispatch. */
export function equalBudgetLiveCoverage(runs: readonly EqualBudgetRunObservation[]) {
  let configuredRuns = 0, dispatchedRuns = 0, zeroCallRuns = 0, unknownDispatchRuns = 0
  const count = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value)
  for (const run of runs) {
    const configured = run.execution === 'live-provider'
    if (configured) configuredRuns++
    const issued = run.issuedModelCalls, attempts = run.metrics?.totals.attempts
    if (!configured || !count(issued) || !count(attempts) || issued !== attempts) unknownDispatchRuns++
    else if (issued === 0) zeroCallRuns++
    else dispatchedRuns++
  }
  return { configuredRuns, dispatchedRuns, zeroCallRuns, unknownDispatchRuns,
    complete: runs.length > 0 && dispatchedRuns === runs.length }
}

/** R type 7 quantiles; the CI below uses order statistics, not interpolated tails. */
export function equalBudgetQuantile(sorted: readonly number[], probability: number): number | null {
  if (!(probability >= 0 && probability <= 1)) throw new Error('Invalid quantile probability')
  if (!sorted.length) return null
  const position = (sorted.length - 1) * probability, lower = Math.floor(position)
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
}

/** Distribution-free conservative median CI via the binomial sign/order-statistic interval.
 * n < 6 admits no finite two-sided 95% interval; ties make coverage conservative. */
export function medianInterval(values: readonly (number | null | undefined)[]) {
  const sorted = values.filter(finite).sort((a, b) => a - b), n = sorted.length
  let k = 0, cumulative = 0, probability = 2 ** -n
  for (let i = 0; i < n / 2; i++) {
    cumulative += probability
    if (cumulative <= 0.025 + Number.EPSILON) k = i + 1
    else break
    probability *= (n - i) / (i + 1)
  }
  const interval: Interval | null = k ? { lower: sorted[k - 1], upper: sorted[n - k] } : null
  return { observedRuns: values.length, knownRuns: n, unknownRuns: values.length - n,
    median: equalBudgetQuantile(sorted, 0.5), q1: equalBudgetQuantile(sorted, 0.25), q3: equalBudgetQuantile(sorted, 0.75),
    interval, method: 'binomial-order-statistic-median-95%', quantileMethod: 'linear-interpolation-R-type-7',
    status: !n ? 'no-known-observations' : !interval ? 'insufficient-n-for-finite-95%-median-interval' : 'estimated',
    assumptions: 'Independent seeds; conservative distribution-free median coverage. Unknown observations excluded with coverage. Completion-conditioned costs do not establish unconditional efficiency.' }
}

function peak(calls: ReadonlyArray<{ inputTokens: number | null }>, attempts: number | null) {
  const known = calls.map(call => call.inputTokens).filter(nonnegative)
  const lowerBound = known.length ? Math.max(...known) : null
  const missingCalls = attempts === null ? null : Math.max(0, attempts - calls.length)
  const unknownCalls = calls.length - known.length + (missingCalls ?? 0)
  return { peakInputTokens: attempts !== null && attempts > 0 && unknownCalls === 0 && attempts === calls.length ? lowerBound : null,
    knownPeakLowerBound: lowerBound, observedCalls: calls.length, knownCalls: known.length, unknownCalls, missingCalls,
    status: attempts === null ? 'unknown-call-coverage' : !attempts ? 'no-calls' : unknownCalls ? 'incomplete-usage' : 'complete' }
}

export function equalBudgetPeakContext(run: EqualBudgetRunObservation) {
  const metrics = run.metrics
  const overall = peak(metrics?.callCosts ?? [], metrics?.totals.attempts ?? null)
  const sessions = Object.entries(metrics?.sessions ?? {}).map(([session, total]) => ({ session,
    ...peak(metrics!.callCosts.filter(call => call.session === session), total.attempts) }))
  const perAgent = Object.entries(run.agentSessions ?? {}).map(([agent, aliases]) => {
    const attempts = metrics && aliases.every(alias => metrics.sessions[alias])
      ? aliases.reduce((sum, alias) => sum + metrics.sessions[alias].attempts, 0) : aliases.length ? null : 0
    return { agent, sessions: aliases, ...peak(metrics?.callCosts.filter(call => aliases.includes(call.session)) ?? [], attempts) }
  })
  const mappedSessions = Object.values(run.agentSessions ?? {}).flat()
  const uniqueMapping = new Set(mappedSessions).size === mappedSessions.length
  return { ...overall, perAgent, perSession: sessions,
    agentMappingComplete: !!run.agentSessions && uniqueMapping && sessions.every(row => mappedSessions.includes(row.session)),
    interpretation: 'Largest single-call input token count, not cumulative transcript size or quality. Input excludes cache; comparison with the full catalog context limit can understate actual context load. Known lower bounds are not complete peaks.' }
}

/** A hit is observed finish truncation OR an output count at the shared cap; unknowns never become non-hits. */
export function equalBudgetOutputDiagnostics(run: EqualBudgetRunObservation, maxOutputTokens: number | null) {
  const limit = nonnegative(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : null
  const totals = run.metrics?.totals, calls = run.metrics?.callCosts ?? []
  const expectedCalls = nonnegative(totals?.attempts) ? totals!.attempts
    : nonnegative(run.issuedModelCalls) ? run.issuedModelCalls : null
  const missingCalls = expectedCalls === null ? null : Math.max(0, expectedCalls - calls.length)
  const measured = calls.map(call => {
    // Optional extension fields preserve reports written before round 10.
    const row: { outputTokens?: number | null; finishReason?: string | null } = call
    const output = nonnegative(row.outputTokens) ? row.outputTokens : null
    const finish = typeof row.finishReason === 'string' && row.finishReason.length ? row.finishReason : null
    const truncated = finish === 'max-tokens' || finish === 'length' || (limit !== null && output !== null && output >= limit)
    return { output, finish, truncated, truncationKnown: truncated || (output !== null && finish !== null && limit !== null) }
  })
  const outputs = measured.flatMap(row => row.output === null ? [] : [row.output])
  const outputUnknownCalls = missingCalls === null ? null : measured.length - outputs.length + missingCalls
  const finishReasonKnownCalls = measured.filter(row => row.finish !== null).length
  const finishReasonUnknownCalls = missingCalls === null ? null : measured.length - finishReasonKnownCalls + missingCalls
  const truncationUnknownCalls = missingCalls === null ? null : measured.filter(row => !row.truncationKnown).length + missingCalls
  const settledCoverage = !!totals && totals.inFlight === 0 && totals.settledAttempts === totals.attempts && expectedCalls === calls.length
  const outputCoverageComplete = settledCoverage && outputUnknownCalls === 0
  const truncationCoverageComplete = settledCoverage && truncationUnknownCalls === 0
  const knownMaximumOutput = outputs.length ? Math.max(...outputs) : null
  const maximumOutputTokens = outputCoverageComplete ? knownMaximumOutput : null
  return { limit, expectedCalls, observedCalls: calls.length, missingCalls, outputKnownCalls: outputs.length, outputUnknownCalls,
    finishReasonKnownCalls, finishReasonUnknownCalls, truncatedCalls: measured.filter(row => row.truncated).length,
    truncationUnknownCalls, outputCoverageComplete, truncationCoverageComplete, maximumOutputTokens, knownMaximumOutput,
    headroomFraction: maximumOutputTokens !== null && limit !== null ? 1 - maximumOutputTokens / limit : null,
    knownHeadroomUpperBound: knownMaximumOutput !== null && limit !== null ? 1 - knownMaximumOutput / limit : null }
}

function outputConsumption(runs: readonly EqualBudgetRunObservation[], limit: number | null) {
  const rows = runs.map(run => equalBudgetOutputDiagnostics(run, limit))
  const known = rows.flatMap(row => row.knownMaximumOutput === null ? [] : [row.knownMaximumOutput])
  const knownMaximumOutput = known.length ? Math.max(...known) : null
  const outputCoverageComplete = rows.length > 0 && rows.every(row => row.outputCoverageComplete)
  const truncationCoverageComplete = rows.length > 0 && rows.every(row => row.truncationCoverageComplete)
  const maximumOutputTokens = outputCoverageComplete ? knownMaximumOutput : null
  return { runs: runs.length, limit, truncatedCalls: rows.reduce((sum, row) => sum + row.truncatedCalls, 0),
    truncatedRuns: rows.filter(row => row.truncatedCalls > 0).length,
    outputKnownCalls: rows.reduce((sum, row) => sum + row.outputKnownCalls, 0),
    outputUnknownCalls: rows.reduce((sum, row) => sum + (row.outputUnknownCalls ?? 0), 0),
    finishReasonUnknownCalls: rows.reduce((sum, row) => sum + (row.finishReasonUnknownCalls ?? 0), 0),
    truncationUnknownCalls: rows.reduce((sum, row) => sum + (row.truncationUnknownCalls ?? 0), 0),
    unknownCallCoverageRuns: rows.filter(row => row.expectedCalls === null).length,
    incompleteOutputRuns: rows.filter(row => !row.outputCoverageComplete).length,
    incompleteTruncationRuns: rows.filter(row => !row.truncationCoverageComplete).length,
    maximumOutputTokens, knownMaximumOutput, outputCoverageComplete, truncationCoverageComplete,
    headroomFraction: maximumOutputTokens !== null && limit !== null ? 1 - maximumOutputTokens / limit : null }
}

export function equalBudgetUsage(run: EqualBudgetRunObservation) {
  const totals = run.metrics?.totals
  const bucket = (field: 'inputTokens' | 'outputTokens') => {
    const token = totals?.tokens[field]
    const knownCalls = totals && token ? totals.settledAttempts - token.unknownCalls : 0
    return { knownTotal: totals && token && (knownCalls > 0 || totals.attempts === 0) ? token.known : null,
      knownCalls, unknownCalls: token?.unknownCalls ?? null }
  }
  const input = bucket('inputTokens'), output = bucket('outputTokens')
  const complete = !!totals && input.unknownCalls === 0 && output.unknownCalls === 0 && totals.inFlight === 0 &&
    totals.settledAttempts === totals.attempts && input.knownTotal !== null && output.knownTotal !== null
  const knownTotal = input.knownTotal === null && output.knownTotal === null ? null : (input.knownTotal ?? 0) + (output.knownTotal ?? 0)
  return { input, output, knownInputPlusOutput: knownTotal, totalTokens: complete ? knownTotal : null, complete,
    unknownTokenFields: totals ? (input.unknownCalls ?? 0) + (output.unknownCalls ?? 0) : null,
    inFlightCalls: totals?.inFlight ?? null, missingTelemetry: !totals,
    definition: 'inputTokens + outputTokens; telemetry input excludes cache buckets, reasoning is already in output. Provider totalTokens is not substituted or added; known partial sums are not complete usage.' }
}

const metricNames = ['wallClockMs', 'peakInputTokens', 'totalTokens', 'modelCalls', 'protocolInteractions', 'protocolTransferBytes', 'entrySteps', 'toolCalls'] as const
type MetricName = typeof metricNames[number]
export function equalBudgetRunMetrics(run: EqualBudgetRunObservation) {
  const context = equalBudgetPeakContext(run), usage = equalBudgetUsage(run)
  return { wallClockMs: nonnegative(run.startedAt) && nonnegative(run.completedAt) && run.completedAt >= run.startedAt
    ? run.completedAt - run.startedAt : null,
    peakInputTokens: context.peakInputTokens, totalTokens: usage.totalTokens,
    modelCalls: nonnegative(run.issuedModelCalls) ? run.issuedModelCalls : null,
    protocolInteractions: nonnegative(run.protocolInteractions) ? run.protocolInteractions : null,
    protocolTransferBytes: nonnegative(run.protocolTransferBytes) ? run.protocolTransferBytes : null,
    entrySteps: nonnegative(run.entrySteps) ? run.entrySteps : null,
    toolCalls: nonnegative(run.metrics?.totals.toolsStarted) ? run.metrics!.totals.toolsStarted : null, context, usage }
}

function consumption(runs: readonly EqualBudgetRunObservation[]) {
  const observations = runs.map(equalBudgetRunMetrics)
  const metrics = Object.fromEntries(metricNames.map(name => [name, medianInterval(observations.map(row => row[name]))])) as Record<MetricName, ReturnType<typeof medianInterval>>
  const usage = observations.map(row => row.usage)
  const known = usage.map(row => row.knownInputPlusOutput).filter(finite)
  return { runs: runs.length, ...metrics, usage: {
    knownInputPlusOutput: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
    completeRuns: usage.filter(row => row.complete).length, incompleteRuns: usage.filter(row => !row.complete).length,
    missingTelemetryRuns: usage.filter(row => row.missingTelemetry).length,
    inputKnownCalls: usage.reduce((sum, row) => sum + row.input.knownCalls, 0),
    outputKnownCalls: usage.reduce((sum, row) => sum + row.output.knownCalls, 0),
    inputUnknownCalls: usage.reduce((sum, row) => sum + (row.input.unknownCalls ?? 0), 0),
    outputUnknownCalls: usage.reduce((sum, row) => sum + (row.output.unknownCalls ?? 0), 0),
    inFlightCalls: usage.reduce((sum, row) => sum + (row.inFlightCalls ?? 0), 0) } }
}

/** Round 11 reports provenance gaps without turning them into feasibility gates. */
export function equalBudgetAuditCoverage(runs: readonly EqualBudgetRunObservation[]) {
  const knownAudit = (run: EqualBudgetRunObservation) => run.factFlowAudit?.unknown !== true && typeof run.factFlowAudit?.passed === 'boolean'
  const field = (name: 'submittedFacts' | 'auditedFacts' | 'transportSendBoundaryUnknown') => {
    const values = runs.map(run => knownAudit(run) ? run.factFlowAudit?.[name] : undefined)
    const known = values.filter(nonnegative)
    return { knownTotal: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
      knownRuns: known.length, unknownRuns: runs.length - known.length }
  }
  return { observedRuns: runs.length, passedRuns: runs.filter(run => knownAudit(run) && run.factFlowAudit?.passed === true).length,
    gapRuns: runs.filter(run => knownAudit(run) && run.factFlowAudit?.passed === false).length,
    unknownRuns: runs.filter(run => !knownAudit(run)).length,
    noSubmissionRuns: runs.filter(run => knownAudit(run) && run.factFlowAudit?.noSubmission === true).length,
    positiveCompletionEvidenceRuns: runs.filter(run => knownAudit(run) && run.factFlowAudit?.positiveCompletionEvidence === true).length,
    positiveCompletionEvidenceUnknownRuns: runs.filter(run => !knownAudit(run) || typeof run.factFlowAudit?.positiveCompletionEvidence !== 'boolean').length,
    submittedFacts: field('submittedFacts'), auditedFacts: field('auditedFacts'),
    transportSendBoundaryUnknown: field('transportSendBoundaryUnknown'),
    reportOnly: true, interpretation: 'Missing witnesses are unknown provenance, not zero facts or evidence of cheating; audit coverage does not gate round 11 feasibility.' }
}

function v3OutputIntervals(runs: readonly EqualBudgetRunObservation[], limit: number | null) {
  const rows = runs.map(run => equalBudgetOutputDiagnostics(run, limit))
  const knownTruncationRuns = rows.filter(row => row.truncatedCalls > 0 || row.truncationCoverageComplete)
  const hits = knownTruncationRuns.filter(row => row.truncatedCalls > 0).length
  const { successes, n, estimate, interval, method } = completionInterval(hits, knownTruncationRuns.length)
  return { headroomFraction: medianInterval(rows.map(row => row.headroomFraction)),
    maximumOutputTokens: medianInterval(rows.map(row => row.maximumOutputTokens)),
    truncatedCalls: medianInterval(rows.map(row => row.truncationCoverageComplete ? row.truncatedCalls : null)),
    truncatedRunFraction: { successes, n, estimate, interval, method, unknownRuns: rows.length - n },
    reportOnly: true }
}

interface InterpretationPair {
  a: string; b: string; pairedSeeds: number; missingPairs: number
  correctness: { estimate: number | null; interval: Interval | null; adjustedPValue: number; distinguishable: boolean }
}
/** Each preregistered rule carries its own oriented, actually observed contrasts. */
function round11Interpretations(pairs: readonly InterpretationPair[], evidenceReady: boolean) {
  const contrast = (a: string, b: string) => {
    const pair = pairs.find(pair => pair.a === a && pair.b === b || pair.a === b && pair.b === a)
    if (!pair) return { a, b, pairedSeeds: 0, missingPairs: null, estimate: null, interval: null,
      adjustedPValue: null, status: 'arm-not-registered' }
    const sign = pair.a === a ? 1 : -1
    const interval = pair.correctness.interval === null ? null : sign === 1 ? pair.correctness.interval
      : { lower: -pair.correctness.interval.upper, upper: -pair.correctness.interval.lower }
    const estimate = pair.correctness.estimate === null ? null : sign * pair.correctness.estimate
    return { a, b, pairedSeeds: pair.pairedSeeds, missingPairs: pair.missingPairs, estimate, interval,
      adjustedPValue: pair.correctness.adjustedPValue,
      status: pair.missingPairs || !pair.pairedSeeds ? 'incomplete-pairs' : !pair.correctness.distinguishable ? 'difference-not-established'
        : interval!.lower > 0 ? 'higher' : 'lower' }
  }
  const scaffoldSingle = contrast('single-scaffolded', 'single')
  const distributed = ['independent-pool', 'native-team', 'atn-adaptive']
  const scaffoldDistributed = distributed.map(mode => contrast('single-scaffolded', mode))
  const singleDistributed = distributed.map(mode => contrast('single', mode))
  const rule = (id: string, observation: string, interpretation: string, contrasts: ReturnType<typeof contrast>[], matches: boolean) => {
    const unavailable = contrasts.some(row => row.status === 'arm-not-registered' || row.status === 'incomplete-pairs')
    return { id, observation, interpretation, contrasts,
      status: !evidenceReady || unavailable ? 'not-assessable' : matches ? 'observed-pattern-compatible' : 'pattern-not-observed',
      actual: !evidenceReady || unavailable ? '登记比较或所需臂对尚不完整，不能判定此观察；实际区间与未知项仍全部列出。'
        : matches ? '本轮观察与该模式相容；≈仅为未建立差异，未做等效检验，不能据此证明零效应或因果归因。'
          : '本轮未观察到该规则要求的完整差异模式；下列方向与区间明确显示哪些差异未建立。', causalClaim: false }
  }
  return [
    rule('prompt-structure', 'single-scaffolded ≈ 三个分布式臂', '第 10 轮信号是提示结构，不是架构效应；ATN 无独立贡献。', scaffoldDistributed,
      scaffoldDistributed.every(row => row.status === 'difference-not-established')),
    rule('distributed-structure', 'single-scaffolded ≈ single，且两者明显低于三个分布式臂', '分解指令不足以救单智能体，分布式结构有独立贡献。', [scaffoldSingle, ...scaffoldDistributed, ...singleDistributed],
      scaffoldSingle.status === 'difference-not-established' && [...scaffoldDistributed, ...singleDistributed].every(row => row.status === 'lower')),
    rule('instructions-and-structure', 'single-scaffolded 明显优于 single，但仍低于三个分布式臂', '部分来自指令、部分来自结构。', [scaffoldSingle, ...scaffoldDistributed],
      scaffoldSingle.status === 'higher' && scaffoldDistributed.every(row => row.status === 'lower')),
  ]
}

export function summarizeEqualBudgetRuns(runs: readonly EqualBudgetRunObservation[], design: EqualBudgetReportDesign, preflight?: EqualBudgetPreflightReport | null) {
  const isV3 = design.version === 3 || design.round === 11
  if (isV3) {
    if (new Set(design.modes).size !== design.modes.length || design.modes.length < 3 ||
      design.modes.some(mode => !(EQUAL_BUDGET_V3_REPORT_MODES as readonly string[]).includes(mode)) ||
      ['single', 'single-scaffolded', 'atn-adaptive'].some(mode => !design.modes.includes(mode))) {
      throw new Error('Round 11 requires registered arms including single, single-scaffolded and atn-adaptive')
    }
  } else if (design.modes.length !== 4 || EQUAL_BUDGET_REPORT_MODES.some(mode => !design.modes.includes(mode)) || new Set(design.modes).size !== 4) throw new Error('Equal-budget report requires exactly the four registered arms')
  if (new Set(design.seeds).size !== design.seeds.length) throw new Error('Duplicate registered seed')
  const keys = new Set<string>(), ids = new Set<string>()
  for (const run of runs) {
    const key = `${run.mode}:${run.seed}`
    if (!design.modes.includes(run.mode) || !design.seeds.includes(run.seed)) throw new Error('Run outside registered arm/seed matrix')
    if (keys.has(key) || ids.has(run.runId)) throw new Error('Duplicate arm/seed or run identity; no replacement sampling')
    keys.add(key); ids.add(run.runId)
  }
  const validAllocation = (allocation: EqualBudgetAllocation | undefined) => !!allocation && Number.isSafeInteger(allocation.agents) &&
    allocation.agents > 0 && allocation.perAgentSteps.length === allocation.agents &&
    allocation.perAgentSteps.every(step => Number.isSafeInteger(step) && step > 0) &&
    allocation.totalSteps === allocation.perAgentSteps.reduce((sum, value) => sum + value, 0)
  const allocations = design.modes.map((mode, index) => design.allocations.find(row => row.mode === mode) ?? design.allocations[index])
  const budgetEqual = allocations.every(validAllocation) && new Set(allocations.map(row => row?.totalSteps)).size === 1
  const allocationMatched = runs.every(run => {
    const allocation = allocations[design.modes.indexOf(run.mode)]
    return validAllocation(run.allocation) && allocation?.agents === run.allocation.agents &&
      JSON.stringify(allocation.perAgentSteps) === JSON.stringify(run.allocation.perAgentSteps) &&
      allocation.totalSteps === run.allocation.totalSteps
  })
  const isV2 = design.version === 2 || design.round === 10
  const outputLimit = nonnegative(design.conditions?.maxOutputTokens) && design.conditions!.maxOutputTokens > 0 ? design.conditions!.maxOutputTokens : null
  const arms = design.modes.map((mode, index) => {
    const rows = runs.filter(run => run.mode === mode), successful = rows.filter(run => run.evaluation.passed)
    const { successes, n, estimate, interval, method } = completionInterval(successful.length, rows.length)
    return { mode, allocation: allocations[index], observedRuns: rows.length, missingSeeds: design.seeds.filter(seed => !rows.some(run => run.seed === seed)),
      correctness: { successes, n, estimate, interval, method }, allConsumption: consumption(rows), liveCoverage: equalBudgetLiveCoverage(rows),
      output: outputConsumption(rows, outputLimit), completedOutput: outputConsumption(successful, outputLimit),
      ...(isV3 ? { outputIntervals: v3OutputIntervals(rows, outputLimit), auditCoverage: equalBudgetAuditCoverage(rows) } : {}),
      completedConsumption: consumption(successful), failedConsumption: consumption(rows.filter(run => !run.evaluation.passed)),
      failures: rows.filter(run => !run.evaluation.passed).map(run => ({ seed: run.seed, runId: run.runId, stopReason: run.stopReason })),
      runs: rows.map(run => ({ runId: run.runId, seed: run.seed, passed: run.evaluation.passed, stopReason: run.stopReason,
        allocation: run.allocation, totalAgents: run.totalAgents, uncreatedAgentSlots: run.totalAgents === null ? null : Math.max(0, run.allocation.agents - run.totalAgents),
        agentSteps: run.agentSteps ?? null, output: equalBudgetOutputDiagnostics(run, outputLimit),
        ...(isV3 ? { factFlowAudit: run.factFlowAudit ?? null } : {}), ...equalBudgetRunMetrics(run) })) }
  })
  const pairs = design.modes.flatMap((a, i) => design.modes.slice(i + 1).map(b => {
    const paired = design.seeds.flatMap(seed => {
      const left = runs.find(run => run.mode === a && run.seed === seed), right = runs.find(run => run.mode === b && run.seed === seed)
      return left && right ? [{ left, right, lm: equalBudgetRunMetrics(left), rm: equalBudgetRunMetrics(right) }] : []
    })
    const gains = paired.filter(row => row.left.evaluation.passed && !row.right.evaluation.passed).length
    const losses = paired.filter(row => !row.left.evaluation.passed && row.right.evaluation.passed).length
    const risk = pairedRiskDifference(paired.length, gains, losses)
    const correctness = { n: paired.length, gains, losses, estimate: risk.estimate, interval: paired.length ? risk.interval : null,
      method: risk.method, pValue: exactMcNemar(gains, losses), adjustedPValue: 1, distinguishable: false }
    const differences = Object.fromEntries(metricNames.map(name => {
      const values = paired.map(row => finite(row.lm[name]) && finite(row.rm[name]) ? row.lm[name]! - row.rm[name]! : null)
      const positive = values.filter(value => value !== null && value > 0).length, negative = values.filter(value => value !== null && value < 0).length
      return [name, { ...medianInterval(values), pValue: exactMcNemar(positive, negative), adjustedPValue: 1,
        positivePairs: positive, negativePairs: negative, distinguishable: false }]
    })) as Record<MetricName, ReturnType<typeof medianInterval> & { pValue: number; adjustedPValue: number; positivePairs: number; negativePairs: number; distinguishable: boolean }>
    return { a, b, definition: `${a} minus ${b}`, pairedSeeds: paired.length, missingPairs: design.seeds.length - paired.length, correctness, differences, causalClaim: false }
  }))
  const excludesZero = (interval: Interval | null) => interval !== null && (interval.lower > 0 || interval.upper < 0)
  const correctnessP = holmAdjusted(pairs.map(pair => pair.correctness.pValue))
  pairs.forEach((pair, index) => { pair.correctness.adjustedPValue = correctnessP[index]
    pair.correctness.distinguishable = pair.missingPairs === 0 && correctnessP[index] < 0.05 && excludesZero(pair.correctness.interval) })
  for (const name of metricNames) {
    const adjusted = holmAdjusted(pairs.map(pair => pair.differences[name].pValue))
    pairs.forEach((pair, index) => { const difference = pair.differences[name]; difference.adjustedPValue = adjusted[index]
      difference.distinguishable = pair.missingPairs === 0 && difference.unknownRuns === 0 && adjusted[index] < 0.05 && excludesZero(difference.interval) })
  }
  const single = arms.find(arm => arm.mode === 'single')!
  const limit = nonnegative(design.modelContextLimit) && design.modelContextLimit > 0 ? design.modelContextLimit : null
  const knownPeaks = single.runs.map(run => run.context.knownPeakLowerBound).filter(nonnegative)
  const reachedHalfRuns = limit === null ? null : knownPeaks.filter(value => value >= limit / 2).length
  const inputSizeEvidence = { modelContextLimit: limit, threshold: limit === null ? null : limit / 2,
    knownSinglePeaks: knownPeaks.length, completeSinglePeaks: single.allConsumption.peakInputTokens.knownRuns,
    reachedHalfRuns, maximumKnownInput: knownPeaks.length ? Math.max(...knownPeaks) : null,
    status: limit === null ? 'model-context-limit-unknown' : !knownPeaks.length ? 'no-known-single-context'
      : reachedHalfRuns! > 0 ? 'at-least-one-single-run-reached-half'
        : single.runs.length === design.seeds.length && single.allConsumption.peakInputTokens.unknownRuns === 0 ? 'all-single-runs-below-half' : 'incomplete-usage-cannot-determine-scale',
    caveat: 'The half-limit check is a scale diagnostic, not a capability or quality score. InputTokens excludes cache, so this ratio can understate actual context load. One run crossing does not establish growth in every seed. Below-half observations cannot establish absence of parallelism benefit.' }
  const preflightRows = runs.filter(run => design.preflight?.seeds.includes(run.seed))
  const output = outputConsumption(runs, outputLimit)
  const preflightOutput = outputConsumption(preflightRows, outputLimit)
  const completedPreflightOutput = outputConsumption(preflightRows.filter(run => run.evaluation.passed), outputLimit)
  const minimumOutputHeadroom = design.preflight?.minOutputHeadroom ?? null
  const preflightMatrixComplete = !!design.preflight && design.preflight.seeds.length >= design.preflight.seedsRequired &&
    preflightRows.length === design.preflight.seeds.length * design.modes.length
  const outputHeadroomStatus = outputLimit === null || minimumOutputHeadroom === null ? 'output-cap-or-headroom-unregistered'
    : !completedPreflightOutput.runs ? 'no-completed-preflight-output'
      : completedPreflightOutput.knownMaximumOutput !== null && completedPreflightOutput.knownMaximumOutput > outputLimit * (1 - minimumOutputHeadroom) ? 'insufficient-output-headroom'
        : !equalBudgetLiveCoverage(preflightRows).complete ? 'incomplete-real-model-coverage'
          : !preflightMatrixComplete || !preflightOutput.outputCoverageComplete || !preflightOutput.truncationCoverageComplete || completedPreflightOutput.headroomFraction === null ? 'incomplete-output-evidence'
            : 'output-headroom-confirmed'
  const sizeEvidence = { ...inputSizeEvidence, criterion: isV3 ? 'report-only-output-diagnostics' : isV2 ? 'single-call-output-headroom' : 'single-peak-input-half-limit',
    status: isV3 ? 'report-only-no-threshold' : isV2 ? outputHeadroomStatus : inputSizeEvidence.status,
    inputContextCriterionApplied: !isV2 && !isV3, minimumOutputHeadroom: isV3 ? null : minimumOutputHeadroom,
    maxOutputTokens: outputLimit, maximumKnownOutput: completedPreflightOutput.knownMaximumOutput,
    maximumOutputTokens: completedPreflightOutput.maximumOutputTokens, headroomFraction: completedPreflightOutput.headroomFraction,
    caveat: isV3 ? 'Round 11 output truncation, headroom and audit gaps are report-only; none is a feasibility gate.' : isV2 ? 'Round 10 measures coordination overhead versus parallelism, not context pressure. The input half-limit criterion is retired. Output headroom is a feasibility check, not evidence of architecture benefit.' : inputSizeEvidence.caveat }
  const completeMatrix = design.seeds.length >= 14 && runs.length === design.seeds.length * design.modes.length
  const liveCoverage = equalBudgetLiveCoverage(runs)
  const liveRuns = liveCoverage.complete
  const auditsPassed = runs.length > 0 && runs.every(run => run.factFlowAudit?.passed === true)
  const modelsMatch = runs.every(run => run.model === (design.model ?? runs[0]?.model))
  const evidenceReady = completeMatrix && budgetEqual && allocationMatched && liveRuns && (isV3 || auditsPassed) && modelsMatch &&
    (!(isV2 || isV3) || preflight?.mainBatchAllowed === true) &&
    (!isV3 || preflightMatrixComplete && preflightRows.some(run => run.evaluation.passed) && equalBudgetLiveCoverage(preflightRows).complete)
  const allCorrectnessIndistinguishable = pairs.every(pair => !pair.correctness.distinguishable)
  const stoppedPerRule = (isV2 || isV3) && !!preflight && !preflight.mainBatchAllowed && preflight.status !== 'pending'
  const v3Interpretations = isV3 ? round11Interpretations(pairs, evidenceReady) : undefined
  return { version: isV3 ? 3 : isV2 ? 2 : 1, round: isV3 ? 11 : isV2 ? 10 : 9, causalClaim: false, benefitClaim: 'not-claimed', plannedRuns: design.seeds.length * design.modes.length,
    observedRuns: runs.length, failedRunsRetained: runs.filter(run => !run.evaluation.passed).length,
    completeMatrix, budgetEqual, allocationMatched, liveRuns, liveCoverage, auditsPassed, modelsMatch, evidenceReady,
    arms, pairs, sizeEvidence, allCorrectnessIndistinguishable,
    preflight: preflight ?? null, stoppedPerRule, studyScope: isV3 ? 'distributed-structure-under-matched-decomposition-instructions; final-round' : isV2 ? 'coordination-overhead-versus-parallelism; not-context-pressure' : 'legacy-input-scale-diagnostic',
    ...(isV3 ? { auditCoverage: equalBudgetAuditCoverage(runs), interpretations: v3Interpretations,
      gateCriteria: ['at-least-one-exact-completion', 'positive-matching-real-model-calls'],
      reportOnlyDiagnostics: ['truncation', 'output-headroom', 'audit-gaps', 'zero-call-attempts'], researchLineFinalRound: true } : {}),
    output, preflightOutput, completedPreflightOutput, truncationDiagnosis: output.truncatedCalls > 0 ? 'persists'
      : output.truncationCoverageComplete ? 'not-observed-in-retained-runs' : 'unknown-due-to-incomplete-coverage',
    indistinguishablePairs: pairs.filter(pair => !pair.correctness.distinguishable).map(pair => ({ a: pair.a, b: pair.b,
      reason: pair.missingPairs ? 'missing-paired-seeds' : 'correctness-difference-not-established', interval: pair.correctness.interval })),
    unresolvedMetrics: pairs.map(pair => ({ a: pair.a, b: pair.b,
      metrics: metricNames.filter(name => !pair.differences[name].distinguishable) })),
    conclusion: isV3 ? !evidenceReady
      ? `第 11 轮终轮实际保留 ${runs.length}/${design.seeds.length * design.modes.length} 次；${stoppedPerRule ? `预检状态 ${preflight!.status}，主批次未获准。` : '登记矩阵或真实调用覆盖尚不完整。'}三条预登记解读均未获完整比较支持，未观察到 ATN 独立贡献证据。研究线在本轮收束，不设计第 12 轮。`
      : `${design.modes.length} 臂登记矩阵完成；${allCorrectnessIndistinguishable ? '全部正确率臂对均未建立差异，不是等效证明。' : '部分正确率差异获配对区间与多重比较支持，三条预登记解读逐项对应如下。'}审计缺口保留为未知，不设闸；仅作描述性关联，causalClaim=false。研究线在第 11 轮收束。`
      : stoppedPerRule ? preflight!.researchLineTerminated
      ? '预检零完成且诊断触发预登记停止规则：等预算比较研究线在第 10 轮终止。在当前模型与 Harness 约束下，未观察到任何架构的相对优势；诊断显示瓶颈是架构性的。未执行主批次，不设计新的比较轮次。'
      : `真实模型预检未放行，已按预登记规则停止在 ${runs.length}/${design.seeds.length * 4} 次；无法作等预算收益判断。`
      : !evidenceReady ? '登记样本、真实模型预检或审计尚不完整，无法作等预算收益判断。'
      : allCorrectnessIndistinguishable ? '四臂正确率差异均未得到配对区间与多重比较支持；未观察到 ATN 正确率优势，不等于证明等效。'
        : '部分臂对的正确率存在统计差异；须结合方向、成本、规模与审计逐项解读，不能据此作因果或 ATN 总体优势主张。',
    methods: { correctness: 'Wilson 95%; paired Tango nominal 95% score interval plus two-sided exact McNemar',
      continuous: 'Median, Q1/Q3 (R type 7), binomial order-statistic 95% median interval; paired median of within-seed differences and two-sided exact sign test',
      multiplicity: isV3 ? `Holm adjustment across the ${pairs.length} registered arm pairs separately for each metric. Intervals remain nominal 95%, not simultaneous; no cross-metric familywise guarantee.` : 'Holm adjustment across the six arm pairs separately for each metric. Intervals remain nominal 95%, not simultaneous; no cross-metric familywise guarantee.',
      distinction: 'Requires complete paired coverage, interval excluding zero, and within-metric Holm p<0.05; failure to distinguish is not equivalence.',
      unknownPolicy: 'Missing usage, unsettled calls and unavailable measurements remain null. Known token subtotals and context lower bounds are separately labeled.' } }
}
