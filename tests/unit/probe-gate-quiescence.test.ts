import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadProbeHistory, loadLegacyProbeHistory, pairProviderCalls, nearestRank, QUANTILE_PRINCIPLE } from '../../experiments/live-probe-history.ts'
import { analyzeProbeBatch, classifyQuiescence, buildSensitivity } from '../../experiments/probe-gate-quiescence.ts'

test('PROBE-Q1: complete current batch is separate from censored legacy survivors, with provenance', async () => {
  const current = await loadProbeHistory(), legacy = await loadLegacyProbeHistory()
  assert.equal(current.sampleCount, 224)
  assert.equal(current.aborted, 0)
  assert.equal(current.censoring, 'uncensored')
  assert.equal(current.expectedAttempts, 224)
  assert.match(current.fileSha256, /^[a-f0-9]{64}$/)
  assert.equal(legacy.sampleCount, 71)
  assert.equal(legacy.dispatchCount, 76)
  assert.equal(legacy.censoring, 'right-censored')
  assert.notDeepEqual(current.quantiles, legacy.quantiles)
  assert.equal(current.latency.coverage?.quantile, 0.9)
  assert.match(QUANTILE_PRINCIPLE, /90%/)
  assert.doesNotMatch(QUANTILE_PRINCIPLE, /600|120|seed|batch|reject/i)
})

test('PROBE-Q2: pairing fails closed on censoring, duplicates, mismatched seeds and unmatched finishes', () => {
  const start = { kind: 'dispatch', call: 1, seed: 17, at: 10, provider: 'agy', model: 'gemini-3.8-flash-tiered', reasoningEffort: 'medium' }
  const finish = { kind: 'finish', call: 1, seed: 17, at: 20, reason: 'stop' }
  assert.equal(pairProviderCalls([start, finish], true).durations[0], 10)
  assert.throws(() => pairProviderCalls([start], true), /censor|unfinished/i)
  assert.throws(() => pairProviderCalls([start, start, finish], true), /Duplicate/)
  assert.throws(() => pairProviderCalls([finish], true), /Unpaired/)
  assert.throws(() => pairProviderCalls([start, { ...finish, seed: 31 }], true), /seed/i)
  assert.throws(() => pairProviderCalls([start, { ...finish, reason: 'aborted' }], true), /censor/i)
})

test('PROBE-Q3: nearest rank and four-scenario arithmetic, deadline-only rejection and exact admission control', async () => {
  assert.equal(nearestRank([1, 2, 3, 4], 0.75), 3)
  const curves = buildSensitivity(await loadProbeHistory())
  assert.deepEqual(curves.map(row => row.quantile), [0.5, 0.75, 0.9, 0.95])
  for (const row of curves) {
    assert.equal(row.requiredDeadlineMs, Math.ceil(68 * row.latencyMs + 30000))
    assert.equal(row.atRequiredDeadline.admitted, true)
    assert.equal(row.belowRequiredDeadline.admitted, false)
    assert.deepEqual(row.belowRequiredDeadline.insufficient, ['deadline'])
    assert.match(row.atRequiredDeadline.coverageMeaning, /observed service/)
  }
  const selected = curves.find(row => row.quantile === 0.9)!
  for (const gate of [selected.at600000, selected.at120000]) {
    assert.equal(gate.admitted, false)
    assert.deepEqual(gate.insufficient, ['deadline'])
    assert.deepEqual(gate.dimensions.slice(0, 2).map(row => [row.available, row.required, row.sufficient]), [[12, 9, true], [96, 68, true]])
    assert.deepEqual(gate.effectiveBudgetDimensions, ['nodeSteps', 'callCap', 'deadline'])
    assert.deepEqual(gate.unavailableBudgetDimensions.map(row => [row.dimension, row.active]), [['totalTokens', false]])
  }
})

test('PROBE-Q4: completed-obligation quiescence is a genuine negative control', () => {
  assert.equal(classifyQuiescence({ openTasks: 0, unresolvedTasks: 0, queuedMail: 0, checkpointsComplete: true }), 'quiescence-with-obligations-complete')
  for (const input of [
    { openTasks: 1, unresolvedTasks: 1, queuedMail: 0, checkpointsComplete: true },
    { openTasks: 0, unresolvedTasks: 1, queuedMail: 0, checkpointsComplete: true },
    { openTasks: 0, unresolvedTasks: 0, queuedMail: 1, checkpointsComplete: true },
    { openTasks: 0, unresolvedTasks: 0, queuedMail: 0, checkpointsComplete: false },
  ]) assert.equal(classifyQuiescence(input), 'quiescence-with-obligations-open')
})

test('PROBE-Q5: retained events locate every holder and preserve each distinct entry termination', async () => {
  const result = await analyzeProbeBatch()
  assert.equal(result.stops.length, 5)
  assert.deepEqual(result.quiescenceCounts, { 'quiescence-with-obligations-open': 5, 'quiescence-with-obligations-complete': 0 })
  for (const stop of result.stops) {
    assert.equal(stop.activity.runningAgents, 0)
    assert.ok(stop.activity.minimumQuietMs >= 200)
    assert.ok(stop.obligations.openTasks > 0)
    assert.ok(stop.tasks.length >= stop.obligations.openTasks)
    for (const task of stop.tasks) {
      assert.ok(['holder-alive', 'holder-unreachable'].includes(task.holderReachability))
      assert.ok(Number.isInteger(task.holderStepsAtCreation))
      assert.ok(task.holderState.nodeSequence > 0)
    }
    assert.equal(stop.entry.categories.discovery + stop.entry.categories.protocol + stop.entry.categories.rewire + stop.entry.categories.other, stop.entry.stepsUsed)
    assert.equal(stop.entry.steps.length, stop.entry.stepsUsed)
  }
  assert.equal(result.stops.find(row => row.seed === 31)!.entry.lastTurnReason, 'max-tokens')
  assert.equal(result.stops.find(row => row.seed === 59)!.entry.lastTurnReason, 'error')
  assert.deepEqual(result.failureCounts, { 'incorrect-proof': 3, 'submission-discipline': 2 })
  assert.equal(result.tokenPolicy.choice, 'b-remove-from-effective-budget')
  assert.deepEqual(result.tokenPolicy.exceededInputSeeds, [45, 73])
  const report = await readFile('docs/PROBE_GATE_AND_QUIESCENCE_IMPLEMENTATION_REPORT.md', 'utf8')
  assert.match(report, /3 个 incorrect-proof（提交了错误答案）\s*\+/)
  assert.match(report, /2 个 submission-discipline（未提交）/)
  assert.match(report, /seed 45\/73 \*\*已知输入单独超过 400000/)
})

test('PROBE-Q6: tool identities have per-call session proof and structural corroboration; status is not always discovery', async () => {
  const result = await analyzeProbeBatch()
  for (const stop of result.stops) {
    assert.deepEqual(stop.toolMapping.map(row => row.name), stop.seed === 31 || stop.seed === 59
      ? ['read_evidence', 'atn_status', 'atn_send'] : ['read_evidence', 'atn_status', 'atn_send', 'submit_checkpoint'])
    for (const mapping of stop.toolMapping) assert.ok(mapping.evidence.length > 0)
  }
  const entry = result.stops[0].entry
  assert.equal(entry.toolCounts.atn_status, 7)
  assert.equal(entry.categories.discovery, 4)
  assert.equal(entry.categories.protocol, 5)
  assert.equal(entry.categories.rewire, 1)
  assert.equal(entry.categories.other, 2)
  assert.equal(result.hypothesis.discoveryDominatesEntryBudget, false)
})

test('PROBE-Q7: offline recomputation imports no account, provider, runner or network surface', async () => {
  for (const file of ['scripts/recompute-probe-gate.ts', 'experiments/probe-gate-quiescence.ts', 'experiments/live-probe-history.ts', 'experiments/live-probe-feasibility.ts']) {
    const source = await readFile(file, 'utf8')
    assert.doesNotMatch(source, /from ['"](?:@deepseek|dsh-|node:(?:http|https|net|os))|import\(|fetch\(|process\.env|homedir\(/)
  }
})
