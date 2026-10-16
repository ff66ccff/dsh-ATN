/** Offline extraction of observed, uncensored dispatch-to-finish durations. */
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { PROBE_ROUTE, type ProbeGateInput } from './live-probe-feasibility.ts'
import assert from 'node:assert/strict'

export async function loadLegacyProbeHistory() {
  const file = 'docs/execution-evidence/agy-model-20261015/provider-calls.jsonl'
  const raw = await readFile(file, 'utf8')
  const rows = raw.trim().split('\n').map(line => JSON.parse(line) as {
    kind: string; call: number; at: number; reason?: string; provider?: string; model?: string; reasoningEffort?: string;
  })
  const starts = new Map<number, number>(), durations: number[] = [], excluded: number[] = []
  for (const row of rows) {
    if (row.kind === 'dispatch') {
      for (const key of ['provider', 'model', 'reasoningEffort'] as const) if (row[key] !== PROBE_ROUTE[key]) throw new Error('Historical route mismatch')
      if (starts.has(row.call)) throw new Error('Duplicate historical dispatch')
      starts.set(row.call, row.at)
    } else if (row.kind === 'finish') {
      const start = starts.get(row.call)
      if (start === undefined || row.at < start) throw new Error('Unpaired historical finish')
      if (row.reason === 'stop' || row.reason === 'tool-calls' || row.reason === 'max-tokens') durations.push(row.at - start)
      else excluded.push(row.call)
      starts.delete(row.call)
    }
  }
  if (durations.length === 0) throw new Error('No usable historical latency')
  const meanMs = durations.reduce((a, b) => a + b, 0) / durations.length
  const latency: ProbeGateInput['latency'] = { ...PROBE_ROUTE, ms: Math.ceil(meanMs),
    source: `${file}; pair dispatch.at -> finish.at; arithmetic mean of non-aborted successful finishes, rounded up to ms`,
    limitations: ['Same plugin/model/medium and output limit 4096, earlier 120-second batch; present load may differ.',
      '5 aborted calls are right-censored and excluded. Successful-call mean has survivor bias; future or incomplete calls can be slower.',
      'Finish chunk precedes iterator settlement; provider preparation and host work are outside this interval. Explicit overhead reserve is required.',
      'This is not 120 seconds divided by dispatch count, not modelDurationMs divided by attempts, and not a hard latency lower bound.'] }
  return { latency, file, fileSha256: sha256(raw), sampleCount: durations.length, dispatchCount: durations.length + excluded.length + starts.size,
    censoring: 'right-censored' as const, quantiles: QUANTILES.map(quantile => ({ quantile, ms: nearestRank(durations, quantile) })),
    excludedCalls: excluded, unfinishedCalls: [...starts.keys()], meanMs, minMs: Math.min(...durations), maxMs: Math.max(...durations) }
}

export const PROBE_SEEDS = [17, 31, 45, 59, 73] as const
export const CURRENT_PROBE_DIRECTORY = 'docs/execution-evidence/live-probe-resumed-20261015'
export const QUANTILE_PRINCIPLE = 'Service-level planning policy: cover 90% of observed individual service times using empirical nearest-rank p90, without fitting the policy to a desired admission outcome.'
export const QUANTILES = [0.5, 0.75, 0.9, 0.95] as const
export const sha256 = (raw: string | Uint8Array) => createHash('sha256').update(raw).digest('hex')
export const jsonLines = <T>(raw: string): T[] => raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as T)

export function nearestRank(samples: number[], quantile: number): number {
  if (!samples.length || !(quantile > 0 && quantile <= 1) || samples.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid quantile sample')
  return [...samples].sort((a, b) => a - b)[Math.ceil(quantile * samples.length) - 1]
}

interface ProviderRow {
  kind: string; call: number; at: number; seed?: number; reason?: string
  provider?: string; model?: string; reasoningEffort?: string
}

export function pairProviderCalls(rows: ProviderRow[], requireUncensored: boolean) {
  const starts = new Map<number, ProviderRow>(), seen = new Set<number>()
  const samples: Array<{ call: number; seed?: number; ms: number; reason: string }> = []
  const excluded: number[] = []
  for (const row of rows) {
    assert.ok(Number.isSafeInteger(row.call) && Number.isFinite(row.at), 'Invalid provider row')
    if (row.kind === 'dispatch') {
      for (const key of ['provider', 'model', 'reasoningEffort'] as const) assert.equal(row[key], PROBE_ROUTE[key], 'Historical route mismatch')
      assert.ok(!seen.has(row.call), 'Duplicate historical dispatch')
      seen.add(row.call); starts.set(row.call, row)
    } else if (row.kind === 'finish') {
      const start = starts.get(row.call)
      assert.ok(start && row.at >= start.at, 'Unpaired historical finish')
      assert.equal(row.seed, start.seed, 'Historical seed mismatch')
      if (['stop', 'tool-calls', 'max-tokens', 'error'].includes(row.reason ?? '')) {
        // An error with a finish is an observed service interval, not a successful response.
        samples.push({ call: row.call, seed: row.seed, ms: row.at - start.at, reason: row.reason! })
      } else excluded.push(row.call)
      starts.delete(row.call)
    } else throw new Error(`Unknown provider event: ${row.kind}`)
  }
  if (requireUncensored) assert.equal(excluded.length + starts.size, 0, 'Censored or unfinished dispatch in uncensored batch')
  assert.ok(samples.length > 0, 'No usable historical latency')
  return { durations: samples.map(row => row.ms), samples, dispatchCount: seen.size, excludedCalls: excluded, unfinishedCalls: [...starts.keys()] }
}

export async function loadProbeHistory() {
  const file = `${CURRENT_PROBE_DIRECTORY}/provider-calls.jsonl`
  const raw = await readFile(file, 'utf8')
  const paired = pairProviderCalls(jsonLines<ProviderRow>(raw), true)
  const metricsSources = []
  let expectedAttempts = 0, aborted = 0
  for (const seed of PROBE_SEEDS) {
    const path = `${CURRENT_PROBE_DIRECTORY}/seed-${seed}-report.json`
    const reportRaw = await readFile(path, 'utf8')
    const report = JSON.parse(reportRaw)
    expectedAttempts += report.metrics.totals.attempts; aborted += report.metrics.totals.aborted
    assert.equal(paired.samples.filter(row => row.seed === seed).length, report.metrics.totals.attempts, 'Per-seed dispatch count mismatch')
    metricsSources.push({ path, sha256: sha256(reportRaw), attempts: report.metrics.totals.attempts, aborted: report.metrics.totals.aborted })
  }
  assert.equal(aborted, 0, 'Censored metric attempts')
  assert.equal(expectedAttempts, 224)
  assert.equal(paired.samples.length, expectedAttempts, 'Current samples must include every attempt')
  const quantiles = QUANTILES.map(quantile => ({ quantile, ms: nearestRank(paired.durations, quantile) }))
  const latency: ProbeGateInput['latency'] = { ...PROBE_ROUTE, ms: nearestRank(paired.durations, 0.9),
    source: `${file}; SHA-256 ${sha256(raw)}; all dispatch.at -> finish.at intervals, nearest-rank p90`,
    coverage: { quantile: 0.9, sampleCount: paired.samples.length, principle: QUANTILE_PRINCIPLE },
    limitations: ['Empirical coverage of individual observed service times, not a probability bound for an entire 68-call run or a guarantee for future traffic.',
      'Uncensored means every dispatch has a finish and aborted=0; includes one observed error interval, not 224 successful responses.',
      'Provider preparation and iterator cleanup lie outside dispatch-to-finish; the separate 30000 ms host reserve remains a planning assumption.',
      'Earlier censored survivors are reported separately, never pooled.'] }
  return { latency, file, fileSha256: sha256(raw), metricsSources, sampleCount: paired.samples.length,
    dispatchCount: paired.dispatchCount, expectedAttempts, aborted, censoring: 'uncensored' as const,
    excludedCalls: paired.excludedCalls, unfinishedCalls: paired.unfinishedCalls, quantiles,
    meanMs: paired.durations.reduce((a, b) => a + b, 0) / paired.durations.length,
    finishReasons: Object.fromEntries([...new Set(paired.samples.map(row => row.reason))].map(reason => [reason, paired.samples.filter(row => row.reason === reason).length])),
    perSeed: PROBE_SEEDS.map(seed => { const rows = paired.samples.filter(row => row.seed === seed)
      const successful = rows.filter(row => row.reason !== 'error')
      return { seed, count: rows.length, meanMs: rows.reduce((n, row) => n + row.ms, 0) / rows.length,
        successfulMeanMs: successful.reduce((n, row) => n + row.ms, 0) / successful.length,
        quantiles: QUANTILES.map(quantile => ({ quantile, ms: nearestRank(rows.map(row => row.ms), quantile) })) } }),
    differenceFromPrevious: 'Current: 224/224 observed finishes, aborted=0, no censoring; previous: 71/76 successful survivors with five excluded right-censored aborted calls. No pooling.' }
}
