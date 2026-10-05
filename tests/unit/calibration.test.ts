import { strict as assert } from 'node:assert'
import test from 'node:test'
import { calibratedTokenLimit, type CalibrationKey, type CalibrationSample } from '../../experiments/calibration.ts'
import { createExperimentBudget } from '../../experiments/budget.ts'

const key: CalibrationKey = { model: 'test-model', task: 'shift-ledger-1', maxAgents: 8,
  perNodeSteps: 16, maxOutputTokens: 8192, recoveryMode: 'self-organized' }

function sample(mode: string, known: number, configuration: CalibrationKey = key): CalibrationSample {
  return { runId: `${mode}-${known}`, mode, model: configuration.model, task: configuration.task, calibration: true,
    limits: { ...configuration, observedTokenLimit: null }, stopReason: 'submitted', evaluation: { passed: true },
    metrics: { totals: { tokens: { totalTokens: { known, unknownCalls: 0 } } } } }
}
const pair = () => [sample('atn-no-rewire', 100), sample('atn-adaptive', 150)]

test('CALIBRATION-01: both matching unlimited-token arms determine twice the largest measured cost', () => {
  const samples = [...pair(), sample('atn-adaptive', 180)]
  const result = calibratedTokenLimit(samples, key)
  assert.equal(result.observedTokenLimit, 360)
  assert.equal(result.multiplier, 2)
  assert.deepEqual(result.sourceRuns, samples.map(row => row.runId))
  const backupKey = { ...key, recoveryMode: 'preassigned-backup' as const }
  assert.equal(calibratedTokenLimit([
    sample('atn-no-rewire-preassigned-backup', 90, backupKey), sample('atn-adaptive-preassigned-backup', 110, backupKey),
  ], backupKey).observedTokenLimit, 220)
})

test('CALIBRATION-02: missing arms, finite thresholds and every mismatched key are rejected', () => {
  assert.throws(() => calibratedTokenLimit([pair()[0]], key), /Missing matching/)
  assert.throws(() => calibratedTokenLimit(pair().map(row => ({ ...row, limits: { ...row.limits, observedTokenLimit: 10_000 } })), key), /Missing matching/)
  assert.throws(() => calibratedTokenLimit(pair().map(row => ({ ...row, calibration: false })), key), /Missing matching/)
  for (const [field, replacement] of Object.entries({ model: 'other', task: 'shift-ledger-2', maxAgents: 9,
    perNodeSteps: 17, maxOutputTokens: 4096, recoveryMode: 'preassigned-backup' })) {
    const mismatch = { ...key, [field]: replacement }
    assert.throws(() => calibratedTokenLimit(pair(), mismatch), /Missing matching/, field)
  }
})

test('CALIBRATION-03: failures, unknown usage, invalid counts and overflow cannot become a safety threshold', () => {
  for (const stopReason of ['call-limit', 'observed-token-limit', 'timeout', 'quiescent-without-submission']) {
    assert.throws(() => calibratedTokenLimit([pair()[0], { ...pair()[1], stopReason }], key), /Calibration must complete/)
  }
  assert.throws(() => calibratedTokenLimit([pair()[0], { ...pair()[1], evaluation: { passed: false } }], key), /Calibration must complete/)
  assert.throws(() => calibratedTokenLimit([pair()[0], { ...pair()[1], maxTokenTruncations: 1 }], key), /Calibration must complete/)
  assert.throws(() => calibratedTokenLimit([pair()[0], { ...pair()[1], metrics: null }], key), /Calibration must complete/)
  for (const known of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => calibratedTokenLimit([pair()[0], sample('atn-adaptive', known)], key), /Calibration must complete/)
  }
  for (const unknownCalls of [1, -1, Number.NaN]) {
    const invalid = sample('atn-adaptive', 100)
    invalid.metrics!.totals.tokens.totalTokens.unknownCalls = unknownCalls
    assert.throws(() => calibratedTokenLimit([pair()[0], invalid], key), /Calibration must complete/)
  }
  assert.throws(() => calibratedTokenLimit([pair()[0], sample('atn-adaptive', Number.MAX_SAFE_INTEGER)], key), /Invalid calibrated/)
  assert.throws(() => calibratedTokenLimit([...pair(), { ...sample('atn-adaptive', 200), evaluation: { passed: false } }], key),
    /Calibration must complete/, 'successful repeats must not hide a failed matching sample')
})

test('CALIBRATION-04: malformed JSON booleans and modes fail closed', () => {
  for (const field of ['calibration', 'evaluation'] as const) {
    const malformed = pair().map(row => field === 'calibration'
      ? { ...row, calibration: 'false' } : { ...row, evaluation: { passed: 'false' } })
    assert.throws(() => calibratedTokenLimit(malformed as unknown as CalibrationSample[], key))
  }
  assert.throws(() => calibratedTokenLimit(pair().map(row => ({ ...row,
    mode: row.mode.replace('atn-', 'atn-preassigned-backup-') })), key))
  assert.throws(() => calibratedTokenLimit(pair().map(row => ({ ...row,
    mode: `${row.mode}-preassigned-backup` })), key), 'mode suffix and recovery-mode key must agree')
})

test('CALIBRATION-05: null token threshold leaves exact-route, output and call limits enforced', () => {
  const options = { provider: 'allowed', model: 'model', maxCalls: 2, maxOutputTokens: 8192, observedTokenLimit: null }
  const request = { provider: 'allowed', model: 'model', maxTokens: 8192 }
  const observation = { ended: false, knownTotalTokens: Number.MAX_SAFE_INTEGER, unknownUsageCalls: 3 }
  const budget = createExperimentBudget(options)
  assert.deepEqual(budget.admit({ ...request, provider: 'other' }, observation), { allowed: false, reason: 'route-not-allowed', issued: 0 })
  assert.deepEqual(budget.admit({ ...request, maxTokens: 8193 }, observation), { allowed: false, reason: 'output-limit-not-applied', issued: 0 })
  assert.equal(budget.admit(request, observation).allowed, true)
  assert.equal(budget.admit(request, observation).allowed, true)
  assert.deepEqual(budget.admit(request, observation), { allowed: false, reason: 'call-limit', issued: 2 })
  assert.equal(budget.snapshot().unknownUsageCalls, 3)
})
