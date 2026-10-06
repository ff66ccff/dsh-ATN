/** Read-only reconciliation of peer-variance evidence. Run with node --import tsx/esm. */
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { summarizeShiftingRuns, summarizeAdaptiveProbe } from '../experiments/shifting-evidence-protocol.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const portable = path => relative(root, resolve(path)).replaceAll('\\', '/')
const hash = value => createHash('sha256').update(value).digest('hex')
const { values } = parseArgs({ options: {
  calibration: { type: 'string' }, probe: { type: 'string' }, fixed: { type: 'string' },
  out: { type: 'string', default: 'experiments/results/peer-variance-20261006.json' },
} })

async function read(path) {
  const text = await readFile(resolve(root, path), 'utf8')
  return { path: portable(resolve(root, path)), sha256: hash(text), value: JSON.parse(text) }
}

async function reconcile(run) {
  const report = await read(join(run.directory, 'report.json'))
  const row = report.value
  if (row.runId !== run.runId) throw new Error(`Run identity mismatch: ${run.directory}`)
  const differingSources = []
  const sourceHashes = row.sourceHashes ?? {}
  for (const [file, expected] of Object.entries(sourceHashes)) {
    if (hash(await readFile(resolve(root, 'experiments', file))) !== expected) differingSources.push(file)
  }
  const steps = row.protocol?.stepUse ?? []
  const maxNodeSteps = steps.length ? Math.max(...steps.map(node => node.stepsUsed)) : null
  const maxNodeStepRatio = maxNodeSteps === null ? null : maxNodeSteps / row.conditions.perNodeSteps
  return { ...row, directory: portable(resolve(root, run.directory)), report: { path: report.path, sha256: report.sha256 },
    sourceHashesMatchCurrent: Object.keys(sourceHashes).length > 0 && differingSources.length === 0,
    differingSources, maxNodeSteps, maxNodeStepRatio }
}

async function batch(path) {
  if (!path) return null
  const file = await read(join(path, 'batch.json'))
  const runs = await Promise.all(file.value.completed.map(reconcile))
  return { batch: { path: file.path, sha256: file.sha256 }, planned: file.value.planned,
    complete: runs.length === file.value.planned, raw: file.value, runs }
}

const calibrationFile = values.calibration ? await read(join(values.calibration, 'scan.json')) : null
const probe = await batch(values.probe), fixed = await batch(values.fixed)
const contexts = await Promise.all(['before', 'after'].map(stage => read(`.artifacts/peer-variance/context-${stage}.json`)))
const context = Object.fromEntries(contexts.map((file, index) => [['before', 'after'][index], {
  source: { path: file.path, sha256: file.sha256 }, systemPromptBytes: file.value.systemPromptBytes,
  toolSchemaBytes: file.value.toolSchemaBytes, fixedContextBytes: file.value.fixedContextBytes,
}]))
const compact = row => ({ runId: row.runId, directory: row.directory, report: row.report,
  mode: row.mode, purpose: row.purpose, model: row.model, seed: row.seed, execution: row.execution,
  startedAt: row.startedAt, completedAt: row.completedAt,
  conditions: row.conditions, sourceHashes: row.sourceHashes,
  sourceHashesMatchCurrent: row.sourceHashesMatchCurrent, differingSources: row.differingSources,
  passed: row.passed, phase1Submitted: row.phase1Submitted, phase1Correct: row.phase1Correct,
  phase2Submitted: row.phase2Submitted, phase2Correct: row.phase2Correct, stopReason: row.stopReason,
  cleanup: row.cleanup, issuedModelCalls: row.issuedModelCalls, maxNodeSteps: row.maxNodeSteps,
  budget: row.budget,
  maxNodeStepRatio: row.maxNodeStepRatio, requesterFeedback: row.protocol?.requesterFeedback ?? null,
  rewireTelemetry: row.rewireTelemetry ?? row.protocol?.rewireTelemetry ?? null,
  explicitRewires: row.protocol?.explicitRewires ?? [], failures: row.failures,
  toolErrors: row.metrics?.totals?.toolErrors ?? null,
  fixedContextBytes: row.fixedContextBytes,
  meanInputTokensPerCall: row.meanInputTokensPerCall,
  knownMeanInputTokensPerCall: row.metrics?.knownMeanInputTokensPerCall ?? null,
  inputTokenUnknownCalls: row.metrics?.inputTokenUnknownCalls ?? null,
  tokenUsage: row.metrics?.totals?.tokens ?? null,
  cost: row.metrics?.totals?.cost ?? null,
  usageCoverage: row.metrics?.coverage ?? null,
  automaticAdvanceOccurred: row.manipulation?.automaticAdvanceOccurred ?? null,
})
const gatesOnly = summary => ({ ...summary, runs: undefined,
  ...(summary.probe ? { probe: { ...summary.probe, runs: undefined } } : {}),
})
let calibration = null
if (calibrationFile) {
  const scan = calibrationFile.value
  const configurations = []
  for (const configuration of scan.configurations) {
    const runs = await Promise.all(configuration.runs.map(reconcile))
    configurations.push({ ...gatesOnly(configuration), directories: configuration.directories.map(path => portable(resolve(root, path))),
      runs: runs.map(compact) })
  }
  calibration = { source: { path: calibrationFile.path, sha256: calibrationFile.sha256 }, ...scan, configurations,
    selected: scan.selected ? { ...scan.selected, artifacts: scan.selected.artifacts.map(path => portable(resolve(root, path))) } : null }
}
const output = { version: 1, reconciledAt: new Date().toISOString(),
  sourceMatchMeaning: 'sourceHashesMatchCurrent compares against workspace files at reconciledAt; archived runs retain their own sourceHashes.',
  context, contextReduction: {
  toolSchemaBytes: context.before.toolSchemaBytes - context.after.toolSchemaBytes,
  fixedContextBytes: context.before.fixedContextBytes - context.after.fixedContextBytes,
}, calibration,
  adaptiveProbe: probe ? { source: probe.batch, planned: probe.planned, complete: probe.complete,
    summary: gatesOnly(summarizeAdaptiveProbe(probe.runs)), runs: probe.runs.map(compact) } : null,
  fixed: fixed ? { source: fixed.batch, planned: fixed.planned, complete: fixed.complete,
    summary: gatesOnly(summarizeShiftingRuns(fixed.runs, probe?.runs ?? [])), runs: fixed.runs.map(compact) } : null,
  mayInterpretTopology: false, causalClaim: false,
  interpretation: 'Separate deterministic calibration, live discoverability probe and fixed-arm feasibility. No four-arm comparison has been performed.',
}
await mkdir(dirname(resolve(root, values.out)), { recursive: true })
await writeFile(resolve(root, values.out), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ output: portable(resolve(root, values.out)), context: output.context,
  calibrationSelected: output.calibration?.selected, probeComplete: probe?.complete, fixedComplete: fixed?.complete }))
