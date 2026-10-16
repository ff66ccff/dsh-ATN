import assert from 'node:assert/strict'
import test from 'node:test'
import { createShiftingEvidenceTask } from '../../experiments/shifting-evidence-task.ts'
import { deriveProbeLowerBound, evaluateProbeFeasibility, runAfterProbeGate, PROBE_ROUTE, type ProbeGateInput } from '../../experiments/live-probe-feasibility.ts'

const input = (): ProbeGateInput => ({ lowerBound: deriveProbeLowerBound(createShiftingEvidenceTask(8, 17, 2)),
  reference: { actions: 60, maxNodeActions: 8, source: 'synthetic reference fixture; not a minimum' },
  conditions: { agents: 8, perNodeSteps: 12, maxCalls: 96, timeoutMs: 120000, concurrency: 1 },
  latency: { ...PROBE_ROUTE, ms: 8000, source: 'synthetic deterministic test latency, not a live observation', limitations: [] },
  margin: { actionFactor: 1.125, nodeFactor: 1.125, overheadMs: 30000, rationale: 'explicit test headroom' },
  schedulingRemedy: 'deadline' })

test('PROBE-BOUND: 5 frozen seeds have four distinct remote owners; conditional bound is 10 calls / 2 steps, never 60 / 8', () => {
  for (const seed of [17, 31, 45, 59, 73]) {
    const bound = deriveProbeLowerBound(createShiftingEvidenceTask(8, seed, 2))
    assert.equal(new Set(bound.requiredOwners).size, 4)
    assert.ok(bound.requiredOwners.every(owner => owner > 0))
    assert.equal(bound.evidenceCausalModelCalls, 10)
    assert.equal(bound.maxNodeStepsLowerBound, 2)
    assert.equal(bound.unconditionalModelCalls, 1)
    assert.match(bound.limitation, /conditional/)
  }
  const invalid = createShiftingEvidenceTask(8, 17, 2)
  invalid.phases[1].holders['key-00'] = invalid.phases[0].holders['key-00']
  assert.throws(() => deriveProbeLowerBound(invalid), /four distinct/)
  assert.throws(() => deriveProbeLowerBound(createShiftingEvidenceTask(8, 17, 4)), /only the frozen/)
})

test('PROBE-G3/G4: old allocation fails planning deadline alone, exact boundary passes, selected concurrency remedy is distinguished', () => {
  const old = evaluateProbeFeasibility(input())
  assert.equal(old.admitted, false)
  assert.deepEqual(old.insufficient, ['deadline'])
  assert.equal(old.plannedCalls, 68)
  assert.equal(old.plannedMaxNodeSteps, 9)
  assert.equal(old.requiredDeadlineMs, 574000)
  assert.ok(old.necessaryConditionalWorkMs < 120000, 'Do not claim a strict impossibility certificate for 120 seconds')
  const enough = evaluateProbeFeasibility({ ...input(), conditions: { ...input().conditions, timeoutMs: old.requiredDeadlineMs } })
  assert.equal(enough.admitted, true)
  const concurrency = evaluateProbeFeasibility({ ...input(), schedulingRemedy: 'concurrency' })
  assert.deepEqual(concurrency.insufficient, ['concurrency'])
  const parallel = evaluateProbeFeasibility({ ...input(), schedulingRemedy: 'concurrency',
    conditions: { ...input().conditions, concurrency: concurrency.requiredConcurrency! } })
  assert.equal(parallel.admitted, true)
})

test('PROBE-ADMISSION: refusal precedes mount; provenance and actual latency input control the result', async () => {
  let mounts = 0
  await assert.rejects(() => runAfterProbeGate(input(), async () => { mounts++; return true }), /before provider mount/)
  assert.equal(mounts, 0)
  assert.throws(() => evaluateProbeFeasibility({ ...input(), latency: { ...input().latency, source: '' } }), /provenance/)
  assert.throws(() => evaluateProbeFeasibility({ ...input(), latency: { ...input().latency, model: 'other' } }), /mismatch/)
  const fast = { ...input(), latency: { ...input().latency, ms: 1000 } }
  assert.equal(evaluateProbeFeasibility(fast).admitted, true)
  await runAfterProbeGate(fast, async () => { mounts++ })
  assert.equal(mounts, 1)
  assert.deepEqual(evaluateProbeFeasibility({ ...input(), conditions: { ...input().conditions, perNodeSteps: 8, maxCalls: 60 } }).insufficient,
    ['nodeSteps', 'callCap', 'deadline'])
  assert.throws(() => evaluateProbeFeasibility({ ...input(), margin: { ...input().margin, actionFactor: 1 } }), /margins/)
})
