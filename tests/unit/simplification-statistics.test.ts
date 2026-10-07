import { strict as assert } from 'node:assert'
import test from 'node:test'
import { pairedRiskDifference, pairedScore, nonInferiorityPower, simplificationPower, NI_Z95,
  nonInferiorityAcceptable, minimumPairedSeeds, zeroDiscordanceBound } from '../../experiments/simplification-statistics.ts'
import { SIMPLIFICATION_ARMS, shiftingMechanisms } from '../../experiments/simplification-arms.ts'

test('SIMPLIFICATION-BRIEF-REJECT: D=-0.10, CI=[-0.40,+0.20], delta=0.25 cannot authorize removal', () => {
  assert.equal(nonInferiorityAcceptable(-.10, { lower: -.40, upper: .20 }, .25), false)
})

test('SIMPLIFICATION-BRIEF-ACCEPT: D=0, CI=[-0.20,+0.20], delta=0.25 passes the harm boundary', () => {
  assert.equal(nonInferiorityAcceptable(0, { lower: -.20, upper: .20 }, .25), true)
  assert.equal(nonInferiorityAcceptable(0, { lower: -.25, upper: .20 }, .25), false)
})

test('SIMPLIFICATION-MINIMUM: delta determines the exact best-case floor, with discordance reserve recorded', () => {
  for (const [delta, expected] of [[.4, 6], [.3, 9], [.25, 11], [.2, 14], [.15, 19]]) {
    assert.equal(minimumPairedSeeds(delta), expected)
    assert.ok(zeroDiscordanceBound(expected) < delta)
    assert.ok(zeroDiscordanceBound(expected - 1) >= delta)
  }
  assert.ok(Math.abs(zeroDiscordanceBound(10) - .2588655509) < 1e-9)
  assert.ok(Math.abs(zeroDiscordanceBound(12) - .2209221919) < 1e-9)
  const power = simplificationPower(14)
  assert.equal(power.bestCaseSampleSize.minimumSeeds, 11)
  assert.equal(power.bestCaseSampleSize.discordanceReserve, 3)
  assert.equal(power.readyToRun, true)
  assert.equal(simplificationPower(11).readyToRun, false, 'Tango 95% can need more pairs than the CP planning floor')
})

test('SIMPLIFICATION-POWER: exact McNemar feasibility is distinct from 25pp noninferiority and 80% power', () => {
  const five = simplificationPower(5), ten = simplificationPower(10), twelve = simplificationPower(12)
  assert.equal(five.minimumPossibleP, 0.0625)
  assert.equal(five.alphaAttainable, false)
  assert.match(five.alphaAttainabilityStatement, /任何效应都不可达/)
  assert.equal(ten.minimumPossibleP, 0.001953125)
  assert.equal(ten.alphaAttainable, true)
  assert.match(ten.alphaAttainabilityStatement, /可达/)
  assert.equal(ten.nonInferiority.marginDistinguishable, false)
  assert.equal(ten.readyToRun, false)
  assert.equal(twelve.nonInferiority.marginDistinguishable, true)
  assert.equal(twelve.readyToRun, true)
  assert.equal(twelve.nonInferiority.targetPowerReached, false)
  assert.equal(twelve.lowPowerAcknowledgementRequired, true)
  assert.ok(Math.abs(ten.nonInferiority.power - 0.171875) < 1e-12)
})

test('SIMPLIFICATION-NI: severe ablation loss cannot pass the sign-correct noninferiority criterion', () => {
  const loss = pairedRiskDifference(10, 0, 10), gain = pairedRiskDifference(10, 10, 0)
  assert.equal(loss.estimate, -1)
  assert.equal(loss.nonInferiorityPassed, false)
  assert.equal(gain.nonInferiorityPassed, true)
  assert.ok(loss.interval.upper < 0.25, 'the brief literal upper-bound rule would incorrectly accept a total loss')
  assert.ok(Math.abs(loss.interval.lower + gain.interval.upper) < 1e-12)
  assert.ok(Math.abs(loss.interval.upper + gain.interval.lower) < 1e-12)
})

test('SIMPLIFICATION-ZERO-CELLS: Tango equation 34 gives a nonzero uncertainty interval', () => {
  for (const n of [10, 12, 30, 128]) {
    const result = pairedRiskDifference(n, 0, 0), half = NI_Z95 ** 2 / (n + NI_Z95 ** 2)
    assert.ok(Math.abs(result.interval.lower + half) < 1e-12)
    assert.ok(Math.abs(result.interval.upper - half) < 1e-12)
    assert.equal(result.nonInferiorityPassed, n >= 12)
    assert.equal(result.discordantPairs, 0)
  }
  assert.deepEqual(pairedRiskDifference(0, 0, 0).interval, { lower: -1, upper: 1 })
})

test('SIMPLIFICATION-SCORE: zero margin reduces to paired McNemar score, and power enumerates the alternative', () => {
  assert.ok(Math.abs(pairedScore(20, 7, 3, 0) - 4 / Math.sqrt(10)) < 1e-12)
  assert.equal(nonInferiorityPower(10, .25, 0), 0)
  assert.equal(nonInferiorityPower(12, .25, 0), 1)
  assert.ok(nonInferiorityPower(128, .25, .8) > .8)
  assert.ok(nonInferiorityPower(128, .25, 1) > .8)
  assert.throws(() => pairedRiskDifference(5, 3, 3), /Invalid paired/)
  assert.throws(() => nonInferiorityPower(10, .25, .1, .2), /Invalid power/)
})

test('SIMPLIFICATION-ARMS: minimal disables both mechanisms without changing the other arms', () => {
  assert.deepEqual(SIMPLIFICATION_ARMS, ['adaptive', 'no-feedback', 'no-board', 'minimal'])
  assert.deepEqual(shiftingMechanisms('adaptive'), { requesterFeedback: true, sharedBoard: true })
  assert.deepEqual(shiftingMechanisms('no-feedback'), { requesterFeedback: false, sharedBoard: true })
  assert.deepEqual(shiftingMechanisms('no-board'), { requesterFeedback: true, sharedBoard: false })
  assert.deepEqual(shiftingMechanisms('minimal'), { requesterFeedback: false, sharedBoard: false })
})
