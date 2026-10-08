import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { EQUAL_BUDGET_MODES, EQUAL_BUDGET_V3_MODES, equalBudgetAllocations } from '../../experiments/equal-budget.ts'
import { buildEqualBudgetDesign, executeEqualBudget, loadEqualBudgetDesign, requireEqualBudgetModelCatalog, validateEqualBudgetDesign } from '../../experiments/equal-budget-run.ts'
import { assessEqualBudgetPreflight } from '../../experiments/equal-budget-preflight.ts'
import { EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION, getEqualBudgetTask, renderEqualBudgetPrompt } from '../../experiments/equal-budget-task.ts'
import { checkEqualBudgetModelCatalog } from '../../experiments/provider.ts'
import type { EqualBudgetRunObservation } from '../../experiments/equal-budget-statistics.ts'

const model = { id: 'deepseek-v4.1-flash', name: 'fixture model', api: 'fixture', contextWindow: 128_000,
  catalogFree: false, referenceCostPerMillion: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }
const makeDesign = () => buildEqualBudgetDesign(model, '2026-10-08T01:00:00.000Z',
  { 'fixture-source.ts': 'a'.repeat(64) }, '2026-10-08T01:01:00.000Z', { round: 11 })
const digest = (text: string) => createHash('sha256').update(text).digest('hex')

async function temporary(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'equal-budget-v3-'))
  t.after(async () => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true }) })
  return root
}

async function saveDesign(root: string, design: ReturnType<typeof makeDesign>) {
  const encoded = JSON.stringify(design, null, 2) + '\n'
  await writeFile(join(root, 'design.json'), encoded)
  await writeFile(join(root, 'design.sha256'), digest(encoded))
  await writeFile(join(root, 'references.json'), JSON.stringify(design.references))
  await mkdir(join(root, 'prompts'))
  for (const prompt of design.scaffoldPrompt!.prompts) await writeFile(join(root, prompt.path), prompt.text)
}

function observations(design = makeDesign()): EqualBudgetRunObservation[] {
  return design.schedule.slice(0, design.preflight!.requiredRuns).map(({ mode, seed }) => ({
    runId: `${mode}-${seed}`, mode, seed, model: design.model, execution: 'live-provider', causalClaim: false,
    startedAt: 1, completedAt: 2, allocation: design.allocations.find(row => row.mode === mode)!,
    evaluation: { passed: false }, stopReason: 'quiescent-without-submission', issuedModelCalls: 1,
    totalAgents: 1, entrySteps: 1, protocolInteractions: 0, protocolTransferBytes: 0, factFlowAudit: { passed: true },
    metrics: { totals: { attempts: 1, settledAttempts: 1, inFlight: 0, errors: 0, aborted: 0, incomplete: 0,
      modelDurationMs: 1, toolsStarted: 0, toolsFinished: 0, toolErrors: 0, toolDurationMs: 0,
      tokens: Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']
        .map(key => [key, { known: 0, unknownCalls: 1 }])),
      cost: { amount: null, knownAmount: 0, unknownCalls: 1, currency: null } },
    callCosts: [{ call: 'call-1', session: 'session-1', systemPromptBytes: 0, toolSchemaBytes: 0,
      fixedContextBytes: 0, inputTokens: null, outputTokens: 8192, finishReason: 'max-tokens' }],
    } as NonNullable<EqualBudgetRunObservation['metrics']>,
  }))
}

test('V3 registers fourteen paired seeds, five equal allocations and exactly two feasibility gates', () => {
  const design = makeDesign()
  validateEqualBudgetDesign(design)
  assert.equal(design.version, 3)
  assert.equal(design.round, 11)
  assert.equal(design.plannedRuns, 70)
  assert.equal(design.finalRound, true)
  assert.equal(design.causalClaim, false)
  assert.deepEqual(design.modes, EQUAL_BUDGET_V3_MODES)
  assert.deepEqual(design.seeds, Array.from({ length: 14 }, (_, index) => 2026100801 + index))
  assert.equal(new Set(design.schedule.map(row => `${row.seed}/${row.mode}`)).size, 70)
  for (const seed of design.seeds) assert.deepEqual(design.schedule.filter(row => row.seed === seed).map(row => row.mode).sort(), [...design.modes].sort())
  assert.deepEqual(design.allocations.map(row => row.totalSteps), [512, 512, 512, 512, 512])
  assert.deepEqual(design.allocations.slice(0, 2).map(({ mode: _mode, ...allocation }) => allocation),
    [{ agents: 1, perAgentSteps: [512], totalSteps: 512 }, { agents: 1, perAgentSteps: [512], totalSteps: 512 }])
  assert.equal(design.conditions.shards, 16)
  assert.equal(design.conditions.ordersPerShard, 10)
  assert.equal(design.conditions.maxOutputTokens, 8192)
  assert.deepEqual(design.preflight!.gates, ['at-least-one-exact-completion', 'positive-matching-real-model-calls'])
  assert.equal(design.preflight!.requiredRuns, 15)
  assert.equal('minOutputHeadroom' in design.preflight!, false)
  assert.equal('widespreadTruncationRunFraction' in design.preflight!, false)
  assert.equal(design.interpretations!.length, 3)
  assert.ok(design.references.every(reference => reference.passed && reference.arms.length === 5 && reference.issuedModelCalls === 0))
  assert.throws(() => buildEqualBudgetDesign(model, design.catalogCheckedAt, design.sourceHashes, design.frozenAt, { round: 11, ordersPerShard: 8 }), /exactly 10/)
  assert.deepEqual(equalBudgetAllocations(16, 32).map(row => row.mode), EQUAL_BUDGET_MODES, 'legacy default is unchanged')
})

test('V1 and both V2 frozen designs still validate without rewriting historical artifacts', async () => {
  for (const name of ['equal-budget-design-20261007.json', 'equal-budget-design-v2-20261007.json', 'equal-budget-design-v2-units10-20261007.json']) {
    const design = JSON.parse(await readFile(join('experiments', 'results', name), 'utf8'))
    validateEqualBudgetDesign(design)
    assert.deepEqual(design.modes, EQUAL_BUDGET_MODES)
    assert.equal(design.plannedRuns, 56)
  }
})

test('V3 preserves exact complete prompt text and hash for all seeds; mutation is rejected before execution', async t => {
  const design = makeDesign(), root = await temporary(t)
  assert.equal(design.scaffoldPrompt!.instruction, EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION)
  assert.equal(design.scaffoldPrompt!.prompts.length, 14)
  for (const prompt of design.scaffoldPrompt!.prompts) {
    const single = renderEqualBudgetPrompt(getEqualBudgetTask(prompt.seed, 16, { ordersPerShard: 10, compactAnswer: true }))
    assert.equal(prompt.text, `${single}\n\n${EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION}`)
    assert.equal(prompt.sha256, digest(prompt.text))
  }
  await saveDesign(root, design)
  assert.deepEqual(await loadEqualBudgetDesign(root), design)
  await assert.rejects(executeEqualBudget(root), /Frozen source gate mismatch/)
  assert.ok(!(await readdir(root)).some(name => name.startsWith('catalog-')), 'changed source cannot start catalog check or inference')
  const first = design.scaffoldPrompt!.prompts[0]
  await writeFile(join(root, first.path), `${first.text}\nchanged`)
  await assert.rejects(loadEqualBudgetDesign(root), /Frozen single-scaffolded prompt mismatch/)
  const changed = structuredClone(design)
  changed.scaffoldPrompt!.prompts[0].text += ' changed'
  changed.scaffoldPrompt!.prompts[0].sha256 = digest(changed.scaffoldPrompt!.prompts[0].text)
  assert.throws(() => validateEqualBudgetDesign(changed), /validation failed/)
  const fewerSeeds = structuredClone(design)
  fewerSeeds.seeds.pop()
  assert.throws(() => validateEqualBudgetDesign(fewerSeeds), /validation failed/)
})

test('V3 widespread truncation, zero headroom and missing audit/output coverage remain report-only', () => {
  const design = makeDesign(), runs = observations(design)
  runs[0].evaluation.passed = true
  runs[0].stopReason = 'submitted'
  const truncated = assessEqualBudgetPreflight(runs, design)
  assert.equal(truncated.mainBatchAllowed, true)
  assert.equal(truncated.status, 'passed')
  assert.equal(truncated.output.truncatedCalls, 15)
  assert.equal(truncated.output.truncatedRuns, 15)
  assert.equal(truncated.output.completedHeadroomFraction, 0)
  for (const run of runs) { run.factFlowAudit = undefined; run.metrics!.callCosts = [] }
  const unknown = assessEqualBudgetPreflight(runs, design)
  assert.equal(unknown.mainBatchAllowed, true)
  assert.equal(unknown.integrity, false)
  assert.equal(unknown.output.maximumOutputTokens, null)
  assert.equal(unknown.output.headroomFraction, null)
  assert.equal(unknown.output.completedHeadroomFraction, null)
  assert.equal(unknown.output.outputCoverageComplete, false)
  assert.ok(unknown.perArm.every(arm => arm.runs.every(run => run.missingCalls === 1 && run.maximumOutputTokens === null)))
  const audit = unknown.perArm[0] as typeof unknown.perArm[0] & { audit: { unknownAuditRuns: number; failedAuditRuns: number } }
  assert.equal(audit.audit.unknownAuditRuns, 3)
  assert.equal(audit.audit.failedAuditRuns, 0)
  for (const run of runs) run.factFlowAudit = { passed: false, unknown: true }
  const fallback = assessEqualBudgetPreflight(runs, design)
  assert.equal(fallback.mainBatchAllowed, true)
  const fallbackAudit = fallback.perArm[0] as typeof fallback.perArm[0] & { audit: { unknownAuditRuns: number; failedAuditRuns: number } }
  assert.equal(fallbackAudit.audit.unknownAuditRuns, 3)
  assert.equal(fallbackAudit.audit.failedAuditRuns, 0)
})

test('V3 keeps zero-call, unknown and mismatching dispatch attempts in denominator and prevents main batch', () => {
  const design = makeDesign(), runs = observations(design)
  runs[0].evaluation.passed = true
  runs[1].issuedModelCalls = 0
  Object.assign(runs[1].metrics!.totals, { attempts: 0, settledAttempts: 0 })
  runs[1].metrics!.callCosts = []
  const zero = assessEqualBudgetPreflight(runs, design)
  assert.equal(zero.observedRuns, 15)
  assert.equal(zero.passedRuns, 1)
  assert.equal(zero.mainBatchAllowed, false)
  assert.equal(zero.status, 'blocked-real-model-coverage')
  assert.equal(zero.liveCoverage.zeroCallRuns, 1)
  assert.equal(zero.liveCoverage.dispatchedRuns, 14)
  assert.match(zero.diagnosis.reason, /not model reasoning failures/)
  for (const issued of [null, 1, 1.5, -1]) {
    runs[1].issuedModelCalls = issued
    const gate = assessEqualBudgetPreflight(runs, design)
    assert.equal(gate.mainBatchAllowed, false)
    assert.equal(gate.liveCoverage.unknownDispatchRuns, 1)
  }
  runs[1].issuedModelCalls = 1
  Object.assign(runs[1].metrics!.totals, { attempts: 1, settledAttempts: 1 })
  assert.equal(assessEqualBudgetPreflight(runs, design).mainBatchAllowed, true)
})

test('V3 partial preflight stays pending and zero-completion final round stops without outcome adjustment', () => {
  const design = makeDesign(), runs = observations(design)
  assert.equal(assessEqualBudgetPreflight(runs.slice(0, 14), design).status, 'pending')
  const gate = assessEqualBudgetPreflight(runs, design)
  assert.equal(gate.status, 'stopped-zero-completion')
  assert.equal(gate.mainBatchAllowed, false)
  assert.equal(gate.researchLineTerminated, true)
  assert.match(gate.diagnosis.reason, /without a twelfth round or a smaller task/)
  runs[0] = runs[1]
  assert.throws(() => assessEqualBudgetPreflight(runs, design), /Invalid round-11 preflight schedule/)
})

test('V3 unavailable catalog is persisted as infrastructure before any run is started', async t => {
  const root = await temporary(t)
  await assert.rejects(requireEqualBudgetModelCatalog(root, 'prepare', path => checkEqualBudgetModelCatalog(path, async () => ({
    checkedAt: '2026-10-08T01:00:00.000Z', provider: 'fixture', models: [],
  }))), /stopped for infrastructure/)
  const files = await readdir(root)
  assert.ok(files.includes('catalog-prepare.json'))
  assert.ok(files.some(file => file.startsWith('infrastructure-prepare-')))
  assert.equal(files.includes('runs'), false)
  const record = JSON.parse(await readFile(join(root, 'catalog-prepare.json'), 'utf8'))
  assert.equal(record.status, 'unavailable')
  assert.equal(record.issuedModelCalls, 0)
  const checked = await requireEqualBudgetModelCatalog(root, 'execute', path => checkEqualBudgetModelCatalog(path, async () => ({
    checkedAt: '2026-10-08T01:00:00.000Z', provider: 'fixture', models: [model],
  })))
  assert.equal(checked.models[0].id, model.id)
  assert.equal((await readdir(root)).filter(file => file.startsWith('catalog-execute-')).length, 1)
})
