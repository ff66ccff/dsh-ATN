import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installTelemetry } from '../../experiments/telemetry.ts'
import { createProbeTiming, createProbeDispatcher } from '../../experiments/live-probe-timing.ts'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done }); return { promise, resolve } }

test('PROBE-TIMING: real llm waterfall proves queue-inclusive legacy duration; serial services never overlap; decomposition is exact', async () => {
  const ctx = new Context()
  const scratch = await mkdtemp(join(tmpdir(), 'probe-timing-'))
  let now = 0
  const timing = createProbeTiming(() => now)
  const pool = createProbeDispatcher(1, timing)
  const started = [deferred(), deferred()], finish = [deferred(), deferred()]
  let dispatches = 0
  class Adapter extends LlmAdapter {
    override async resolveModel(provider: string, id: string) { return { provider, id, name: 'Zero-network timing fixture' } }
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      yield* pool.stream(options, () => (async function* () {
        const index = dispatches++
        started[index].resolve()
        await finish[index].promise
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      })())
    }
  }
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['timing-test'], new Adapter())
  timing.install(ctx)
  const telemetry = await installTelemetry(ctx, { directory: scratch, runId: 'queue-proof', now: () => now })
  const consume = async (id: string, signal?: AbortSignal) => {
    for await (const _ of ctx.llm.stream({ provider: 'timing-test', model: 'fixture', sessionId: SessionId(id), messages: [], signal })) { /* drain */ }
  }
  try {
    const first = consume('first')
    await started[0].promise
    now = 10
    const second = consume('second')
    // Starting consumption registers the second attempt synchronously; model
    // resolution may suspend before reaching the serial dispatcher.
    while (timing.snapshot().length < 2) await Promise.resolve()
    now = 100
    finish[0].resolve()
    await started[1].promise
    await first
    now = 200
    finish[1].resolve()
    await second
    const rows = timing.snapshot()
    assert.equal(dispatches, 2)
    assert.equal(rows[0].dispatchAt, 0)
    assert.equal(rows[0].providerSettledAt, 100)
    assert.equal(rows[1].dispatchAt, 100)
    assert.equal(rows[1].providerSettledAt, 200)
    assert.equal(rows[1].queueMs, 90)
    assert.ok(rows[0].providerSettledAt! <= rows[1].dispatchAt!)
    for (const row of rows) assert.equal(row.queueMs! + row.serviceMs! + row.cleanupMs!, row.totalMs)
    const legacy = telemetry.snapshot().totals.modelDurationMs
    assert.equal(legacy, 290)
    assert.equal(rows.reduce((sum, row) => sum + row.totalMs!, 0), legacy)
    assert.equal(rows.reduce((sum, row) => sum + row.serviceMs!, 0), 200)
    assert.ok(legacy > 200, 'queue-inclusive attempt sum exceeds wall time at provider concurrency 1')
    if (process.env.LIVE_PROBE_TIMING_EVIDENCE) await writeFile(process.env.LIVE_PROBE_TIMING_EVIDENCE,
      JSON.stringify({ execution: 'deterministic-zero-network', rows, wallMs: 200, legacyModelDurationMs: legacy,
        serviceSumMs: 200, meaning: 'Sum of settled llm/stream attempt lifetimes including pre-dispatch queue/preparation and cleanup; aborted attempts count if settled before telemetry closes.' }, null, 2) + '\n')
  } finally {
    finish.forEach(gate => gate.resolve())
    await telemetry.close(); await ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true })
  }
})

test('PROBE-TIMING: cancelled queued request has no provider dispatch and decomposes as queue only', async () => {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const timing = createProbeTiming()
  timing.install(ctx)
  const pool = createProbeDispatcher(1, timing)
  const started = deferred(), release = deferred()
  let dispatches = 0
  class Adapter extends LlmAdapter {
    override async resolveModel(provider: string, id: string) { return { provider, id, name: 'Abort fixture' } }
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      yield* pool.stream(options, () => (async function* () {
        dispatches++; started.resolve(); await release.promise
        yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
      })())
    }
  }
  ctx.llm.registerAdapter(['timing-test'], new Adapter())
  const consume = async (sessionId: string, signal?: AbortSignal) => {
    for await (const _ of ctx.llm.stream({ provider: 'timing-test', model: 'fixture', messages: [], sessionId: SessionId(sessionId), signal })) { /* drain */ }
  }
  try {
    const first = consume('first'); await started.promise
    const controller = new AbortController()
    const queued = consume('queued', controller.signal)
    while (!timing.snapshot().some(row => row.session === 'queued' && row.associated)) await new Promise(done => setImmediate(done))
    controller.abort(); await queued
    release.resolve(); await first
    const row = timing.snapshot().find(row => row.session === 'queued')!
    assert.equal(dispatches, 1)
    assert.equal(row.dispatchAt, null)
    assert.equal(row.serviceMs, 0)
    assert.equal(row.cleanupMs, 0)
    assert.equal(row.queueMs, row.totalMs)
    assert.equal(row.status, 'aborted')
  } finally { release.resolve(); await ctx.fiber.dispose() }
})
