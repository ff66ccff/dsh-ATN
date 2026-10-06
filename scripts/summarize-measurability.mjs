/** Read-only experiment aggregation. Re-run as reports arrive; never promotes unfinished calibration. */
import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const portable = path => relative(ROOT, resolve(path)).replaceAll('\\', '/')
const sha256 = text => createHash('sha256').update(text).digest('hex')
const finite = value => typeof value === 'number' && Number.isFinite(value)
const stable = value => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))

async function jsonFile(path, { optional = false, pendingWrite = false } = {}) {
  const absolute = resolve(ROOT, path)
  let text
  try { text = await readFile(absolute, 'utf8') } catch (error) {
    if (optional && error.code === 'ENOENT') return null
    throw error
  }
  try { return { path: portable(absolute), sha256: sha256(text), value: JSON.parse(text) } } catch (error) {
    if (pendingWrite && error instanceof SyntaxError) return { path: portable(absolute), pendingWrite: true }
    throw error
  }
}

function provenance(file) {
  return file ? { path: file.path, ...(file.sha256 ? { sha256: file.sha256 } : {}), ...(file.pendingWrite ? { pendingWrite: true } : {}) } : null
}

/** Unknown measurements remain null; the subset mean always carries its coverage. */
export function summarizeValues(values) {
  const known = values.filter(finite)
  const knownMean = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null
  return { mean: values.length > 0 && known.length === values.length ? knownMean : null, knownMean,
    coverage: { totalCalls: values.length, knownCalls: known.length, unknownCalls: values.length - known.length,
      fraction: values.length ? known.length / values.length : null } }
}

async function readEvents(directory) {
  const path = join(directory, 'events.jsonl')
  try {
    const text = await readFile(resolve(ROOT, path), 'utf8')
    const ends = new Map()
    for (const line of text.trimEnd().split(/\r?\n/)) {
      if (!line) continue
      const row = JSON.parse(line)
      if (row.kind === 'model.end') {
        if (ends.has(row.call)) throw new Error(`Duplicate model.end ${row.call} in ${path}`)
        ends.set(row.call, row)
      }
    }
    return { path: portable(resolve(ROOT, path)), sha256: sha256(text), ends }
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function costSummary(rawCosts, events) {
  const callCosts = rawCosts.map(row => {
    const event = events?.ends.get(row.call)
    const inputTokens = finite(row.inputTokens) ? row.inputTokens : null
    if (event && (finite(event.usage?.inputTokens) ? event.usage.inputTokens : null) !== inputTokens) {
      throw new Error(`Input usage disagrees between report and event ${row.call}`)
    }
    const cacheReadTokens = finite(event?.usage?.cacheReadTokens) ? event.usage.cacheReadTokens : null
    const cacheWriteTokens = finite(event?.usage?.cacheWriteTokens) ? event.usage.cacheWriteTokens : null
    return { ...row, inputTokens, cacheReadTokens, cacheWriteTokens, status: event?.status ?? null,
      inputPlusCacheReadTokens: inputTokens !== null && cacheReadTokens !== null ? inputTokens + cacheReadTokens : null,
      inputPlusAllCacheTokens: [inputTokens, cacheReadTokens, cacheWriteTokens].every(finite)
        ? inputTokens + cacheReadTokens + cacheWriteTokens : null }
  })
  const input = summarizeValues(callCosts.map(row => row.inputTokens))
  return { meanInputTokensPerCall: input.mean, knownMeanInputTokensPerCall: input.knownMean,
    inputTokenCoverage: input.coverage,
    inputPlusCacheReadTokensPerCall: summarizeValues(callCosts.map(row => row.inputPlusCacheReadTokens)),
    inputPlusAllCacheTokensPerCall: summarizeValues(callCosts.map(row => row.inputPlusAllCacheTokens)), callCosts }
}

function evaluation(report) {
  const phases = report.evaluation ?? []
  const phase = (id, field) => Boolean(phases.find(row => row.phase === id)?.[field])
  const phase1Submitted = report.phase1Submitted ?? phase(1, 'submitted')
  const phase1Correct = report.phase1Correct ?? phase(1, 'passed')
  const phase2Submitted = report.phase2Submitted ?? phase(2, 'submitted')
  const phase2Correct = report.phase2Correct ?? phase(2, 'passed')
  const submissionDisciplineFailure = !phase1Submitted
  const solvingFailure = (phase1Submitted && !phase1Correct) || (phase2Submitted && !phase2Correct)
  return { phase1Submitted, phase1Correct, phase2Submitted, phase2Correct,
    passed: phase1Correct && phase2Correct, submissionDisciplineFailure, solvingFailure,
    failureClass: submissionDisciplineFailure ? 'submission-discipline' : solvingFailure ? 'incorrect-proof'
      : !phase2Submitted ? 'phase-2-not-submitted' : null }
}

async function checkSources(hashes = {}) {
  const differences = []
  for (const [path, expected] of Object.entries(hashes)) {
    try {
      if (sha256(await readFile(resolve(ROOT, 'experiments', path))) !== expected) differences.push(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      differences.push(path)
    }
  }
  const checkedFiles = Object.keys(hashes).length
  return { checkedFiles, sourceHashesMatchCurrent: checkedFiles ? differences.length === 0 : null,
    sourceSnapshotStatus: !checkedFiles ? 'unavailable' : differences.length ? 'historical-snapshot' : 'matches-current',
    differingSources: differences }
}

async function summarizeReport(directory) {
  const reportFile = await jsonFile(join(directory, 'report.json'), { optional: true, pendingWrite: true })
  const manifestFile = await jsonFile(join(directory, 'manifest.json'), { optional: true, pendingWrite: true })
  if (!reportFile?.value || !manifestFile?.value) return { directory: portable(resolve(ROOT, directory)), status: 'pending',
    runId: manifestFile?.value?.runId ?? null, seed: manifestFile?.value?.seed ?? Number(directory.match(/seed-(\d+)$/)?.[1]),
    model: manifestFile?.value?.model?.id ?? null, mode: manifestFile?.value?.mode ?? null,
    sourceHashes: manifestFile?.value?.sourceHashes ?? null,
    ...await checkSources(manifestFile?.value?.sourceHashes),
    phase1Submitted: null, phase1Correct: null, phase2Submitted: null, phase2Correct: null,
    passed: null, submissionDisciplineFailure: null, solvingFailure: null, failureClass: null,
    report: provenance(reportFile), manifest: provenance(manifestFile) }
  const report = reportFile.value, manifest = manifestFile.value
  const observedEvaluation = evaluation(report)
  for (const [key, value] of Object.entries(observedEvaluation)) {
    if (report[key] !== value) throw new Error(`Evaluation field ${key} disagrees in ${directory}`)
  }
  const events = await readEvents(directory)
  const costs = costSummary(report.metrics?.callCosts ?? [], events)
  if (costs.meanInputTokensPerCall !== report.meanInputTokensPerCall || costs.knownMeanInputTokensPerCall !== report.metrics?.knownMeanInputTokensPerCall) {
    throw new Error(`Input means disagree in ${directory}`)
  }
  return { directory: portable(resolve(ROOT, directory)), status: 'completed', runId: report.runId,
    report: provenance(reportFile), reportSha256: reportFile.sha256, manifest: provenance(manifestFile), events: provenance(events),
    model: report.model, mode: report.mode, seed: report.seed, execution: report.execution,
    conditions: report.conditions, protocolRevision: manifest.protocolRevision, taskHash: manifest.taskHash,
    ...observedEvaluation, stopReason: report.stopReason, cleanup: report.cleanup, elapsedMs: report.elapsedMs,
    issuedModelCalls: report.issuedModelCalls, sourceHashes: report.sourceHashes, ...await checkSources(report.sourceHashes),
    automaticAdvanceOccurred: report.manipulation?.automaticAdvanceOccurred ?? null,
    phaseTransitionReason: report.manipulation?.transitionReason ?? null, fixedContext: manifest.fixedContext,
    fixedContextBytes: report.fixedContextBytes, ...costs,
    atnTotalInteractions: report.atnTotalInteractions, atnTotalTransferBytes: report.atnTotalTransferBytes,
    relativeInteractions: report.relativeInteractions, relativeTransferBytes: report.relativeTransferBytes,
    hostControlInputs: report.hostControlInputs, reference: report.reference, budget: report.budget,
    failures: report.failures, modelMetrics: report.metrics?.totals ?? null,
    checkpointObligations: report.checkpointObligations, protocolAfterCleanup: report.protocolAfterCleanup,
    causalClaim: false }
}

function runSummary(runs, planned, { complete = runs.length === planned, live = false } = {}) {
  const completed = runs.filter(row => row.status === 'completed')
  const signature = run => stable({ model: run.model, execution: run.execution,
    conditions: stable(Object.fromEntries(Object.entries(run.conditions).filter(([key]) => key !== 'seed'))),
    sourceHashes: stable(run.sourceHashes) })
  const homogeneous = completed.length > 0 && new Set(completed.map(signature)).size === 1
  const uniqueRuns = new Set(completed.map(run => run.runId)).size === completed.length
  const correct = completed.filter(row => row.phase1Correct && row.phase2Correct).length
  const finished = complete && completed.length === planned
  const gatePassed = finished && homogeneous && uniqueRuns && completed.every(row => row.mode === 'fixed')
    && completed.length >= 5 && correct / completed.length >= 0.8
    && (!live || completed.every(row => row.execution === 'live-provider'))
  return { status: finished ? 'complete' : 'pending', planned, completed: completed.length, pending: Math.max(0, planned - completed.length),
    correct, completedSuccessRate: completed.length ? correct / completed.length : null,
    phase1SubmittedRate: completed.length ? completed.filter(row => row.phase1Submitted).length / completed.length : null,
    phase2SubmittedRate: completed.length ? completed.filter(row => row.phase2Submitted).length / completed.length : null,
    submissionDisciplineFailures: completed.filter(row => row.submissionDisciplineFailure).length,
    solvingFailures: completed.filter(row => row.solvingFailure).length,
    homogeneous, uniqueRuns, gatePassed, gateStatus: !finished ? 'pending' : gatePassed ? 'passed' : 'failed',
    interpretation: 'feasibility-only', mayInterpretTopology: false, causalClaim: false }
}

async function scriptedScan(directory) {
  const scanFile = await jsonFile(join(directory, 'scan.json'), { optional: true, pendingWrite: true })
  if (!scanFile?.value) return { status: 'pending', directory: portable(resolve(ROOT, directory)), scan: provenance(scanFile),
    selected: null, realModelGatePassed: false, configurations: [], runs: [], causalClaim: false }
  const scan = scanFile.value
  const configurations = [], runs = []
  for (const configuration of scan.configurations) {
    const rows = await Promise.all(configuration.directories.map(summarizeReport))
    runs.push(...rows)
    configurations.push({ chainLength: configuration.chainLength, perNodeSteps: configuration.perNodeSteps,
      ...runSummary(rows, scan.plan.repeats), runIds: rows.map(row => row.runId), directories: rows.map(row => row.directory) })
  }
  const complete = scan.complete === true && configurations.length === scan.plan.configurations.length && configurations.every(row => row.status === 'complete')
  return { status: complete ? 'complete' : 'pending', directory: portable(resolve(ROOT, directory)), scan: provenance(scanFile),
    plan: scan.plan, selected: complete ? scan.selected : null, configurations, runs,
    providerCalls: 0, realModelGatePassed: false, interpretation: scan.interpretation ?? scan.plan.interpretation, causalClaim: false }
}

async function liveBatch(directory, defaultModel) {
  const batchFile = await jsonFile(join(directory, 'batch.json'), { optional: true, pendingWrite: true })
  const interruptionFile = await jsonFile(join(directory, 'interrupted.json'), { optional: true, pendingWrite: true })
  const batch = batchFile?.value
  // The requested live fixed-arm plan is five seeds; missing directories remain pending.
  const planned = batch?.planned ?? 5
  let model = batch?.completed?.[0]?.model
  if (!model) {
    try {
      for (const entry of await readdir(resolve(ROOT, directory), { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const manifest = await jsonFile(join(directory, entry.name, 'manifest.json'), { optional: true, pendingWrite: true })
        if (manifest?.value?.model?.id) { model = manifest.value.model.id; break }
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  model ??= defaultModel
  const expected = Array.from({ length: planned }, (_, index) => join(directory, `${model}-fixed-seed-${17 + index * 14}`))
  const known = (batch?.completed ?? []).map(row => row.directory)
  const directories = [...new Set([...expected, ...known].map(path => resolve(ROOT, path)))]
  const runs = await Promise.all(directories.map(summarizeReport))
  const completed = runs.filter(row => row.status === 'completed')
  const summary = runSummary(runs, planned, { complete: completed.length === planned, live: true })
  const stopped = Boolean(interruptionFile?.value) && completed.length < planned
  if (stopped) {
    for (const run of runs.filter(row => row.status !== 'completed')) {
      run.status = run.manifest?.sha256 ? 'interrupted-partial' : 'not-run'
      run.finalOutcomeAvailable = false
      run.interruption = provenance(interruptionFile)
      // Preserve incomplete raw evidence without treating it as a completed model call distribution.
      try {
        const path = join(run.directory, 'events.jsonl')
        const data = await readFile(resolve(ROOT, path))
        run.partialEvents = { path, sha256: sha256(data), bytes: data.length }
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const requiredSuccesses = Math.ceil(planned * 0.8)
    const maximumPossibleSuccesses = summary.correct + planned - completed.length
    Object.assign(summary, { status: 'early-stopped', pending: 0, unevaluated: planned - completed.length,
      gatePassed: false, gateStatus: maximumPossibleSuccesses < requiredSuccesses ? 'unattainable' : 'not-evaluated',
      requiredSuccesses, maximumPossibleSuccesses, interpretation: 'early-stopped-feasibility-screen' })
  }
  const inputs = summarizeValues(completed.flatMap(row => row.callCosts.map(call => call.inputTokens)))
  return { ...summary,
    model, directory: portable(resolve(ROOT, directory)), batch: provenance(batchFile),
    interruption: interruptionFile ? { source: provenance(interruptionFile), ...interruptionFile.value } : null,
    sourceSnapshotStatuses: [...new Set(completed.map(row => row.sourceSnapshotStatus))],
    sourceHashesMatchCurrent: completed.length ? completed.every(row => row.sourceHashesMatchCurrent === true) : null,
    meanInputTokensPerCall: inputs.mean, knownMeanInputTokensPerCall: inputs.knownMean, inputTokenCoverage: inputs.coverage,
    inputMeanWeighting: 'All calls from completed runs of this batch, weighted by calls; pending, interrupted and unstarted runs are excluded and explicitly labelled.',
    catalog: provenance(await jsonFile(join(directory, 'catalog.json'), { optional: true })),
    fixedGatePassed: summary.gatePassed,
    batchRecordedCompleted: batch?.completed?.length ?? null, pendingSeeds: runs.filter(row => row.status === 'pending')
      .map(row => Number(row.directory.match(/seed-(\d+)$/)?.[1])),
    unevaluatedSeeds: runs.filter(row => ['interrupted-partial', 'not-run'].includes(row.status)).map(row => row.seed), runs }
}

async function baselineRuns(file) {
  const historicalFile = await jsonFile(file.value.source)
  if (historicalFile.sha256 !== file.value.sourceSha256) throw new Error('Historical summary digest changed')
  const index = historicalFile.value.batches.flatMap(batch => batch.runs.map(run => ({ ...run, sourceHashes: batch.sourceHashes })))
  const runs = []
  for (const row of file.value.runs) {
    const historical = index.find(run => run.directory === row.directory)
    if (!historical) throw new Error(`Missing historical run ${row.directory}`)
    const events = await readEvents(row.directory)
    if (events && events.sha256 !== row.eventFileSha256) throw new Error(`Historical event digest changed: ${row.directory}`)
    const reportFile = await jsonFile(join(row.directory, 'report.json'), { optional: true })
    if (reportFile && reportFile.sha256 !== historical.reportSha256) throw new Error(`Historical report digest changed: ${row.directory}`)
    const costs = costSummary(row.calls, events)
    if (costs.meanInputTokensPerCall !== row.meanInputTokensPerCall || costs.knownMeanInputTokensPerCall !== row.knownMeanInputTokensPerCall) {
      throw new Error(`Historical input mean mismatch: ${row.directory}`)
    }
    runs.push({ directory: row.directory, status: 'completed', model: row.model, mode: row.mode, seed: row.seed,
      runId: historical.runId, protocolRevision: historical.protocolRevision, execution: historical.execution,
      reportSha256: historical.reportSha256, report: provenance(reportFile),
      events: provenance(events) ?? { path: `${row.directory}/events.jsonl`, sha256: row.eventFileSha256, available: false },
      sourceHashes: historical.sourceHashes,
      conditions: { ...historical.limits, chainLength: 4, autoAdvance: true },
      conditionProvenance: 'Original experiment manifest limits; four-hop chain and automatic half-budget advance documented in FULL_FEEDBACK_EXPERIMENT and recovery brief.',
      ...evaluation(historical), ...costs, stopReason: historical.stopReason, issuedModelCalls: historical.issuedModelCalls,
      failures: historical.failures, modelMetrics: historical.modelMetrics,
      atnTotalInteractions: historical.communication.totalInteractions, atnTotalTransferBytes: historical.communication.totalTransferBytes,
      relativeInteractions: historical.relativeInteractions, relativeTransferBytes: historical.relativeTransferBytes, causalClaim: false })
  }
  return { source: provenance(file), historicalSummary: provenance(historicalFile), runs }
}

function context(file) {
  const row = file.value
  return { source: provenance(file), systemPromptBytes: row.systemPromptBytes, toolSchemaBytes: row.toolSchemaBytes,
    fixedContextBytes: row.fixedContextBytes ?? row.systemPromptBytes + row.toolSchemaBytes,
    tools: row.tools, rules: row.rules ?? (row.sharedRules ? row.sharedRules.split('\n').length : null) }
}

async function historicalSnapshot(version = 'v2') {
  const directory = `.artifacts/measurability/source-${version}`
  const manifest = await jsonFile(join(directory, 'manifest.json'), { optional: true })
  const sourceFiles = []
  for (const [path, expected] of Object.entries(manifest?.value?.sourceHashes ?? {})) {
    const archivedPath = resolve(ROOT, directory, 'experiments', path)
    const observed = sha256(await readFile(archivedPath))
    if (observed !== expected) throw new Error(`Historical source archive digest changed: ${path}`)
    sourceFiles.push({ source: path, archivedPath: portable(archivedPath), sha256: observed })
  }
  return { version, directory, manifest: provenance(manifest), origin: manifest?.value?.source ?? null,
    reconstruction: manifest?.value?.reconstruction ?? null,
    sourceFiles, archiveVerified: sourceFiles.length > 0,
    ...await checkSources(manifest?.value?.sourceHashes),
    note: `${version} is retained as an earlier source snapshot. Recorded run hashes are unchanged; current source differences and verified archived bytes are separate evidence.`,
    frozenSummary: provenance(await jsonFile(`experiments/results/measurability-recovery-20261005-${version}.json`, { optional: true })),
    scriptedCalibration: await scriptedScan(`.artifacts/experiments/measurability-calibration-20261005-${version}`) }
}

/** Select one completed batch; never pool successes across models or resource conditions. */
export function selectLiveCalibration(batches) {
  const eligible = batches.filter(batch => batch.status === 'complete' && batch.gatePassed === true &&
    batch.sourceHashesMatchCurrent === true && batch.runs.every(run => run.status === 'completed' && run.execution === 'live-provider'))
  const conditions = batch => Object.fromEntries(Object.entries(batch.runs[0].conditions).filter(([key]) => key !== 'seed'))
  eligible.sort((a, b) => conditions(a).chainLength - conditions(b).chainLength ||
    conditions(a).perNodeSteps - conditions(b).perNodeSteps || a.model.localeCompare(b.model) || a.directory.localeCompare(b.directory))
  const batch = eligible[0]
  return batch ? { model: batch.model, directory: batch.directory, conditions: conditions(batch),
    completed: batch.completed, planned: batch.planned, correct: batch.correct, successRate: batch.completedSuccessRate,
    gateStatus: batch.gateStatus, fixedGatePassed: batch.fixedGatePassed, sourceHashesMatchCurrent: true,
    sourceHashes: batch.runs[0].sourceHashes, runIds: batch.runs.map(run => run.runId),
    reports: batch.runs.map(run => run.report), selection: 'lowest chainLength, then lowest perNodeSteps among completed qualifying current-source live batches',
    caveat: 'Lowest among tested real conditions; budgets differ. This is not a global minimum or a controlled effect estimate.',
    interpretation: 'feasibility-only', mayInterpretTopology: false, causalClaim: false } : null
}

export async function summarizeMeasurability({ scriptedDirectory = '.artifacts/experiments/measurability-calibration-20261005-v4',
  liveDirectory = '.artifacts/experiments/measurability-live-fixed-20261005-v2',
  additionalLiveDirectories = ['.artifacts/experiments/measurability-live-longcat-20261005',
    '.artifacts/experiments/measurability-live-fixed-steps32-20261005',
    '.artifacts/experiments/measurability-live-fixed-steps32-20261005-v4'] } = {}) {
  const beforeFile = await jsonFile('.artifacts/measurability/before-context.json', { optional: true })
    ?? await jsonFile('.artifacts/measurability/baseline-context.json')
  const afterFile = await jsonFile('.artifacts/measurability/after-context.json')
  const [baseline, scripted, live, alternatives, previousSnapshot, previousV3Snapshot] = await Promise.all([
    baselineRuns(await jsonFile('.artifacts/measurability/baseline-input-distributions.json')),
    scriptedScan(scriptedDirectory), liveBatch(liveDirectory, 'space-bunny-free'),
    Promise.all(additionalLiveDirectories.filter(directory => resolve(ROOT, directory) !== resolve(ROOT, liveDirectory))
      .map(directory => liveBatch(directory, directory.includes('longcat') ? 'longcat-2.5-preview-free' : 'space-bunny-free'))),
    historicalSnapshot(),
    historicalSnapshot('v3'),
  ])
  const before = context(beforeFile), after = context(afterFile)
  if (after.rules === null) {
    const toolsSource = await readFile(join(ROOT, 'src/tools.ts'), 'utf8')
    const rulesBlock = toolsSource.match(/export const SHARED_RULES = \[([\s\S]*?)\]\.join/)
    if (rulesBlock) {
      after.rules = rulesBlock[1].split('\n').filter(line => /^\s*'/.test(line)).length
      after.rulesSource = { path: 'src/tools.ts', sha256: sha256(toolsSource), method: 'Count one literal rule per line in SHARED_RULES source array' }
    }
  }
  const earlierArtifacts = []
  for (const path of ['.artifacts/experiments/measurability-calibration-20261005/SUPERSEDED.json',
    '.artifacts/experiments/measurability-live-fixed-20261005/interrupted.json']) {
    const file = await jsonFile(path, { optional: true })
    if (file) earlierArtifacts.push({ source: provenance(file), ...file.value, includedInFinalGate: false })
  }
  const reduction = Object.fromEntries(['systemPromptBytes', 'toolSchemaBytes', 'fixedContextBytes'].map(key => [key,
    { before: before[key], after: after[key], reduction: before[key] - after[key], reductionPercent: (before[key] - after[key]) / before[key] * 100 }]))
  const comparisonFields = run => run ? Object.fromEntries(['runId', 'directory', 'conditions', 'phase1Submitted', 'phase1Correct', 'phase2Submitted', 'phase2Correct',
    'meanInputTokensPerCall', 'knownMeanInputTokensPerCall', 'inputTokenCoverage', 'inputPlusCacheReadTokensPerCall', 'inputPlusAllCacheTokensPerCall',
    'atnTotalInteractions', 'atnTotalTransferBytes', 'relativeInteractions', 'relativeTransferBytes'].map(key => [key, run[key]])) : null
  const comparisons = [live, ...alternatives].map(batch => {
    const beforeRun = baseline.runs.find(run => run.directory.includes('full-feedback-bounded-20261005/') && run.model === batch.model && run.mode === 'fixed' && run.seed === 17)
    const afterRun = batch.runs.find(run => run.status === 'completed' && run.model === batch.model && run.mode === 'fixed' && run.seed === 17)
    return { model: batch.model, batchDirectory: batch.directory,
      status: beforeRun && afterRun ? 'available-with-confounds' : batch.status === 'early-stopped' ? 'unavailable' : 'pending',
      before: comparisonFields(beforeRun), after: comparisonFields(afterRun), causalClaim: false,
      confounds: ['chainLength 4 → 2', 'protocol revision 2 → 3', 'automatic phase advance enabled → disabled', 'shared rules/tools and mail formatting changed',
        'steps, call budget, observed-token admission threshold and timeout may differ; inspect both recorded conditions',
        'provider timing, responses and errors differ; one shared seed is not a controlled effect estimate'] }
  })
  return { version: 1, collectedAt: new Date().toISOString(), causalClaim: false,
    boundaries: [
      'Fixed context bytes cover ATN shared rules plus ATN tool schemas, not every host/system instruction or experiment tool.',
      'meanInputTokensPerCall excludes cache tokens. Any unknown call makes the complete-run mean null; knownMean uses only the explicitly reported subset.',
      'inputPlusCacheRead and inputPlusAllCache are separate supplementary observed prompt-volume metrics; missing cacheWrite is never assumed zero.',
      'Scripted adapters prove deterministic protocol feasibility, not real-model ability. Unfinished live batches remain pending unless an explicit interruption records an early stop; partial outcomes are never imputed.',
      'Only the fixed arm is run here; no adaptive-versus-fixed or causal topology conclusion is licensed even when its admission gate passes.',
      'Each live model and condition batch has its own five-run admission gate and call-weighted token coverage; success counts and means are never pooled across models or conditions.',
      'Historical source hashes are preserved; mismatches with the current workspace are labelled historical snapshots and do not rewrite earlier experiment evidence.',
      'Historic and recovery seed-17 runs change chain length 4 to 2, protocol, prompts and automatic phase advancement. Their token differences do not isolate the tool/schema change.',
    ], fixedContext: { before, after, reduction }, baseline, scriptedCalibration: scripted, liveCalibration: live,
    liveAlternatives: alternatives, selectedLiveCalibration: selectLiveCalibration([live, ...alternatives]),
    historicalPreviousSnapshot: previousSnapshot, historicalSnapshots: [previousSnapshot, previousV3Snapshot], earlierArtifacts,
    sameModelSeed17Comparison: comparisons[0], sameModelSeed17Comparisons: comparisons }
}

function printSummary(report) {
  console.table(Object.fromEntries(Object.entries(report.fixedContext.reduction).map(([key, row]) => [key,
    { before: row.before, after: row.after, reductionPercent: row.reductionPercent.toFixed(2) } ])))
  console.table(report.scriptedCalibration.configurations.map(row => ({ chain: row.chainLength, steps: row.perNodeSteps,
    completed: `${row.completed}/${row.planned}`, correct: row.correct, status: row.status, scriptedGate: row.gateStatus })))
  console.log(`Scripted current: ${report.scriptedCalibration.directory}; historical source archives: ${report.historicalSnapshots.map(snapshot => `${snapshot.version}:${snapshot.sourceFiles.length} verified files`).join(', ')}`)
  for (const batch of [report.liveCalibration, ...report.liveAlternatives]) {
  console.log(`${batch.model} [${batch.directory}]: ${batch.completed}/${batch.planned} completed, ${batch.correct} correct; status=${batch.status}; gate=${batch.gateStatus}`)
  console.table(batch.runs.map(row => ({ seed: row.seed ?? Number(row.directory.match(/seed-(\d+)$/)?.[1]), status: row.status,
    phase1Submitted: row.phase1Submitted ?? null, phase1Correct: row.phase1Correct ?? null,
    phase2Submitted: row.phase2Submitted ?? null, phase2Correct: row.phase2Correct ?? null,
    calls: row.issuedModelCalls ?? null, meanInput: row.meanInputTokensPerCall ?? null,
    knownMeanInput: row.knownMeanInputTokensPerCall?.toFixed(2) ?? null,
    inputCoverage: row.inputTokenCoverage ? `${row.inputTokenCoverage.knownCalls}/${row.inputTokenCoverage.totalCalls}` : null,
    interactions: row.atnTotalInteractions ?? null, transferBytes: row.atnTotalTransferBytes ?? null,
    interactionRatio: row.relativeInteractions?.toFixed(2) ?? null, byteRatio: row.relativeTransferBytes?.toFixed(2) ?? null })))
  }
  console.log(JSON.stringify({ scriptedStatus: report.scriptedCalibration.status, liveStatus: report.liveCalibration.status,
    liveCompleted: report.liveCalibration.completed, livePlanned: report.liveCalibration.planned, liveCorrect: report.liveCalibration.correct,
    fixedGateStatus: report.liveCalibration.gateStatus, mayInterpretTopology: false,
    selectedLiveCalibration: report.selectedLiveCalibration ? { model: report.selectedLiveCalibration.model,
      directory: report.selectedLiveCalibration.directory, conditions: report.selectedLiveCalibration.conditions,
      correct: report.selectedLiveCalibration.correct, completed: report.selectedLiveCalibration.completed,
      gateStatus: report.selectedLiveCalibration.gateStatus, caveat: report.selectedLiveCalibration.caveat } : null,
    alternatives: report.liveAlternatives.map(batch => ({ model: batch.model, directory: batch.directory, status: batch.status,
      completed: batch.completed, planned: batch.planned,
      correct: batch.correct, gateStatus: batch.gateStatus, meanInput: batch.meanInputTokensPerCall,
      knownMeanInput: batch.knownMeanInputTokensPerCall, coverage: batch.inputTokenCoverage })),
    seed17BeforeKnownMeanInput: report.sameModelSeed17Comparison.before?.knownMeanInputTokensPerCall ?? null,
    seed17AfterKnownMeanInput: report.sameModelSeed17Comparison.after?.knownMeanInputTokensPerCall ?? null }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { 'scripted-dir': { type: 'string' }, 'live-dir': { type: 'string' },
    'additional-live-dir': { type: 'string', multiple: true },
    out: { type: 'string', default: 'experiments/results/measurability-recovery-20261005.json' } } })
  const report = await summarizeMeasurability({ scriptedDirectory: values['scripted-dir'], liveDirectory: values['live-dir'],
    additionalLiveDirectories: values['additional-live-dir'] })
  const output = resolve(ROOT, values.out)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  printSummary(report)
  console.log(`Saved ${portable(output)}`)
}
