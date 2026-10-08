import { strict as assert } from 'node:assert'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { EQUAL_BUDGET_REPORT_MODES, EQUAL_BUDGET_V3_REPORT_MODES, equalBudgetLiveCoverage, equalBudgetOutputDiagnostics, equalBudgetPeakContext, equalBudgetUsage, medianInterval, summarizeEqualBudgetRuns,
  type EqualBudgetReportDesign, type EqualBudgetRunObservation } from '../../experiments/equal-budget-statistics.ts'
import type { TelemetrySnapshot, TelemetryTotals } from '../../experiments/telemetry.ts'

const exec = promisify(execFile)
const design: EqualBudgetReportDesign = { modes: EQUAL_BUDGET_REPORT_MODES, seeds: Array.from({ length: 14 }, (_, i) => 17 + 14 * i),
  allocations: EQUAL_BUDGET_REPORT_MODES.map(mode => ({ mode, agents: mode === 'single' ? 1 : 16,
    perAgentSteps: mode === 'single' ? [512] : Array(16).fill(32) as number[], totalSteps: 512 })),
  model: 'test-model', modelContextLimit: 1000, frozenAt: '2026-10-07T00:00:00.000Z' }
function totals(input: Array<number | null>, output: Array<number | null>): TelemetryTotals {
  const token = (values: Array<number | null>) => ({ known: values.reduce<number>((sum, value) => sum + (value ?? 0), 0), unknownCalls: values.filter(value => value === null).length })
  return { attempts: input.length, settledAttempts: input.length, inFlight: 0, errors: 0, aborted: 0, incomplete: 0,
    modelDurationMs: 5, toolsStarted: 0, toolsFinished: 0, toolErrors: 0, toolDurationMs: 0,
    tokens: { inputTokens: token(input), outputTokens: token(output), cacheReadTokens: token(input.map(() => 0)),
      cacheWriteTokens: token(input.map(() => 0)), reasoningTokens: token(input.map(() => 0)), totalTokens: token(input.map(() => null)) },
    cost: { amount: null, knownAmount: 0, unknownCalls: input.length, currency: null } }
}
function metrics(input: Array<number | null> = [100, 200], output: Array<number | null> = [10, 20]): TelemetrySnapshot {
  const all = totals(input, output)
  return { version: 1, runId: 'metric-id', startedAt: 1, observedAt: 100, elapsedMs: 99, events: 2,
    atnMessages: 0, atnPayloadBytes: 0, atnMaxContextBytes: 0, atnBoard: { reads: 0, writes: 0, readBytes: 0, writeBytes: 0 },
    atnTotalInteractions: 0, atnTotalTransferBytes: 0, fixedContextBytes: null, meanInputTokensPerCall: null,
    knownMeanInputTokensPerCall: null, inputTokenUnknownCalls: input.filter(value => value === null).length,
    callCosts: input.map((value, i) => ({ call: `call-${i}`, session: 'session-1', systemPromptBytes: 0, toolSchemaBytes: 0, fixedContextBytes: 0, inputTokens: value, outputTokens: output[i], finishReason: 'stop' })),
    totals: all, sessions: { 'session-1': structuredClone(all) },
    coverage: { modelCalls: 'llm/stream invocations, including observable retries and auxiliary calls', hiddenHttpRetries: 'unknown',
      directExternalCalls: 'not-observed', usageSource: 'last adapter usage chunk per invocation; absent fields remain unknown',
      tokenUnits: 'input excludes cache; reasoning is contained in output; total is not added to buckets',
      costMeaning: 'reference tariff estimate, not actual billing or subscription consumption',
      content: 'no prompts, completions, tool arguments/results, error text, or raw identifiers', priceTableId: null,
      writeFailed: false, observationErrors: 0, closedWithInFlight: false } }
}
function observation(mode = 'single', seed = 17): EqualBudgetRunObservation {
  return { runId: `${mode}-${seed}`, mode, seed, execution: 'live-provider', model: 'test-model',
    startedAt: 1000, completedAt: 2000, evaluation: { passed: true }, stopReason: 'completed', issuedModelCalls: 2,
    totalAgents: 1, entrySteps: 2, agentSteps: { 'agent-1': 2 }, agentSessions: { 'agent-1': ['session-1'] },
    allocation: design.allocations.find(allocation => allocation.mode === mode)!, metrics: metrics(),
    protocolInteractions: 0, protocolTransferBytes: 0, factFlowAudit: { passed: true }, causalClaim: false }
}
const fullMatrix = () => design.modes.flatMap(mode => design.seeds.map(seed => observation(mode, seed)))

test('EQUAL-BUDGET-LIVE-COVERAGE: configuration alone never certifies dispatch; zero and missing attempts remain retained', () => {
  const dispatched = observation(), zero = observation('single', 31), missing = observation('single', 45)
  zero.issuedModelCalls = 0
  zero.metrics = metrics([], [])
  zero.evaluation.passed = false
  zero.stopReason = 'quiescent-without-submission'
  missing.metrics = null
  missing.evaluation.passed = false
  assert.deepEqual(equalBudgetLiveCoverage([dispatched, zero, missing]), {
    configuredRuns: 3, dispatchedRuns: 1, zeroCallRuns: 1, unknownDispatchRuns: 1, complete: false,
  })
  assert.deepEqual(equalBudgetLiveCoverage([]), {
    configuredRuns: 0, dispatchedRuns: 0, zeroCallRuns: 0, unknownDispatchRuns: 0, complete: false,
  })
  assert.equal(equalBudgetLiveCoverage([dispatched]).complete, true)
  for (const [issued, attempts] of [[0, 1], [1, 0], [1, 2], [null, 0], [0, null]] as const) {
    const conflict = observation()
    conflict.issuedModelCalls = issued
    if (attempts === null) conflict.metrics = null
    else conflict.metrics!.totals.attempts = attempts
    assert.equal(equalBudgetLiveCoverage([conflict]).unknownDispatchRuns, 1, `${issued}/${attempts}`)
    assert.equal(equalBudgetLiveCoverage([conflict]).complete, false)
  }
  assert.equal(equalBudgetLiveCoverage([{ ...dispatched, execution: 'mock' }]).dispatchedRuns, 0)
  const rows = fullMatrix()
  Object.assign(rows[0], { issuedModelCalls: zero.issuedModelCalls, metrics: zero.metrics, evaluation: zero.evaluation })
  const summary = summarizeEqualBudgetRuns(rows, design)
  assert.equal(summary.observedRuns, 56)
  assert.equal(summary.arms[0].correctness.n, 14)
  assert.equal(summary.arms[0].correctness.successes, 13)
  assert.equal(summary.failedRunsRetained, 1)
  assert.equal(summary.liveRuns, false)
  assert.equal(summary.evidenceReady, false)
  assert.equal(summary.liveCoverage.dispatchedRuns, 55)
  assert.equal(summary.arms[0].liveCoverage.zeroCallRuns, 1)
})

test('EQUAL-BUDGET-STATISTICS: wall-clock median/IQR and conservative 95% interval do not use a mean', () => {
  const summary = medianInterval(Array.from({ length: 14 }, (_, i) => i + 1))
  assert.equal(summary.median, 7.5)
  assert.equal(summary.q1, 4.25)
  assert.equal(summary.q3, 10.75)
  assert.deepEqual(summary.interval, { lower: 3, upper: 12 })
  assert.equal(medianInterval([1, 2, 3, 4, 100000]).median, 3)
  assert.equal(medianInterval([1, 2, 3, 4, 5]).interval, null)
  assert.equal(medianInterval([null, undefined, Number.NaN]).knownRuns, 0)
  assert.equal(medianInterval([null, 4]).unknownRuns, 1)
})

test('EQUAL-BUDGET-PEAK: unknown or unsettled input is not a complete peak; Agent mapping is explicit', () => {
  const run = observation()
  run.metrics = metrics([100, null], [10, 20])
  const peak = equalBudgetPeakContext(run)
  assert.equal(peak.peakInputTokens, null)
  assert.equal(peak.knownPeakLowerBound, 100)
  assert.equal(peak.unknownCalls, 1)
  assert.equal(peak.perAgent[0].peakInputTokens, null)
  assert.equal(peak.agentMappingComplete, true)
  run.metrics = metrics([100], [10])
  run.metrics.totals.attempts = 2
  run.metrics.totals.inFlight = 1
  assert.equal(equalBudgetPeakContext(run).missingCalls, 1)
  assert.equal(equalBudgetPeakContext(run).peakInputTokens, null)
  run.agentSessions = undefined
  assert.equal(equalBudgetPeakContext(run).agentMappingComplete, false)
  run.metrics = null
  assert.equal(equalBudgetPeakContext(run).knownPeakLowerBound, null)
  assert.equal(equalBudgetPeakContext(run).missingCalls, null)
})

test('EQUAL-BUDGET-USAGE: input plus output preserves missing fields and excludes cache/reasoning double counting', () => {
  const run = observation()
  run.metrics!.totals.tokens.cacheReadTokens.known = 7000
  run.metrics!.totals.tokens.reasoningTokens.known = 10
  run.metrics!.totals.tokens.totalTokens.known = 99999
  assert.equal(equalBudgetUsage(run).totalTokens, 330)
  run.metrics = metrics([100, null], [10, 20])
  const partial = equalBudgetUsage(run)
  assert.equal(partial.totalTokens, null)
  assert.equal(partial.knownInputPlusOutput, 130)
  assert.equal(partial.input.unknownCalls, 1)
  run.metrics = metrics([null], [null])
  assert.equal(equalBudgetUsage(run).knownInputPlusOutput, null)
  run.metrics = metrics([], [])
  assert.equal(equalBudgetUsage(run).totalTokens, 0, 'observed zero calls is distinct from missing usage')
  run.metrics = null
  assert.equal(equalBudgetUsage(run).totalTokens, null)
})

test('EQUAL-BUDGET-PAIRS: identical outcomes retain uncertainty and explicitly list all six unresolved pairs', () => {
  const summary = summarizeEqualBudgetRuns(fullMatrix(), design)
  assert.equal(summary.completeMatrix, true)
  assert.equal(summary.budgetEqual, true)
  assert.equal(summary.evidenceReady, true)
  assert.equal(summary.indistinguishablePairs.length, 6)
  assert.equal(summary.pairs.length, 6)
  assert.equal(summary.arms[0].correctness.n, 14)
  assert.ok(summary.arms[0].correctness.interval!.lower < 1)
  assert.ok(summary.pairs[0].correctness.interval!.lower < 0)
  assert.ok(summary.pairs[0].correctness.interval!.upper > 0)
  assert.equal(summary.causalClaim, false)
  assert.equal(summary.sizeEvidence.status, 'all-single-runs-below-half')
})

test('EQUAL-BUDGET-FAILURES: failures remain in denominators and cost; paired direction and Holm matter', () => {
  const rows = fullMatrix()
  rows.filter(row => row.mode === 'single').forEach(row => { row.evaluation.passed = false; row.stopReason = 'host-error:test'; row.completedAt = 5000 })
  const summary = summarizeEqualBudgetRuns(rows, design)
  assert.equal(summary.failedRunsRetained, 14)
  assert.equal(summary.arms[0].failedConsumption.runs, 14)
  assert.equal(summary.arms[0].completedConsumption.runs, 0)
  assert.equal(summary.arms[0].allConsumption.wallClockMs.median, 4000)
  assert.equal(summary.pairs[0].correctness.estimate, -1)
  assert.equal(summary.pairs[0].correctness.distinguishable, true)
  assert.ok(summary.pairs[0].correctness.adjustedPValue < 0.05)
  assert.equal(summary.pairs[0].differences.wallClockMs.median, 3000)
  assert.equal(summary.pairs[0].differences.wallClockMs.distinguishable, true)
  assert.equal(summary.benefitClaim, 'not-claimed')
})

test('EQUAL-BUDGET-UNKNOWN: missing telemetry costs remain unknown and do not authorize a comparison', () => {
  const rows = fullMatrix()
  rows[0].metrics = null
  rows[0].protocolInteractions = null
  rows[0].factFlowAudit = undefined
  const summary = summarizeEqualBudgetRuns(rows, design)
  assert.equal(summary.evidenceReady, false)
  assert.equal(summary.arms[0].allConsumption.usage.missingTelemetryRuns, 1)
  assert.equal(summary.arms[0].allConsumption.totalTokens.unknownRuns, 1)
  assert.equal(summary.pairs[0].differences.peakInputTokens.unknownRuns, 1)
  assert.equal(summary.pairs[0].differences.peakInputTokens.distinguishable, false)
  assert.equal(summary.sizeEvidence.status, 'incomplete-usage-cannot-determine-scale')
  rows[1].metrics = metrics([600, null], [10, 20])
  assert.equal(summarizeEqualBudgetRuns(rows, design).sizeEvidence.reachedHalfRuns, 1)
  assert.equal(summarizeEqualBudgetRuns(rows, { ...design, modelContextLimit: null }).sizeEvidence.status, 'model-context-limit-unknown')
})

test('EQUAL-BUDGET-INTEGRITY: missing pairs, unequal budgets and duplicate replacements cannot pass', () => {
  assert.equal(summarizeEqualBudgetRuns(fullMatrix().slice(1), design).completeMatrix, false)
  const rows = fullMatrix()
  assert.throws(() => summarizeEqualBudgetRuns([...rows, rows[0]], design), /Duplicate/)
  assert.throws(() => summarizeEqualBudgetRuns([{ ...rows[0], seed: 999 }], design), /outside/)
  const changed = structuredClone(design)
  changed.allocations = changed.allocations.map((allocation, i) => i ? allocation : { ...allocation, perAgentSteps: [511], totalSteps: 511 })
  const summary = summarizeEqualBudgetRuns(rows, changed)
  assert.equal(summary.budgetEqual, false)
  assert.equal(summary.allocationMatched, false)
  assert.equal(summary.evidenceReady, false)
})

const v2Design: EqualBudgetReportDesign = { ...design, version: 2, round: 10, conditions: { maxOutputTokens: 8192 },
  preflight: { seeds: design.seeds.slice(0, 3), seedsRequired: 3, minOutputHeadroom: 0.4, widespreadTruncationRunFraction: 0.25 } }

test('EQUAL-BUDGET-OUTPUT: token cap and finish reason identify unique truncations and retain unknown coverage', () => {
  const run = observation()
  run.metrics = metrics([100, 100, 100, 100], [8192, 100, null, 500])
  Object.assign(run.metrics.callCosts[0], { finishReason: 'max-tokens' })
  Object.assign(run.metrics.callCosts[1], { finishReason: 'length' })
  const output = equalBudgetOutputDiagnostics(run, 8192)
  assert.equal(output.truncatedCalls, 2, 'finish reason plus cap on the same call must not double count')
  assert.equal(output.outputKnownCalls, 3)
  assert.equal(output.outputUnknownCalls, 1)
  assert.equal(output.truncationUnknownCalls, 1)
  assert.equal(output.knownMaximumOutput, 8192)
  assert.equal(output.maximumOutputTokens, null)
  assert.equal(output.headroomFraction, null)
  assert.equal(output.knownHeadroomUpperBound, 0)
  run.metrics = metrics([100], [4000])
  assert.equal(equalBudgetOutputDiagnostics(run, 8192).headroomFraction, 1 - 4000 / 8192)
  Object.assign(run.metrics.callCosts[0], { finishReason: null })
  assert.equal(equalBudgetOutputDiagnostics(run, 8192).truncationCoverageComplete, false)
  assert.equal(equalBudgetOutputDiagnostics(run, 8192).outputCoverageComplete, true)
  run.metrics.totals.attempts = 2
  run.metrics.totals.inFlight = 1
  assert.equal(equalBudgetOutputDiagnostics(run, 8192).missingCalls, 1)
  assert.equal(equalBudgetOutputDiagnostics(run, 8192).maximumOutputTokens, null)
  run.metrics = null
  run.issuedModelCalls = null
  assert.equal(equalBudgetOutputDiagnostics(run, 8192).outputUnknownCalls, null)
  assert.equal(equalBudgetOutputDiagnostics(run, 8192).truncationCoverageComplete, false)
})

test('EQUAL-BUDGET-V2: output headroom replaces the old input-scale criterion; stopped preflight remains 12 of 56', () => {
  const runs = fullMatrix().filter(run => v2Design.preflight!.seeds.includes(run.seed))
  runs.forEach(run => { run.evaluation.passed = false; run.stopReason = 'quiescent-without-submission' })
  runs[0].metrics = metrics([100, 200], [100, 8192])
  const preflight = { status: 'stopped-zero-completion', observedRuns: 12, requiredRuns: 12, passedRuns: 0,
    researchLineTerminated: true, mainBatchAllowed: false,
    diagnosis: { category: 'output-budget-and-decomposition', reason: 'Output cap still reached; model failed to decompose.' } }
  const summary = summarizeEqualBudgetRuns(runs, v2Design, preflight)
  assert.equal(summary.version, 2)
  assert.equal(summary.observedRuns, 12)
  assert.equal(summary.plannedRuns, 56)
  assert.equal(summary.completeMatrix, false)
  assert.equal(summary.evidenceReady, false)
  assert.equal(summary.stoppedPerRule, true)
  assert.equal(summary.sizeEvidence.criterion, 'single-call-output-headroom')
  assert.equal(summary.sizeEvidence.inputContextCriterionApplied, false)
  assert.equal(summary.sizeEvidence.status, 'no-completed-preflight-output')
  assert.equal(summary.output.truncatedCalls, 1)
  assert.equal(summary.arms[0].output.truncatedRuns, 1)
  assert.equal(summary.truncationDiagnosis, 'persists')
  assert.match(summary.conclusion, /研究线在第 10 轮终止/)
  assert.equal(summary.indistinguishablePairs.length, 6)
  runs[1].evaluation.passed = true
  assert.equal(summarizeEqualBudgetRuns(runs, v2Design, preflight).sizeEvidence.status, 'output-headroom-confirmed', 'failed cap hits do not replace the exact completion witness')
  runs[1].metrics = metrics([100], [6000])
  assert.equal(summarizeEqualBudgetRuns(runs, v2Design, preflight).sizeEvidence.status, 'insufficient-output-headroom')
  runs[1].metrics = metrics()
  runs[0].metrics = metrics()
  assert.equal(summarizeEqualBudgetRuns(runs, v2Design, preflight).sizeEvidence.status, 'output-headroom-confirmed')
  runs[0].metrics = metrics([100, 200], [100, null])
  assert.equal(summarizeEqualBudgetRuns(runs, v2Design, preflight).sizeEvidence.status, 'incomplete-output-evidence')
})

test('EQUAL-BUDGET-V2: output headroom cannot be certified from an incomplete actual-model preflight', () => {
  const runs = fullMatrix().filter(run => v2Design.preflight!.seeds.includes(run.seed))
  assert.equal(summarizeEqualBudgetRuns(runs, v2Design).sizeEvidence.status, 'output-headroom-confirmed')
  runs[0].issuedModelCalls = 0
  runs[0].metrics = metrics([], [])
  runs[0].evaluation.passed = false
  const zero = summarizeEqualBudgetRuns(runs, v2Design)
  assert.equal(zero.liveCoverage.dispatchedRuns, 11)
  assert.equal(zero.liveCoverage.zeroCallRuns, 1)
  assert.equal(zero.sizeEvidence.status, 'incomplete-real-model-coverage')
  assert.equal(zero.sizeEvidence.maximumOutputTokens, 20, 'retain the observed output maximum as a descriptive measurement')
  assert.equal(zero.sizeEvidence.headroomFraction, 1 - 20 / 8192, 'retain numerical headroom without certifying feasibility')
  assert.equal(zero.evidenceReady, false)
  runs[0].metrics = null
  assert.equal(summarizeEqualBudgetRuns(runs, v2Design).sizeEvidence.status, 'incomplete-real-model-coverage')
  runs[0].metrics = metrics()
  assert.equal(summarizeEqualBudgetRuns(runs, v2Design).sizeEvidence.status, 'incomplete-real-model-coverage', 'contradictory dispatch counts cannot certify headroom')
})

test('EQUAL-BUDGET-V2-REPORT: retained preflight is reported honestly with truncation counts and restricted scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atn-equal-budget-v2-report-'))
  try {
    const input = join(directory, 'input.json'), json = join(directory, 'report.json'), markdown = join(directory, 'report.md')
    const runs = fullMatrix().filter(run => v2Design.preflight!.seeds.includes(run.seed))
    runs.forEach(run => { run.evaluation.passed = false; run.metrics = metrics([100, 200], [100, 8192]) })
    const preflight = { status: 'stopped-zero-completion', observedRuns: 12, requiredRuns: 12, passedRuns: 0,
      researchLineTerminated: true, mainBatchAllowed: false,
      diagnosis: { category: 'output-budget', reason: 'Every retained run reached the output cap.' } }
    await writeFile(input, JSON.stringify({ design: v2Design, preflight, completed: runs, planned: 56 }))
    await exec(process.execPath, ['--import', 'tsx/esm', 'scripts/report-equal-budget.mjs', '--results', input, '--json', json, '--out', markdown], { cwd: process.cwd() })
    const report = JSON.parse(await readFile(json, 'utf8'))
    assert.equal(report.summary.observedRuns, 12)
    assert.equal(report.summary.failedRunsRetained, 12)
    assert.equal(report.summary.preflight.researchLineTerminated, true)
    const text = await readFile(markdown, 'utf8')
    for (const expected of ['12/56', '不是上下文压力', '协调开销与并行的权衡', '截断问题尚未消除', '研究线在第 10 轮终止', '8,192', '40.00%', '输出已知/未知调用']) assert.ok(text.includes(expected), expected)
    assert.ok(!text.includes('single 上下文规模诊断'))
    assert.ok(!text.includes('规模诊断未达到预设标准'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('EQUAL-BUDGET-LIVE-REPORT: zero-dispatch failures are separate from configured live-provider attempts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atn-equal-budget-dispatch-report-'))
  try {
    const input = join(directory, 'input.json'), json = join(directory, 'report.json'), markdown = join(directory, 'report.md')
    const runs = fullMatrix().filter(run => v2Design.preflight!.seeds.includes(run.seed))
    runs[0].issuedModelCalls = 0
    runs[0].metrics = metrics([], [])
    runs[0].evaluation.passed = false
    runs[1].metrics = null
    runs[1].evaluation.passed = false
    const preflight = { status: 'blocked-real-model-coverage', observedRuns: 12, requiredRuns: 12, passedRuns: 10,
      researchLineTerminated: false, mainBatchAllowed: false,
      diagnosis: { category: 'incomplete-real-model-coverage', reason: 'Retained attempts do not establish 12 actual live-model runs.' } }
    await writeFile(input, JSON.stringify({ design: v2Design, preflight, completed: runs, planned: 56 }))
    await exec(process.execPath, ['--import', 'tsx/esm', 'scripts/report-equal-budget.mjs', '--results', input, '--json', json, '--out', markdown], { cwd: process.cwd() })
    const report = JSON.parse(await readFile(json, 'utf8'))
    assert.equal(report.summary.observedRuns, 12)
    assert.equal(report.summary.failedRunsRetained, 2)
    assert.equal(report.summary.liveRuns, false)
    assert.deepEqual(report.summary.liveCoverage, { configuredRuns: 12, dispatchedRuns: 10, zeroCallRuns: 1, unknownDispatchRuns: 1, complete: false })
    const text = await readFile(markdown, 'utf8')
    for (const expected of ['配置为 live-provider 的尝试 12/12 次', '实际调用运行 10 次', '已知零调用 1 次', '调用证据未知或矛盾 1 次', '仍保留在正确率分母', 'blocked-real-model-coverage']) assert.ok(text.includes(expected), expected)
    assert.ok(!text.includes('真实 provider：true'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('EQUAL-BUDGET-REPORT: actual input JSON generates both artifacts, all interpretations and limitations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atn-equal-budget-report-'))
  try {
    const input = join(directory, 'input.json'), json = join(directory, 'report.json'), markdown = join(directory, 'report.md'), designPath = join(directory, 'design.json')
    await writeFile(designPath, JSON.stringify(design))
    await writeFile(input, JSON.stringify({ design: designPath, completed: fullMatrix(), planned: 56 }))
    await exec(process.execPath, ['--import', 'tsx/esm', 'scripts/report-equal-budget.mjs', '--results', input, '--json', json, '--out', markdown], { cwd: process.cwd() })
    const report = JSON.parse(await readFile(json, 'utf8')) as { summary: { observedRuns: number } }
    assert.equal(report.summary.observedRuns, 56)
    const text = await readFile(markdown, 'utf8')
    for (const expected of ['Wilson 95%', 'IQR', '三类结果', '共享 API', '自带传输', 'causalClaim=false', '完成', '失败', '每 Agent', '未观察到', '512']) assert.ok(text.includes(expected), expected)
    assert.ok(text.includes('规模诊断未达到预设标准'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

const v3Design: EqualBudgetReportDesign = { ...design, version: 3, round: 11, modes: EQUAL_BUDGET_V3_REPORT_MODES,
  conditions: { maxOutputTokens: 8192 }, preflight: { seeds: design.seeds.slice(0, 3), seedsRequired: 3 },
  allocations: EQUAL_BUDGET_V3_REPORT_MODES.map(mode => ({ mode, agents: mode.startsWith('single') ? 1 : 16,
    perAgentSteps: mode.startsWith('single') ? [512] : Array<number>(16).fill(32), totalSteps: 512 })),
  scaffoldPrompt: { instruction: '每次调用处理一个分片、累积中间结果、最后合并。', prompts: design.seeds.map(seed => {
    const text = `同一任务 seed ${seed}\n每次调用处理一个分片、累积中间结果、最后合并。`
    return { seed, text, path: `prompts/single-scaffolded-seed-${seed}.txt`, sha256: createHash('sha256').update(text).digest('hex') }
  }) } }
const v3Preflight = { status: 'passed', observedRuns: 15, requiredRuns: 15, passedRuns: 15,
  researchLineTerminated: false, mainBatchAllowed: true, diagnosis: { category: 'feasible', reason: 'Exact completion and actual dispatch witnessed.' } }
function v3Matrix(registration = v3Design) {
  return registration.modes.flatMap(mode => registration.seeds.map(seed => ({ ...observation(mode, seed),
    allocation: registration.allocations.find(allocation => allocation.mode === mode)! })))
}

test('EQUAL-BUDGET-V3: five arms, ten same-seed pairs and report-only diagnostics preserve unknowns', () => {
  const runs = v3Matrix()
  runs[0].metrics = metrics([100, null], [8192, null])
  runs[0].factFlowAudit = { passed: false, submittedFacts: 16, auditedFacts: 1, violations: ['missing-positive-source-path:s02'] }
  runs[1].factFlowAudit = undefined
  const summary = summarizeEqualBudgetRuns(runs, v3Design, v3Preflight)
  assert.equal(summary.version, 3)
  assert.equal(summary.round, 11)
  assert.equal(summary.plannedRuns, 70)
  assert.equal(summary.observedRuns, 70)
  assert.equal(summary.pairs.length, 10)
  assert.equal(summary.completeMatrix, true)
  assert.equal(summary.evidenceReady, true, 'truncation, headroom and audit gaps must not add a gate')
  assert.equal(summary.auditsPassed, false)
  assert.equal(summary.arms[0].auditCoverage!.gapRuns, 1)
  assert.equal(summary.arms[0].auditCoverage!.unknownRuns, 1)
  assert.equal(summary.arms[0].auditCoverage!.auditedFacts.knownTotal, 1)
  assert.equal(summary.arms[0].auditCoverage!.auditedFacts.unknownRuns, 13)
  assert.equal(summary.arms[1].auditCoverage!.auditedFacts.knownTotal, null)
  assert.equal(summary.arms[0].output.truncatedCalls, 1)
  assert.equal(summary.arms[0].output.headroomFraction, null)
  assert.equal(summary.arms[0].outputIntervals!.headroomFraction.unknownRuns, 1)
  assert.equal(summary.arms[0].outputIntervals!.truncatedCalls.unknownRuns, 1)
  assert.equal(summary.sizeEvidence.status, 'report-only-no-threshold')
  assert.equal(summary.sizeEvidence.inputContextCriterionApplied, false)
  assert.equal(summary.sizeEvidence.minimumOutputHeadroom, null)
  assert.deepEqual(summary.gateCriteria, ['at-least-one-exact-completion', 'positive-matching-real-model-calls'])
  assert.equal(summary.interpretations!.length, 3)
  assert.equal(summary.interpretations![0].status, 'observed-pattern-compatible')
  assert.equal(summary.interpretations![1].status, 'pattern-not-observed')
  assert.equal(summary.interpretations![2].status, 'pattern-not-observed')
  assert.equal(summary.indistinguishablePairs.length, 10)
  assert.equal(summary.causalClaim, false)
  assert.match(summary.methods.multiplicity, /10 registered arm pairs/)
})

test('EQUAL-BUDGET-V3: all three preregistered rules bind actual oriented pair intervals', () => {
  const promptRows = v3Matrix()
  promptRows.filter(run => run.mode === 'single').forEach(run => { run.evaluation = { passed: false } })
  const prompt = summarizeEqualBudgetRuns(promptRows, v3Design, v3Preflight)
  assert.equal(prompt.interpretations![0].status, 'observed-pattern-compatible')
  assert.equal(prompt.interpretations![2].status, 'pattern-not-observed')
  assert.match(prompt.interpretations![0].actual, /未做等效检验/)
  const structureRows = v3Matrix()
  structureRows.filter(run => run.mode.startsWith('single')).forEach(run => { run.evaluation = { passed: false } })
  const structure = summarizeEqualBudgetRuns(structureRows, v3Design, v3Preflight)
  assert.equal(structure.interpretations![0].status, 'pattern-not-observed')
  assert.equal(structure.interpretations![1].status, 'observed-pattern-compatible')
  assert.equal(structure.interpretations![1].contrasts.length, 7)
  assert.ok(structure.interpretations![1].contrasts.slice(1).every(row => row.status === 'lower' && row.interval!.upper < 0))
  const larger = { ...v3Design, seeds: Array.from({ length: 32 }, (_, i) => i + 1), preflight: { seeds: [1, 2, 3], seedsRequired: 3 } }
  const mixedRows = v3Matrix(larger)
  mixedRows.forEach(run => { run.evaluation = { passed: run.mode === 'single' ? false : run.mode === 'single-scaffolded' ? run.seed <= 16 : true } })
  const mixed = summarizeEqualBudgetRuns(mixedRows, larger, v3Preflight)
  assert.equal(mixed.interpretations![2].status, 'observed-pattern-compatible')
  assert.equal(mixed.interpretations![2].contrasts[0].status, 'higher')
  assert.ok(mixed.interpretations![2].contrasts[0].interval!.lower > 0, 'reverse orientation must reverse CI endpoints too')
  assert.ok(mixed.interpretations![2].contrasts.slice(1).every(row => row.status === 'lower'))
})

test('EQUAL-BUDGET-V3: missing pairs and zero-call attempts cannot become architecture or equivalence evidence', () => {
  const runs = v3Matrix()
  runs[0].issuedModelCalls = 0
  runs[0].metrics = metrics([], [])
  runs[0].evaluation = { passed: false }
  runs[0].stopReason = 'host-error:UNKNOWN_MODEL'
  const zero = summarizeEqualBudgetRuns(runs, v3Design, v3Preflight)
  assert.equal(zero.evidenceReady, false)
  assert.equal(zero.arms[0].correctness.n, 14)
  assert.equal(zero.arms[0].correctness.successes, 13)
  assert.equal(zero.arms[0].liveCoverage.zeroCallRuns, 1)
  assert.ok(zero.interpretations!.every(rule => rule.status === 'not-assessable'))
  const partial = summarizeEqualBudgetRuns(v3Matrix().slice(1), v3Design, v3Preflight)
  assert.equal(partial.completeMatrix, false)
  assert.ok(partial.pairs.filter(pair => pair.a === 'single').every(pair => pair.pairedSeeds === 13 && pair.missingPairs === 1 && !pair.correctness.distinguishable))
  assert.ok(partial.interpretations!.every(rule => rule.status === 'not-assessable'))
  const reduced = { ...v3Design, modes: ['single', 'single-scaffolded', 'atn-adaptive'] }
  const reducedSummary = summarizeEqualBudgetRuns(v3Matrix(reduced), reduced, v3Preflight)
  assert.equal(reducedSummary.plannedRuns, 42)
  assert.equal(reducedSummary.pairs.length, 3)
  assert.ok(reducedSummary.interpretations!.every(rule => rule.status === 'not-assessable'))
  assert.ok(reducedSummary.interpretations![0].contrasts.some(row => row.status === 'arm-not-registered'))
  assert.throws(() => summarizeEqualBudgetRuns([], { ...v3Design, modes: ['single', 'native-team', 'atn-adaptive'] }), /single-scaffolded/)
  assert.throws(() => summarizeEqualBudgetRuns([...v3Matrix(), v3Matrix()[0]], v3Design), /Duplicate/)
})

test('EQUAL-BUDGET-V3: saved approval cannot replace the retained preflight exact-completion and dispatch witnesses', () => {
  const runs = v3Matrix()
  runs.forEach(run => { run.evaluation = { passed: false } })
  const allFailed = summarizeEqualBudgetRuns(runs, v3Design, v3Preflight)
  assert.equal(allFailed.completeMatrix, true)
  assert.equal(allFailed.preflight!.mainBatchAllowed, true, 'the saved decision remains visible without rewriting it')
  assert.equal(allFailed.evidenceReady, false, 'a forged or stale approval cannot establish feasibility')
  assert.ok(allFailed.interpretations!.every(rule => rule.status === 'not-assessable'))
  runs.filter(run => !v3Design.preflight!.seeds.includes(run.seed)).forEach(run => { run.evaluation = { passed: true } })
  assert.equal(summarizeEqualBudgetRuns(runs, v3Design, v3Preflight).evidenceReady, false, 'later successes do not fabricate a successful preflight witness')
  runs[0].evaluation = { passed: true }
  assert.equal(summarizeEqualBudgetRuns(runs, v3Design, v3Preflight).evidenceReady, true)
  runs[1].issuedModelCalls = 0
  runs[1].metrics = metrics([], [])
  assert.equal(summarizeEqualBudgetRuns(runs, v3Design, v3Preflight).evidenceReady, false)
  runs[1].issuedModelCalls = 2
  assert.equal(summarizeEqualBudgetRuns(runs, v3Design, v3Preflight).evidenceReady, false, 'contradictory preflight dispatch remains unverified')
})

test('EQUAL-BUDGET-V3: explicit infrastructure audit unknown is neither a known gap nor zero audited facts', () => {
  const runs = v3Matrix()
  runs[0].factFlowAudit = { passed: false, unknown: true, noSubmission: true, positiveCompletionEvidence: false,
    submittedFacts: 0, auditedFacts: 0, transportSendBoundaryUnknown: 0, violations: ['host-error-before-audit'] }
  runs[1].factFlowAudit = { passed: false, submittedFacts: 16, auditedFacts: 3,
    transportSendBoundaryUnknown: 2, violations: ['missing-positive-source-path:s04'] }
  const summary = summarizeEqualBudgetRuns(runs, v3Design, v3Preflight)
  const audit = summary.arms[0].auditCoverage!
  assert.equal(audit.unknownRuns, 1)
  assert.equal(audit.gapRuns, 1)
  assert.equal(audit.passedRuns, 12)
  assert.equal(audit.noSubmissionRuns, 0, 'an unknown audit cannot establish this audit field')
  assert.deepEqual(audit.auditedFacts, { knownTotal: 3, knownRuns: 1, unknownRuns: 13 })
  assert.deepEqual(audit.transportSendBoundaryUnknown, { knownTotal: 2, knownRuns: 1, unknownRuns: 13 })
  assert.equal(audit.positiveCompletionEvidenceUnknownRuns, 14)
  assert.equal(summary.evidenceReady, true, 'report-only audit gaps and unknowns do not add a feasibility gate')
  const unknownOnly = summarizeEqualBudgetRuns([runs[0]], v3Design)
  assert.equal(unknownOnly.arms[0].auditCoverage!.auditedFacts.knownTotal, null)
  assert.equal(unknownOnly.arms[0].auditCoverage!.auditedFacts.unknownRuns, 1)
})

test('EQUAL-BUDGET-V3-REPORT: prompt text/hash, all interpretations and unknown diagnostics are rendered without old gates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atn-equal-budget-v3-report-'))
  try {
    const input = join(directory, 'input.json'), json = join(directory, 'report.json'), markdown = join(directory, 'report.md')
    const runs = v3Matrix()
    runs[0].metrics = metrics([100, null], [8192, null])
    runs[0].factFlowAudit = { passed: false, violations: ['missing-positive-source-path:s02'] }
    await writeFile(input, JSON.stringify({ design: v3Design, preflight: v3Preflight, completed: runs }))
    const args = ['--import', 'tsx/esm', 'scripts/report-equal-budget.mjs', '--results', input, '--json', json, '--out', markdown]
    await exec(process.execPath, args, { cwd: process.cwd() })
    const report = JSON.parse(await readFile(json, 'utf8'))
    assert.equal(report.summary.version, 3)
    assert.equal(report.summary.plannedRuns, 70)
    assert.equal(report.summary.evidenceReady, true)
    const text = await readFile(markdown, 'utf8')
    for (const expected of ['单次输出余量（仅报告）', '审计缺口（仅报告）', '三条预登记解读', '未做等效检验', '部分来自指令、部分来自结构', '分布式结构有独立贡献', 'ATN 无独立贡献', '不是等效证明', '10 个登记臂对', '未知', 'causalClaim=false', '第 12 轮', '未观察到完整模式']) assert.ok(text.includes(expected), expected)
    for (const prompt of v3Design.scaffoldPrompt!.prompts) { assert.ok(text.includes(prompt.text)); assert.ok(text.includes(prompt.sha256)); assert.ok(text.includes(prompt.path)) }
    assert.ok(!text.includes('预登记最小余量'))
    assert.ok(!text.includes('大面积截断阈值'))
    assert.ok(!text.includes('single 上下文规模诊断'))
    const invalid = structuredClone(v3Design)
    invalid.scaffoldPrompt!.prompts[0].sha256 = 'wrong'
    await writeFile(input, JSON.stringify({ design: invalid, preflight: v3Preflight, completed: runs }))
    await assert.rejects(exec(process.execPath, args, { cwd: process.cwd() }), /Scaffold prompt hash mismatch/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
