/** New admission-controlled run. Default is offline; --execute is required. */
import assert from 'node:assert/strict'
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { registerHooks } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ReasoningEffortId, resolveRetryPolicy, type GenerateOptions, type StreamChunk,
  type PreparedLlmCall } from '@deepseek-ai/dsh-llm'
import { createShiftingEvidenceTask } from '../experiments/shifting-evidence-task.ts'
import { deriveProbeLowerBound, evaluateProbeFeasibility, runAfterProbeGate, PROBE_ROUTE, type ProbeGateInput } from '../experiments/live-probe-feasibility.ts'
import { loadProbeHistory } from '../experiments/live-probe-history.ts'
import { createProbeTiming, createProbeDispatcher } from '../experiments/live-probe-timing.ts'
import { TOKEN_POLICY } from '../experiments/probe-gate-quiescence.ts'
import { runShiftingEvidence, shiftingSourceHashes, type InstalledAgyModel } from '../experiments/shifting-evidence-run.ts'

const { values } = parseArgs({ options: { execute: { type: 'boolean', default: false }, out: { type: 'string' } } })
const root = resolve(values.out ?? '.artifacts/live-probe-resumed/20261015/batch')
const oldPlan = JSON.parse(await readFile('docs/execution-evidence/agy-model-20261015/plan.json', 'utf8'))
const history = await loadProbeHistory()
const seeds: number[] = [17, 31, 45, 59, 73]
assert.deepEqual(seeds, oldPlan.seeds)
assert.equal(oldPlan.model.id, PROBE_ROUTE.model)
assert.equal(oldPlan.reasoningEffort, PROBE_ROUTE.reasoningEffort)
const conditions = { ...oldPlan.conditions, timeoutMs: 600000 }
assert.deepEqual(Object.keys(conditions).filter(key => conditions[key] !== oldPlan.conditions[key]), ['timeoutMs'])
const inputs: ProbeGateInput[] = seeds.map(seed => ({
  lowerBound: deriveProbeLowerBound(createShiftingEvidenceTask(8, seed, 2)),
  reference: { actions: 60, maxNodeActions: 8, source: 'docs/execution-evidence/agy-model-20261015/references.json; constructive policy only' },
  conditions: { agents: 8, perNodeSteps: 12, maxCalls: 96, timeoutMs: conditions.timeoutMs, concurrency: 1 },
  latency: history.latency,
  margin: { actionFactor: 1.125, nodeFactor: 1.125, overheadMs: 30000,
    rationale: '12.5% planning headroom on reference action/node counts and 30 seconds host/preparation reserve. Not sufficient for guaranteed success.' },
  schedulingRemedy: 'deadline',
}))
const gates = inputs.map(evaluateProbeFeasibility)
if (!values.execute) {
  console.log(JSON.stringify({ execute: false, route: PROBE_ROUTE, conditions, effectiveTokenPolicy: TOKEN_POLICY, gates }, null, 2))
} else {
  // No plugin loading, account access or provider mount precedes this gate.
  await runAfterProbeGate(inputs[0], async () => {
    assert(gates.every(gate => gate.admitted))
    assert(conditions.timeoutMs <= 600000, 'Do not bypass bounded runner limits')
    const sourceHashes = await shiftingSourceHashes()
    assert(isDeepStrictEqual(sourceHashes, oldPlan.sourceHashes), 'Historical source drift requires explicit review')
    await mkdir(root) // Refuse to overwrite or replace a previous batch.
    const newSources = ['scripts/run-live-probe-agy.ts', 'scripts/live-probe-feasibility.ts',
      'experiments/live-probe-feasibility.ts', 'experiments/live-probe-history.ts', 'experiments/live-probe-timing.ts',
      'tests/unit/live-probe-feasibility.test.ts', 'tests/integration/live-probe-timing.test.ts']
    const extensionHashes = Object.fromEntries(await Promise.all(newSources.map(async file => [file,
      createHash('sha256').update(await readFile(file)).digest('hex')])))
    const plan = { createdAt: new Date().toISOString(), execution: 'live-provider', purpose: 'adaptive-probe',
      route: PROBE_ROUTE, seeds, planned: seeds.length, conditions, maxConcurrentProviderStreams: 1,
      changes: { timeoutMs: { previous: 120000, current: 600000, requiredUnderPlanningAssumptions: gates[0].requiredDeadlineMs } },
      history, gates, effectiveTokenPolicy: TOKEN_POLICY, sourceHashes, extensionHashes, directHttpInference: false, causalClaim: false,
      caveat: 'Genuine evidence-causal lower bound and a separate planning margin. Not a mathematical impossibility or completion guarantee.' }
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
    console.log('AGY_RESUMED_PLAN ' + JSON.stringify({ route: PROBE_ROUTE, seeds, conditions, requiredDeadlineMs: gates[0].requiredDeadlineMs }))
    const hook = registerHooks({ resolve(specifier, context, nextResolve) {
      return nextResolve(specifier, ['@deepseek-ai/dsh-llm', '@deepseek-ai/cordis'].includes(specifier)
        ? { ...context, parentURL: pathToFileURL(resolve('package.json')).href } : context)
    } })
    process.env.DSH_HOME = resolve(homedir(), '.dsh')
    const source = new Context()
    let stopped: string | null = null, dispatches = 0, currentSeed: number | null = null
    let traceWrites = Promise.resolve()
    const trace = (event: object) => { traceWrites = traceWrites.then(() => appendFile(join(root, 'provider-calls.jsonl'), JSON.stringify(event) + '\n')) }
    const model: InstalledAgyModel = { ...oldPlan.model }
    const completed: Array<Awaited<ReturnType<typeof runShiftingEvidence>> & { directory: string }> = []
    const timingBySeed: Record<string, unknown> = {}
    const heartbeat = setInterval(() => console.log('AGY_RESUMED_PROGRESS ' + JSON.stringify({ seed: currentSeed,
      completed: completed.length, providerDispatches: dispatches, at: new Date().toISOString() })), 30000)
    heartbeat.unref()
    try {
      const directory = resolve(homedir(), '.dsh/profiles/desktop/node_modules/dsh-agy')
      const plugin = await import(pathToFileURL(join(directory, 'lib/index.mjs')).href)
      const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
      assert.equal(pkg.version, '0.4.4')
      await source.plugin(LlmRuntime); await source.plugin(plugin)
      const info = await source.llm.resolveModelInfo('agy', model.id)
      assert(info.reasoning?.efforts.some(row => row.id === 'medium'))
      await writeFile(join(root, 'discovery.json'), JSON.stringify({ ...PROBE_ROUTE, plugin: 'dsh-agy', pluginVersion: pkg.version,
        name: info.name, reasoning: info.reasoning,
        pluginEntrySha256: createHash('sha256').update(await readFile(join(directory, 'lib/index.mjs'))).digest('hex') }, null, 2) + '\n')
      for (const [index, seed] of seeds.entries()) {
        currentSeed = seed
        assert(isDeepStrictEqual(sourceHashes, await shiftingSourceHashes()), 'Source drift before seed')
        const currentExtension = Object.fromEntries(await Promise.all(newSources.map(async file => [file,
          createHash('sha256').update(await readFile(file)).digest('hex')])))
        assert.deepEqual(currentExtension, extensionHashes, 'New probe source drift before seed')
        const timing = createProbeTiming(), pool = createProbeDispatcher(1, timing)
        class InstalledAdapter extends LlmAdapter {
          override providerInfo(provider: string) { return source.llm.listProviders().find(row => row.id === provider)! }
          override listModels(provider: string) { return source.llm.listModels(provider) }
          override resolveModel(provider: string, id: string, signal?: AbortSignal) { return source.llm.resolveModelInfo(provider, id, signal) }
          override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'experiment') }
          override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
            assert.equal(options.provider, PROBE_ROUTE.provider); assert.equal(options.model, model.id)
            assert.equal(options.reasoningEffort, 'medium'); assert.equal(options.maxTokens, 4096)
            let prepared!: PreparedLlmCall
            yield* pool.stream(options, () => (async function* () {
              const call = ++dispatches
              trace({ kind: 'dispatch', call, seed, at: Date.now(), ...PROBE_ROUTE, maxTokens: options.maxTokens })
              for await (const chunk of prepared.stream(options)) {
                if (chunk.type === 'finish') {
                  const failure = chunk.reason.kind === 'error' ? chunk.reason.failure : null
                  if (failure && ([401, 403, 429].includes(failure.status ?? 0) || /AUTH|RATE_LIMIT|QUOTA|PERMISSION/.test(failure.code))) stopped = 'provider-auth-access-or-quota-rejected'
                  trace({ kind: 'finish', call, seed, at: Date.now(), reason: chunk.reason.kind,
                    ...(failure ? { code: failure.code, status: failure.status ?? null } : {}) })
                }
                yield chunk
              }
            })(), async () => {
              if (stopped) throw new Error('Provider stopped before queued dispatch')
              prepared = await source.llm.prepareCall({ provider: 'agy', model: model.id,
                reasoningEffort: ReasoningEffortId('medium'), maxTokens: options.maxTokens }, options.signal)
              assert.equal(prepared.config.provider, 'agy'); assert.equal(prepared.config.model, model.id)
              assert.equal(prepared.config.reasoningEffort, 'medium'); assert.equal(prepared.config.maxTokens, 4096)
            })
          }
        }
        const runDirectory = join(root, `seed-${seed}`)
        const report = await runAfterProbeGate(inputs[index], () => runShiftingEvidence({ ...conditions, seed, model,
          mode: 'adaptive', directory: runDirectory, purpose: 'adaptive-probe' }, undefined, {
          provenance: { provider: 'agy', plugin: 'dsh-agy', profile: 'installed-desktop-plugin',
            modelImport: 'installed-dsh-agy', mount: 'dsh-installed-plugin', model: model.id, reasoningEffort: 'medium' },
          async liveProviderMount(ctx) { timing.install(ctx); ctx.llm.registerAdapter(['agy'], new InstalledAdapter()) },
        }))
        const rows = timing.snapshot()
        timingBySeed[seed] = rows
        await writeFile(join(runDirectory, 'timing.json'), JSON.stringify(rows, null, 2) + '\n')
        assert(rows.every(row => row.settledAt !== null), 'All timing attempts must settle')
        assert(rows.every(row => row.queueMs! + row.serviceMs! + row.cleanupMs! === row.totalMs), 'Timing decomposition')
        const dispatched = rows.filter(row => row.dispatchAt !== null).sort((a, b) => a.dispatchAt! - b.dispatchAt!)
        assert(dispatched.every((row, i) => i === 0 || dispatched[i - 1].providerSettledAt! <= row.dispatchAt!), 'Serial services must not overlap')
        completed.push({ ...report, directory: runDirectory })
        if (report.cleanup !== 'released') stopped = 'cleanup-not-released'
        if (report.failures.some(row => [401,403,429].includes(row.status ?? 0) || /AUTH|RATE_LIMIT|QUOTA|PERMISSION/.test(row.code))) stopped = 'provider-auth-access-or-quota-rejected'
        await traceWrites
        await writeFile(join(root, 'batch.json'), JSON.stringify({ ...plan, completed, stopped, actualProviderDispatches: dispatches,
          timingBySeed }, null, 2) + '\n')
        console.log('AGY_RESUMED_RUN ' + JSON.stringify({ seed, passed: report.passed, phase1: report.phase1Correct, phase2: report.phase2Correct,
          issuedModelCalls: report.issuedModelCalls, elapsedMs: report.elapsedMs, stopReason: report.stopReason, cleanup: report.cleanup,
          providerDispatches: dispatches, completed: completed.length, stopped }))
        if (stopped) break
      }
    } finally {
      clearInterval(heartbeat)
      await source.fiber.dispose(); await traceWrites; hook.deregister()
    }
    console.log('AGY_RESUMED_DONE ' + JSON.stringify({ completed: completed.length, planned: seeds.length, stopped, providerDispatches: dispatches }))
    if (stopped) process.exitCode = 1
  })
}
