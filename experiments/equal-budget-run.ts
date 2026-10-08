/** Frozen paired schedules. All exceptions and interrupted attempts remain in the denominator. */
import { mkdir, readFile, writeFile, readdir, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { assertAllowedPilotModel, checkEqualBudgetModelCatalog, discoverPilotModels, type PilotModel } from './provider.ts'
import { EQUAL_BUDGET_MODES, EQUAL_BUDGET_V3_MODES, equalBudgetAllocations } from './equal-budget.ts'
import { EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION, getEqualBudgetTask, renderEqualBudgetSingleScaffoldedPrompt, verifyEqualBudgetSolvability } from './equal-budget-task.ts'
import { runPilot } from './run.ts'
import { assessEqualBudgetPreflight } from './equal-budget-preflight.ts'
import type { EqualBudgetRunObservation } from './equal-budget-statistics.ts'

export async function equalBudgetSourceHashes() {
  const files: string[] = ['package.json', 'package-lock.json']
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory() && entry.name !== 'results') await walk(path)
      else if (entry.isFile() && /\.(?:ts|mjs)$/.test(path)) files.push(path)
    }
  }
  await walk('src'); await walk('experiments'); await walk('scripts')
  return Object.fromEntries(await Promise.all(files.sort().map(async file =>
    [file, createHash('sha256').update(await readFile(file)).digest('hex')])) )
}

/** Pure preregistration construction also supports no-network integrity tests. */
export function buildEqualBudgetDesign(model: PilotModel, catalogCheckedAt: string, sourceHashes: Record<string, string>, frozenAt = new Date().toISOString(), options: { round?: 9 | 10 | 11; ordersPerShard?: number } = {}) {
  const v3 = options.round === 11, v2 = options.round === 10 || v3
  const ordersPerShard = v2 ? options.ordersPerShard ?? 10 : 40
  if (v3 && ordersPerShard !== 10) throw new Error('Round 11 requires exactly 10 orders per shard')
  if (v2 && ![8, 10, 12].includes(ordersPerShard)) throw new Error('Round 10 ordersPerShard must be 8, 10 or 12')
  const agents = 16, steps = 32, seeds = Array.from({ length: 14 }, (_, index) => (v3 ? 2026100801 : 2026100701) + index)
  const modes = [...(v3 ? EQUAL_BUDGET_V3_MODES : EQUAL_BUDGET_MODES)]
  const allocations = equalBudgetAllocations(agents, steps, modes)
  assertAllowedPilotModel(model)
  if (model.id !== 'deepseek-v4.1-flash') throw new Error('Preregistered DeepSeek model absent from live catalog')
  const references = seeds.map(seed => {
    const task = getEqualBudgetTask(seed, v2 ? 16 : 8, v2 ? { ordersPerShard, compactAnswer: true } : {})
    return { taskSha256: createHash('sha256').update(JSON.stringify(task)).digest('hex'),
      ...verifyEqualBudgetSolvability(task, allocations.map(row => ({ mode: row.mode, agents: row.agents, entrySteps: row.perAgentSteps[0] })), { documentReadsPerStep: v2 ? 2 : 1, ...(v3 ? { modes } : {}) }) }
  })
  if (references.some(row => !row.passed || row.issuedModelCalls !== 0)) throw new Error('Every seed and arm must pass the constructive gate')
  const design = {
    version: v3 ? 3 : v2 ? 2 : 1, frozenAt, model: model.id, modelMetadata: model, catalogCheckedAt,
    ...(v2 ? { round: v3 ? 11 : 10, studyScope: v3 ? 'prompt decomposition versus distributed structure under equal visible-call budgets' : 'coordination overhead versus parallelism; not context pressure',
      preflight: v3 ? { seeds: seeds.slice(0, 3), seedsRequired: 3, requiredRuns: 15,
        gates: ['at-least-one-exact-completion', 'positive-matching-real-model-calls'], retainedInFinalReport: true,
        zeroCompletionPolicy: 'stop before main batch; round 11 closes this research line regardless of outcome',
        adjustmentPolicy: 'No outcome-dependent task, budget, arm or seed changes; no twelfth round.' }
      : { seeds: seeds.slice(0, 3), seedsRequired: 3, requiredRuns: 12, minOutputHeadroom: 0.4,
        widespreadTruncationRunFraction: 0.25, retainedInFinalReport: true,
        zeroCompletionPolicy: 'stop before main batch; terminate research line when output budget or observed decomposition failure remains the bottleneck',
        adjustmentPolicy: 'Only after a nonzero-completion preflight with widespread truncation, a smaller 8..12 unit size may be separately preregistered; retain all cohorts. Never adjust after output/decomposition zero-completion termination.' } } : {}),
    modelContextLimit: model.contextWindow ?? null, modes, seeds, allocations,
    conditions: { agents, steps, shards: v2 ? 16 : 8, ordersPerShard, ...(v2 ? { compactAnswer: true } : {}), maxCalls: agents * steps,
      maxOutputTokens: 8192, observedTokenLimit: 8_000_000, timeoutMs: 600_000 },
    plannedRuns: seeds.length * modes.length,
    schedule: seeds.flatMap((seed, index) => modes.map((_, offset) => ({ seed, mode: modes[(index + offset) % modes.length]! }))),
    sourceHashes, references,
    executionOrder: 'sequential paired seed blocks; rotate arm order by seed; no outcome-dependent retries',
    seedMeaning: 'fixture seed, not a provider sampling seed; stochastic model sampling is not controlled',
    rationale: v3 ? 'Sixteen ledger shards with 10 orders each, fourteen paired seeds and 512 visible model calls per arm. The added single-scaffolded control differs from single only by its appended per-shard decomposition instruction. This final round isolates the previously confounded prompt structure comparison; truncation, headroom and audit gaps remain reported observations.' : v2 ? `Sixteen independent ledger shards with ${ordersPerShard} orders each; initial unit size is a feasibility candidate, not a validated choice. Existing parallel document tool calls allow 49 reads in 25 steps plus submission and ATN startup (27); this constructive check does not replace the 12 live-model runs. The 512 total visible-call budget is unchanged.` : 'Eight independent ledger shards with 40 orders each; S=32 covers 25 serial document reads plus submission and, for ATN, one network-start step (27 steps). N=16 as suggested by the brief. No outcome-based task or budget tuning.',
    documentAccess: 'identical public index and read_document access; no topology binding; forwarding permitted',
    independentPool: v2 ? '15 independent candidates each assigned one of shards 1..15; the 32-step synthesis entry owns shard 16 and merges all candidates; no peer communication, no oracle selection; all 16 allocations count' : '15 independent local candidates assigned shards cyclically plus one 32-step synthesis entry; no peer communication, no oracle selection; all 16 allocations count',
    statistics: { correctness: v3 ? 'Wilson 95%; paired Tango score 95% and exact McNemar; Holm across ten pairs' : 'Wilson 95%; paired Tango score 95% and exact McNemar; Holm across six pairs',
      continuous: v3 ? 'median, linear-interpolated Q1/Q3, distribution-free order-statistic 95% median CI; paired median differences and sign tests, Holm across ten pairs per metric' : 'median, linear-interpolated Q1/Q3, distribution-free order-statistic 95% median CI; paired median differences and sign tests, Holm across six pairs per metric',
      unknownUsage: 'null remains unknown; report known lower bounds and coverage separately',
      workloadGate: v3 ? 'Only two live feasibility gates: at least one exact completion; every attempted preflight run has positive integer issuedModelCalls equal to metrics.totals.attempts. Truncation, output headroom and audit gaps are report-only. Zero-call attempts remain in the denominator and are infrastructure evidence, not model reasoning failures.' : v2 ? 'Live preflight: at least one exact completion, truncation in fewer than 25% of all runs, complete per-call output telemetry for all runs and >=40% headroom for the maximum call across exact-completion witnesses. Also report the all-run output maximum and every truncation. This is feasibility, not a statistical success-rate threshold.' : 'single peak input >= 50% of catalog context window; missing or smaller observations cannot support an adequate-scale claim',
      power: 'n=14 is the brief minimum, not a guarantee of statistical power or equivalence' },
    failurePolicy: 'Every started attempt is retained, including timeout, exception, interruption, wrong answer and unknown usage. Never replace a failed sample.',
    causalClaim: false, benefitClaim: 'not-claimed',
    ...(v3 ? { finalRound: true, scaffoldPrompt: { instruction: EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION,
      prompts: seeds.map(seed => { const text = renderEqualBudgetSingleScaffoldedPrompt(getEqualBudgetTask(seed, 16, { ordersPerShard: 10, compactAnswer: true }))
        return { seed, path: `prompts/single-scaffolded-seed-${seed}.txt`, text, sha256: createHash('sha256').update(text).digest('hex') } }) },
      interpretations: [
        { id: 'prompt-structure', observation: 'single-scaffolded indistinguishable from all three distributed arms', interpretation: 'The round-10 signal is consistent with prompt structure; no independent ATN contribution is established. Failure to distinguish does not prove equivalence.' },
        { id: 'distributed-structure', observation: 'single-scaffolded indistinguishable from single, and both below all three distributed arms', interpretation: 'Decomposition instruction alone is insufficient; intervals support a separate contribution from distributed structure in this tested setting.' },
        { id: 'mixed-instruction-and-structure', observation: 'single-scaffolded above single but below all three distributed arms', interpretation: 'Intervals support contributions from both decomposition instructions and distributed structure in this tested setting.' },
      ] } : {}),
  }
  return design
}

export type EqualBudgetDesign = ReturnType<typeof buildEqualBudgetDesign>
const digest = (text: string): string => createHash('sha256').update(text).digest('hex')

/** Check the complete schedule, all fixtures, all four allocations, and the fixed design. */
export function validateEqualBudgetDesign(value: unknown): asserts value is EqualBudgetDesign {
  try {
    const design = value as EqualBudgetDesign
    if (!design || typeof design !== 'object' || !Number.isFinite(Date.parse(design.frozenAt)) || !Number.isFinite(Date.parse(design.catalogCheckedAt)) ||
      !design.sourceHashes || Array.isArray(design.sourceHashes) || !Object.keys(design.sourceHashes).length ||
      !Object.entries(design.sourceHashes).every(([path, hash]) => typeof path === 'string' && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid preregistration metadata')
    const expected = buildEqualBudgetDesign(design.modelMetadata, design.catalogCheckedAt, design.sourceHashes, design.frozenAt,
      design.version === 3 ? { round: 11, ordersPerShard: design.conditions.ordersPerShard } : design.version === 2 ? { round: 10, ordersPerShard: design.conditions.ordersPerShard } : {})
    // The originally frozen V1 schema predates the explicit read-width field. Its implicit width
    // is exactly one; accept that complete legacy schema without weakening the constructive check.
    if (design.version === 1 && design.references.every(reference => !Object.hasOwn(reference, 'documentReadsPerStep') &&
      reference.arms.every(arm => !Object.hasOwn(arm, 'documentReadsPerStep')))) {
      for (const reference of expected.references) {
        Reflect.deleteProperty(reference, 'documentReadsPerStep')
        for (const arm of reference.arms) Reflect.deleteProperty(arm, 'documentReadsPerStep')
      }
    }
    if (!isDeepStrictEqual(design, expected)) throw new Error('Preregistered schedule, budget, fixtures or conditions changed')
  } catch {
    throw new Error('Frozen equal-budget design validation failed')
  }
}

/** Refuse competing processes. A stale lock is retained for explicit inspection after a crash. */
export async function withEqualBudgetLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const lockPath = join(resolve(root), 'execute.lock'), token = randomUUID()
  try { await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now(), token }) + '\n', { flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Equal-budget execution is locked. Inspect execute.lock and confirm the prior process has exited before removing a stale lock.')
    throw error
  }
  try { return await action() }
  finally {
    // Never delete a different owner's lock if an operator replaced this file.
    const current = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: string }
    if (current.token === token) await unlink(lockPath)
  }
}

/** Read-only model discovery is a prerequisite, never an inference attempt. */
export async function requireEqualBudgetModelCatalog(root: string, phase: 'prepare' | 'execute', check = checkEqualBudgetModelCatalog) {
  const catalogPath = join(root, phase === 'prepare' ? 'catalog-prepare.json' : `catalog-execute-${Date.now()}-${randomUUID()}.json`)
  const record = await check(catalogPath)
  if (record.status !== 'available' || !record.catalog) {
    await writeFile(join(root, `infrastructure-${phase}-${Date.now()}-${randomUUID()}.json`), JSON.stringify({
      round: 11, status: 'blocked-infrastructure', phase, catalogPath, checkedAt: record.checkedAt,
      issuedModelCalls: 0, causalClaim: false, researchLineClosed: true,
      reason: 'Target model is not visible in the required live read-only catalog; no inference attempt was started.' }, null, 2) + '\n', { flag: 'wx' })
    throw new Error('Round 11 stopped for infrastructure: target model unavailable in live catalog; no model call issued')
  }
  return record.catalog
}

export async function prepareEqualBudget(root: string, ordersPerShard = 10, options: { round?: 10 | 11 } = {}) {
  const v3 = options.round === 11
  if (v3) await mkdir(root, { recursive: false })
  const catalog = v3 ? await requireEqualBudgetModelCatalog(root, 'prepare') : await discoverPilotModels()
  const model = catalog.models.find(row => row.id === 'deepseek-v4.1-flash')
  if (!model) throw new Error('Preregistered DeepSeek model absent from live catalog')
  const design = buildEqualBudgetDesign(model, catalog.checkedAt, await equalBudgetSourceHashes(), new Date().toISOString(), { round: options.round ?? 10, ordersPerShard })
  validateEqualBudgetDesign(design)
  if (!v3) await mkdir(root, { recursive: false })
  const encoded = JSON.stringify(design, null, 2) + '\n'
  await writeFile(join(root, 'design.json'), encoded, { flag: 'wx' })
  await writeFile(join(root, 'design.sha256'), digest(encoded) + '\n', { flag: 'wx' })
  await writeFile(join(root, 'references.json'), JSON.stringify(design.references, null, 2) + '\n', { flag: 'wx' })
  if (design.scaffoldPrompt) {
    await mkdir(join(root, 'prompts'))
    for (const prompt of design.scaffoldPrompt.prompts) await writeFile(join(root, prompt.path), prompt.text, { flag: 'wx' })
  }
  return design
}

export async function loadEqualBudgetDesign(root: string): Promise<EqualBudgetDesign> {
  const encoded = await readFile(join(root, 'design.json'), 'utf8')
  if (digest(encoded) !== (await readFile(join(root, 'design.sha256'), 'utf8')).trim()) throw new Error('Frozen design digest mismatch')
  const design: unknown = JSON.parse(encoded)
  validateEqualBudgetDesign(design)
  if (!isDeepStrictEqual(JSON.parse(await readFile(join(root, 'references.json'), 'utf8')), design.references)) throw new Error('Frozen reference record mismatch')
  for (const prompt of design.scaffoldPrompt?.prompts ?? []) {
    const text = await readFile(join(root, prompt.path), 'utf8')
    if (text !== prompt.text || digest(text) !== prompt.sha256) throw new Error('Frozen single-scaffolded prompt mismatch')
  }
  return design
}

async function atomicBatchWrite(root: string, content: unknown): Promise<void> {
  const temporary = join(root, `batch-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(content, null, 2) + '\n', { flag: 'wx' })
  await rename(temporary, join(root, 'batch.json'))
}

async function persistProgress(root: string, design: EqualBudgetDesign, completed: unknown[]) {
  const preflight = design.version >= 2 ? assessEqualBudgetPreflight(completed as EqualBudgetRunObservation[], design) : undefined
  if (preflight) {
    const temporary = join(root, `preflight-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(preflight, null, 2) + '\n', { flag: 'wx' })
    await rename(temporary, join(root, 'preflight.json'))
  }
  await atomicBatchWrite(root, { design: join(root, 'design.json'), planned: design.plannedRuns, completed,
    ...(preflight ? { preflight } : {}), causalClaim: false })
  return preflight
}

async function executeLocked(root: string) {
  const design = await loadEqualBudgetDesign(root)
  if (design.version === 3) {
    if (!isDeepStrictEqual(design.sourceHashes, await equalBudgetSourceHashes())) throw new Error('Frozen source gate mismatch; stopping before catalog check or inference')
    await requireEqualBudgetModelCatalog(root, 'execute')
  }
  const completed: unknown[] = []
  const runRoot = join(root, 'runs')
  await mkdir(runRoot, { recursive: true })
  for (const row of design.schedule) {
    // Recompute from verified retained trials, never trust a manually edited gate file.
    if (design.preflight && !design.preflight.seeds.includes(row.seed)) {
      const preflight = await persistProgress(root, design, completed)
      if (!preflight?.mainBatchAllowed) {
        console.log(JSON.stringify({ event: 'main-batch-blocked', status: preflight?.status,
          recorded: completed.length, mainBatchAllowed: false, researchLineTerminated: preflight?.researchLineTerminated,
          diagnosis: preflight?.diagnosis.category }))
        return completed
      }
    }
    // Recheck before every trial, including resumed trials; never mix source revisions.
    if (!isDeepStrictEqual(design.sourceHashes, await equalBudgetSourceHashes())) throw new Error('Frozen source gate mismatch; stopping before the next trial')
    const current = await loadEqualBudgetDesign(root)
    if (!isDeepStrictEqual(current, design)) throw new Error('Frozen design changed during execution')
    const directory = join(runRoot, `${row.mode}-seed-${row.seed}`)
    const allocation = design.allocations.find(arm => arm.mode === row.mode)!
    const reference = design.references.find(item => item.seed === row.seed)!
    const designSha256 = digest(JSON.stringify(design))
    const expectedAttempt = { ...row, designSha256, taskSha256: reference.taskSha256, sourceHashes: design.sourceHashes }
    let priorAttempt: ({ startedAt: number } & typeof expectedAttempt) | undefined
    try { priorAttempt = JSON.parse(await readFile(join(directory, 'attempt.json'), 'utf8')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (priorAttempt && (!Number.isSafeInteger(priorAttempt.startedAt) || priorAttempt.startedAt < 0 ||
      !isDeepStrictEqual(priorAttempt, { ...expectedAttempt, startedAt: priorAttempt.startedAt }))) throw new Error('Frozen attempt record mismatch')
    let report: unknown
    try { report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (report) {
      const existing = report as { mode: string; seed: number; model: string; allocation: unknown; execution: string }
      if (!priorAttempt || existing.mode !== row.mode || existing.seed !== row.seed || existing.model !== design.model ||
        existing.execution !== 'live-provider' || !isDeepStrictEqual(existing.allocation, allocation)) throw new Error('Existing report does not match its preregistered trial')
      const encoded = await readFile(join(directory, 'report.json'), 'utf8')
      if (digest(encoded) !== (await readFile(join(directory, 'report.sha256'), 'utf8')).trim()) throw new Error('Existing report digest mismatch')
    }
    if (!report) {
      const startedAt = priorAttempt?.startedAt ?? Date.now()
      await mkdir(directory, { recursive: true })
      if (!priorAttempt) await writeFile(join(directory, 'attempt.json'), JSON.stringify({ ...expectedAttempt, startedAt }) + '\n', { flag: 'wx' })
      try {
        if (priorAttempt) throw new Error('retained-interrupted-attempt')
        report = await runPilot({ mode: row.mode, model: design.modelMetadata, task: 'ledger-reconciliation', directory,
          maxAgents: allocation.agents, perNodeSteps: design.conditions.steps, maxCalls: allocation.totalSteps,
          maxOutputTokens: design.conditions.maxOutputTokens, observedTokenLimit: design.conditions.observedTokenLimit,
          timeoutMs: design.conditions.timeoutMs, equalBudget: { seed: row.seed, agents: design.conditions.agents, steps: design.conditions.steps,
            ...(design.version >= 2 ? { shards: design.conditions.shards, ordersPerShard: design.conditions.ordersPerShard, compactAnswer: true } : {}) } })
      } catch (error) {
        report = { ...row, runId: `${row.mode}-${row.seed}`, model: design.model, directory, execution: 'live-provider', causalClaim: false,
          startedAt, completedAt: Date.now(), evaluation: { passed: false }, allocation, metrics: null,
          issuedModelCalls: null, entrySteps: null, totalAgents: null, protocolInteractions: null, protocolTransferBytes: null,
          stopReason: priorAttempt ? 'retained-interrupted-attempt' : `host-exception:${error instanceof Error ? error.name : 'unknown'}`,
          factFlowAudit: { passed: false, unknown: true, reason: 'host exception; final audit unavailable' },
          errorRetained: true, replaced: false }
        await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
      }
      await writeFile(join(directory, 'report.sha256'), digest(await readFile(join(directory, 'report.json'), 'utf8')) + '\n', { flag: 'wx' })
    }
    completed.push({ ...(report as object), directory })
    await persistProgress(root, design, completed)
    const outcome = report as { evaluation: { passed: boolean }; issuedModelCalls: number | null; stopReason: string }
    console.log(JSON.stringify({ ...row, ...outcome.evaluation, calls: outcome.issuedModelCalls, stopReason: outcome.stopReason, recorded: completed.length, planned: design.plannedRuns }))
    if ('cleanup' in (report as object) && (report as { cleanup: string }).cleanup !== 'released') throw new Error('Cleanup did not finish; batch stopped before further inference')
  }
  return completed
}

export async function executeEqualBudget(root: string) {
  return withEqualBudgetLock(root, () => executeLocked(resolve(root)))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { prepare: { type: 'boolean' }, execute: { type: 'boolean' },
    round: { type: 'string', default: '10' }, 'orders-per-shard': { type: 'string', default: '10' }, root: { type: 'string' } } })
  if (!['10', '11'].includes(values.round)) throw new Error('--round must be 10 or 11')
  const root = resolve(values.root ?? (values.round === '11' ? '.artifacts/equal-budget/20261008-v3' : '.artifacts/equal-budget/20261007-v2'))
  process.env.DSH_HOME ??= resolve('.scratch/pilot-harness-home')
  if (values.prepare === values.execute) throw new Error('Choose exactly one of --prepare or --execute')
  await mkdir(dirname(root), { recursive: true })
  if (values.prepare) {
    const design = await prepareEqualBudget(root, Number(values['orders-per-shard']), { round: Number(values.round) as 10 | 11 })
    console.log(JSON.stringify({ root, frozenAt: design.frozenAt, plannedRuns: design.plannedRuns, totalStepsPerArm: design.conditions.maxCalls, modelContextLimit: design.modelContextLimit }))
  } else await executeEqualBudget(root)
}
