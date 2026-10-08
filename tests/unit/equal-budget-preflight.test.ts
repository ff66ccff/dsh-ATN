import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { assessEqualBudgetPreflight } from '../../experiments/equal-budget-preflight.ts'
import { buildEqualBudgetDesign, equalBudgetSourceHashes, executeEqualBudget, validateEqualBudgetDesign } from '../../experiments/equal-budget-run.ts'
import type { EqualBudgetRunObservation } from '../../experiments/equal-budget-statistics.ts'

const makeDesign = (hashes = { 'fixture.ts': 'a'.repeat(64) }) => buildEqualBudgetDesign({ id: 'deepseek-v4.1-flash', name: 'fixture', api: 'fixture', catalogFree: false,
  contextWindow: 1_000_000, referenceCostPerMillion: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
'2026-10-07T00:00:00Z', hashes, '2026-10-07T00:01:00Z', { round: 10, ordersPerShard: 10 })
type Design = ReturnType<typeof makeDesign>
function observations(design: Design): EqualBudgetRunObservation[] {
  const totals = { attempts: 1, settledAttempts: 1, inFlight: 0, errors: 0, aborted: 0, incomplete: 0,
    modelDurationMs: 1, toolsStarted: 1, toolsFinished: 1, toolErrors: 0, toolDurationMs: 1,
    tokens: Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens'].map(key => [key, { known: 100, unknownCalls: 0 }])),
    cost: { amount: null, knownAmount: 0, unknownCalls: 1, currency: null } }
  return design.schedule.slice(0, 12).map(({ mode, seed }) => ({ runId: `${mode}-${seed}`, mode, seed,
    model: design.model, execution: 'live-provider', causalClaim: false, startedAt: 1, completedAt: 2,
    allocation: design.allocations.find(row => row.mode === mode)!, evaluation: { passed: false },
    stopReason: 'quiescent-without-submission', issuedModelCalls: 1, totalAgents: 1, entrySteps: 1,
    protocolInteractions: 0, protocolTransferBytes: 0, factFlowAudit: { passed: true },
    metrics: { totals: structuredClone(totals), callCosts: [{ call: 'call-1', session: 'session-1',
      systemPromptBytes: 0, toolSchemaBytes: 0, fixedContextBytes: 0, inputTokens: 100, outputTokens: 8192, finishReason: 'max-tokens' }],
    } as NonNullable<EqualBudgetRunObservation['metrics']> }))
}

test('round 10 freezes equal 512 allocation,16 shards,first 12 live checks and compact fixture', () => {
  const design = makeDesign(); validateEqualBudgetDesign(design)
  assert.equal(design.conditions.shards, 16)
  assert.equal(design.conditions.ordersPerShard, 10)
  assert.equal(design.conditions.compactAnswer, true)
  assert.ok(design.allocations.every(row => row.totalSteps === 512))
  assert.equal(design.preflight!.requiredRuns, 12)
  assert.ok(design.references.every(row => row.passed && row.issuedModelCalls === 0))
  design.preflight!.minOutputHeadroom = 0.01
  assert.throws(() => validateEqualBudgetDesign(design), /validation failed/)
})

test('zero live completions with widespread output truncation terminates the research line', () => {
  const design = makeDesign(), runs = observations(design), gate = assessEqualBudgetPreflight(runs, design)
  assert.equal(gate.status, 'stopped-zero-completion')
  assert.equal(gate.researchLineTerminated, true)
  assert.equal(gate.mainBatchAllowed, false)
  assert.equal(gate.output.truncatedCalls, 12)
  assert.equal(gate.diagnosis.category, 'single-call-output-budget')
  assert.equal(assessEqualBudgetPreflight(runs.slice(0, 11), design).status, 'pending')
})

test('live feasibility uses completed maximum, retains isolated failed truncation, and does not impose success-rate threshold', () => {
  const design = makeDesign(), runs = observations(design)
  for (const run of runs) Object.assign(run.metrics!.callCosts[0], { outputTokens: 4000, finishReason: 'stop' })
  runs[0].evaluation.passed = true; runs[0].stopReason = 'submitted'
  Object.assign(runs[1].metrics!.callCosts[0], { outputTokens: 8192, finishReason: 'length' })
  const gate = assessEqualBudgetPreflight(runs, design)
  assert.equal(gate.status, 'passed')
  assert.equal(gate.passedRuns, 1)
  assert.equal(gate.output.maximumOutputTokens, 8192)
  assert.equal(gate.output.completedMaximumOutputTokens, 4000)
  assert.ok(gate.output.completedHeadroomFraction! >= 0.4)
  runs[0].metrics!.callCosts[0].outputTokens = 5000
  assert.equal(assessEqualBudgetPreflight(runs, design).status, 'blocked-output-headroom')
  runs[0].metrics!.callCosts[0].outputTokens = null
  assert.equal(assessEqualBudgetPreflight(runs, design).status, 'blocked-incomplete-telemetry')
})

test('widespread truncation, duplicates, non-live runs and audit failure cannot admit main batch', () => {
  const design = makeDesign(), runs = observations(design)
  runs[0].evaluation.passed = true
  assert.equal(assessEqualBudgetPreflight(runs, design).status, 'blocked-truncation')
  for (const run of runs) Object.assign(run.metrics!.callCosts[0], { outputTokens: 100, finishReason: 'stop' })
  runs[0].execution = 'scripted-adapter'
  assert.equal(assessEqualBudgetPreflight(runs, design).mainBatchAllowed, false)
  assert.equal(assessEqualBudgetPreflight(runs, design).status, 'blocked-real-model-coverage')
  runs[0].execution = 'live-provider'; runs[0].factFlowAudit!.passed = false
  assert.equal(assessEqualBudgetPreflight(runs, design).status, 'blocked-integrity')
  runs[0] = runs[1]
  assert.equal(assessEqualBudgetPreflight(runs, design).status, 'blocked-integrity')
})

test('zero adapter dispatch cannot count as a live preflight run or terminate research as a model failure', () => {
  const design = makeDesign(), runs = observations(design)
  for (const run of runs) Object.assign(run.metrics!.callCosts[0], { outputTokens: 100, finishReason: 'stop' })
  runs[0].evaluation.passed = true
  runs[0].stopReason = 'submitted'
  runs[1].issuedModelCalls = 0
  Object.assign(runs[1].metrics!.totals, { attempts: 0, settledAttempts: 0 })
  runs[1].metrics!.callCosts = []
  const gate = assessEqualBudgetPreflight(runs, design)
  assert.equal(gate.observedRuns, 12)
  assert.equal(gate.liveCoverage.dispatchedRuns, 11)
  assert.equal(gate.liveCoverage.zeroCallRuns, 1)
  assert.equal(gate.mainBatchAllowed, false)
  assert.equal(gate.status, 'blocked-real-model-coverage')
  runs[0].evaluation.passed = false
  assert.equal(assessEqualBudgetPreflight(runs, design).researchLineTerminated, false)
  runs[1].issuedModelCalls = null; runs[1].metrics = null
  assert.equal(assessEqualBudgetPreflight(runs, design).liveCoverage.unknownDispatchRuns, 1)
})

test('resume recomputes rejected gate from 12 verified samples, never starts row13 or retries failures', async t => {
  const root = await mkdtemp(join(tmpdir(), 'equal-budget-v2-gate-'))
  t.after(async () => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true }) })
  const design = makeDesign(await equalBudgetSourceHashes()), runs = observations(design)
  const digest = (value: string) => createHash('sha256').update(value).digest('hex')
  const encoded = JSON.stringify(design)
  await writeFile(join(root, 'design.json'), encoded)
  await writeFile(join(root, 'design.sha256'), digest(encoded))
  await writeFile(join(root, 'references.json'), JSON.stringify(design.references))
  for (const run of runs) {
    const directory = join(root, 'runs', `${run.mode}-seed-${run.seed}`)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'attempt.json'), JSON.stringify({ seed: run.seed, mode: run.mode, designSha256: digest(encoded),
      taskSha256: design.references.find(row => row.seed === run.seed)!.taskSha256, sourceHashes: design.sourceHashes, startedAt: 1 }))
    const report = JSON.stringify(run)
    await writeFile(join(directory, 'report.json'), report)
    await writeFile(join(directory, 'report.sha256'), digest(report))
  }
  await writeFile(join(root, 'preflight.json'), JSON.stringify({ mainBatchAllowed: true }))
  assert.equal((await executeEqualBudget(root)).length, 12)
  const gate = JSON.parse(await readFile(join(root, 'preflight.json'), 'utf8'))
  assert.equal(gate.researchLineTerminated, true)
  assert.equal((await executeEqualBudget(root)).length, 12)
  const row13 = design.schedule[12]
  await assert.rejects(readFile(join(root, 'runs', `${row13.mode}-seed-${row13.seed}`, 'attempt.json')), /ENOENT/)
  assert.equal(JSON.parse(await readFile(join(root, 'batch.json'), 'utf8')).completed.length, 12)
})
