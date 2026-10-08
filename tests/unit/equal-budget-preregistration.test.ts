import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'
import { buildEqualBudgetDesign, executeEqualBudget, loadEqualBudgetDesign, validateEqualBudgetDesign, withEqualBudgetLock, type EqualBudgetDesign } from '../../experiments/equal-budget-run.ts'

const makeDesign = () => buildEqualBudgetDesign({ id: 'deepseek-v4.1-flash', name: 'fixture model', api: 'fixture', contextWindow: 128_000,
  catalogFree: false, referenceCostPerMillion: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
'2026-10-07T01:00:00.000Z', { 'fixture-source.ts': 'a'.repeat(64) }, '2026-10-07T01:01:00.000Z')

async function temporary(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'equal-budget-plan-'))
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep))
    await rm(root, { recursive: true, force: true })
  })
  return root
}

async function saveDesign(root: string, design: EqualBudgetDesign): Promise<void> {
  const encoded = JSON.stringify(design, null, 2) + '\n'
  await writeFile(join(root, 'design.json'), encoded)
  await writeFile(join(root, 'design.sha256'), createHash('sha256').update(encoded).digest('hex') + '\n')
  await writeFile(join(root, 'references.json'), JSON.stringify(design.references))
}

test('complete frozen design has exactly fourteen paired seeds and four equal-budget arms', () => {
  const design = makeDesign()
  validateEqualBudgetDesign(design)
  assert.equal(design.plannedRuns, 56)
  assert.equal(new Set(design.seeds).size, 14)
  assert.equal(new Set(design.schedule.map(row => `${row.seed}/${row.mode}`)).size, 56)
  for (const seed of design.seeds) assert.deepEqual(design.schedule.filter(row => row.seed === seed).map(row => row.mode).sort(), [...design.modes].sort())
})

test('preregistration refuses changed schedule, budget, fixture reference and model identity', () => {
  const mutations: Array<(design: EqualBudgetDesign) => void> = [
    design => { design.schedule.pop() },
    design => { design.schedule[1] = design.schedule[0] },
    design => { design.seeds[1] = design.seeds[0] },
    design => { design.plannedRuns = 1 },
    design => { design.schedule[0].seed++ },
    design => { design.allocations[0].perAgentSteps[0]-- },
    design => { design.conditions.steps = 31 },
    design => { design.conditions.maxCalls = 511 },
    design => { design.conditions.ordersPerShard = 41 },
    design => { design.conditions.shards = 7 },
    design => { design.model = 'other-model' },
    design => { design.references[0].taskSha256 = 'b'.repeat(64) },
    design => { design.references[0].seed++ },
    design => { design.references[0].passed = false },
    design => { design.references[0].arms[0].entrySteps = 1 },
  ]
  for (const mutate of mutations) {
    const design = makeDesign(); mutate(design)
    assert.throws(() => validateEqualBudgetDesign(design), /validation failed/)
  }
})

test('saved design digest and separate reference artifact are checked before execution', async t => {
  const root = await temporary(t), design = makeDesign()
  await saveDesign(root, design)
  assert.deepEqual(await loadEqualBudgetDesign(root), design)
  await writeFile(join(root, 'design.json'), (await readFile(join(root, 'design.json'), 'utf8')) + ' ')
  await assert.rejects(loadEqualBudgetDesign(root), /digest mismatch/)
  await saveDesign(root, design)
  await writeFile(join(root, 'references.json'), '[]')
  await assert.rejects(loadEqualBudgetDesign(root), /reference record mismatch/)
})

test('changed source stops execution before any attempt or adapter call and releases the batch lock', async t => {
  const root = await temporary(t)
  await saveDesign(root, makeDesign())
  await assert.rejects(executeEqualBudget(root), /Frozen source gate mismatch/)
  await assert.rejects(readFile(join(root, 'runs', 'single-seed-2026100701', 'attempt.json')), /ENOENT/)
  await assert.rejects(readFile(join(root, 'execute.lock')), /ENOENT/)
})

test('exclusive execution lock refuses simultaneous launches and survives an interrupted owner', async t => {
  const root = await temporary(t)
  let release!: () => void, entered!: () => void
  const ready = new Promise<void>(resolveReady => { entered = resolveReady })
  const running = withEqualBudgetLock(root, async () => { entered(); await new Promise<void>(resolveRelease => { release = resolveRelease }); return 42 })
  await ready
  let secondStarted = false
  await assert.rejects(withEqualBudgetLock(root, async () => { secondStarted = true }), /execution is locked/)
  assert.equal(secondStarted, false)
  release(); assert.equal(await running, 42)
  assert.equal(await withEqualBudgetLock(root, async () => 7), 7)
  await writeFile(join(root, 'execute.lock'), JSON.stringify({ pid: -1, token: 'crashed-owner' }))
  await assert.rejects(withEqualBudgetLock(root, async () => undefined), /confirm the prior process has exited/)
  assert.equal(JSON.parse(await readFile(join(root, 'execute.lock'), 'utf8')).token, 'crashed-owner')
})

test('failed execution releases its own lock, but never deletes a replaced lock', async t => {
  const root = await temporary(t)
  await assert.rejects(withEqualBudgetLock(root, async () => { throw new Error('fixture failure') }), /fixture failure/)
  assert.equal(await withEqualBudgetLock(root, async () => 'resumed'), 'resumed')
  await withEqualBudgetLock(root, async () => { await writeFile(join(root, 'execute.lock'), JSON.stringify({ token: 'replacement-owner' })) })
  assert.equal(JSON.parse(await readFile(join(root, 'execute.lock'), 'utf8')).token, 'replacement-owner')
})
