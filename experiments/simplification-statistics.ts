/** Paired noninferiority, independent of the historical superiority comparisons. */
import { completionPower } from './comparison-statistics.ts'

export const NI_MARGIN = 0.25
export const NI_TARGET_POWER = 0.8
export const NI_Z95 = 1.959963984540054
export const NI_METHOD = 'paired-multinomial-efficient-score-95% (Tango 1998)'
export const NI_SOURCE = 'https://www.site.uottawa.ca/~nat/Courses/csi5388/Tango.paired.pdf'

function validateMargin(margin: number) {
  if (!Number.isFinite(margin) || margin <= 0 || margin >= 1) throw new Error('Margin must be between zero and one')
}

/** The revised brief's sign convention: D = ablation - adaptive. Equality fails. */
export function nonInferiorityAcceptable(difference: number, interval: { lower: number; upper: number }, margin = NI_MARGIN) {
  validateMargin(margin)
  if (![difference, interval.lower, interval.upper].every(Number.isFinite) || interval.lower < -1 || interval.upper > 1 ||
    interval.lower > difference || difference > interval.upper) throw new Error('Invalid risk difference interval')
  return interval.lower > -margin
}

/** One-sided exact 95% upper bound on discordance when no pair disagrees.
 * Since |D| <= q, this is a best-case planning bound, not a Tango interval. */
export function zeroDiscordanceBound(n: number, alpha = 0.05) {
  if (!Number.isSafeInteger(n) || n < 1 || !(alpha > 0 && alpha < 1)) throw new Error('Invalid exact planning bound')
  return -Math.expm1(Math.log(alpha) / n)
}

export function minimumPairedSeeds(margin = NI_MARGIN) {
  validateMargin(margin)
  return Math.floor(Math.log(0.05) / Math.log1p(-margin)) + 1
}

function validateCounts(n: number, gains: number, losses: number) {
  if (![n, gains, losses].every(Number.isSafeInteger) || n < 0 || gains < 0 || losses < 0 || gains + losses > n) {
    throw new Error('Invalid paired binary counts')
  }
}

/** D = ablation - adaptive. At a fixed D, maximize the trinomial likelihood
 * over discordance q in [abs(D), 1]. The larger quadratic root includes
 * the zero-cell boundaries (Tango equations 24, 33 and 34). */
export function pairedScore(n: number, gains: number, losses: number, difference: number) {
  validateCounts(n, gains, losses)
  if (!Number.isFinite(difference) || difference < -1 || difference > 1) throw new Error('Invalid risk difference')
  if (!n) return 0
  const observed = (gains - losses) / n
  if (Math.abs(observed - difference) < 1e-14) return 0
  const concordant = n - gains - losses
  const a = gains + losses + (gains - losses) * difference
  const c = (losses - gains) * difference + concordant * difference ** 2
  const q = Math.min(1, Math.max(Math.abs(difference), (a + Math.sqrt(Math.max(0, a * a + 4 * n * c))) / (2 * n)))
  const variance = Math.max(0, q - difference ** 2)
  return variance ? (observed - difference) * Math.sqrt(n / variance) : Math.sign(observed - difference) * Infinity
}

export function pairedRiskDifference(n: number, gains: number, losses: number, margin = NI_MARGIN) {
  validateCounts(n, gains, losses)
  validateMargin(margin)
  const estimate = n ? (gains - losses) / n : null
  let lower = -1, upper = 1
  if (n) {
    let lo = -1, hi = estimate!
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (pairedScore(n, gains, losses, mid) > NI_Z95) lo = mid; else hi = mid
    }
    lower = (lo + hi) / 2
    lo = estimate!; hi = 1
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (pairedScore(n, gains, losses, mid) < -NI_Z95) hi = mid; else lo = mid
    }
    upper = (lo + hi) / 2
  }
  return { n, gains, losses, discordantPairs: gains + losses, concordantPairs: n - gains - losses,
    estimate, interval: { lower, upper }, lossInterval: { lower: -upper, upper: -lower },
    definition: 'completion(ablation) minus completion(adaptive)', method: NI_METHOD, source: NI_SOURCE,
    margin, criterion: 'lower 95% bound > -margin (equivalently upper loss bound < margin)',
    nonInferiorityPassed: estimate !== null && nonInferiorityAcceptable(estimate, { lower, upper }, margin),
    scoreAtMargin: n ? pairedScore(n, gains, losses, -margin) : null, criticalValue: NI_Z95,
    assumptions: 'Independent paired seeds; nominal asymptotic score coverage, not an exact finite-sample interval. Zero discordances still have a nonzero-width interval. McNemar superiority p values do not decide removal.' }
}

/** Enumerate every trinomial outcome; no simulation, outcome selection or provider calls.
 * Distribution: P(D=+1)=(q+effect)/2, P(D=-1)=(q-effect)/2. */
export function nonInferiorityPower(n: number, margin: number, discordance: number, effect = 0) {
  validateCounts(n, 0, 0)
  if (!n || n > 1000) throw new Error('Power enumeration requires n in [1,1000]')
  if (!(margin > 0 && margin < 1) || !(discordance >= Math.abs(effect) && discordance <= 1)) throw new Error('Invalid power alternative')
  const probabilities = [(discordance + effect) / 2, (discordance - effect) / 2, 1 - discordance]
  const factorial = [0]
  for (let i = 1; i <= n; i++) factorial[i] = factorial[i - 1] + Math.log(i)
  let power = 0, mass = 0
  for (let gains = 0; gains <= n; gains++) for (let losses = 0; losses <= n - gains; losses++) {
    const counts = [gains, losses, n - gains - losses]
    if (counts.some((count, i) => count > 0 && probabilities[i] === 0)) continue
    let logProbability = factorial[n]
    counts.forEach((count, i) => { logProbability -= factorial[count]; if (count) logProbability += count * Math.log(probabilities[i]) })
    const probability = Math.exp(logProbability)
    mass += probability
    if (pairedScore(n, gains, losses, -margin) > NI_Z95) power += probability
  }
  if (Math.abs(mass - 1) > 1e-9) throw new Error('Power enumeration lost probability mass')
  return Math.max(0, Math.min(1, power))
}

export function simplificationPower(n: number, margin = NI_MARGIN, planningDiscordance = 1) {
  validateMargin(margin)
  const superiority = completionPower(n)
  const sensitivity = [0, 0.2, 0.4, 0.6, 0.8, 1].map(q => ({ discordance: q, trueDifference: 0,
    power: nonInferiorityPower(n, margin, q), nullBoundaryDiscordance: Math.max(q, margin),
    nullBoundaryRejectionRate: nonInferiorityPower(n, margin, Math.max(q, margin), -margin) }))
  const planningPower = nonInferiorityPower(n, margin, planningDiscordance)
  let lo = 0, hi = 1 - 1e-10
  for (let i = 0; i < 35; i++) {
    const mid = (lo + hi) / 2
    if (nonInferiorityPower(n, mid, planningDiscordance) < NI_TARGET_POWER) lo = mid; else hi = mid
  }
  const zeroDiscordanceInterval = pairedRiskDifference(n, 0, 0, margin)
  const minimumSeeds = minimumPairedSeeds(margin), exactBound = zeroDiscordanceBound(n)
  return { version: 2, generatedAt: new Date().toISOString(), issuedModelCalls: 0, pairedSeeds: n,
    margin, confidenceLevel: 0.95, oneSidedAlpha: 0.025, targetPower: NI_TARGET_POWER,
    test: NI_METHOD, source: NI_SOURCE,
    minimumPossibleP: superiority.bestCasePValue, alphaAttainable: superiority.maximumPowerAtThisN === 1,
    alphaAttainabilityStatement: superiority.maximumPowerAtThisN === 1 ? '该 n 下双侧精确 McNemar 的 α=0.05 可达。'
      : '该 n 下任何效应都不可达双侧精确 McNemar 的 α=0.05。',
    mcNemarDiagnostic: { ...superiority, use: 'Design diagnostic only; never used to support mechanism removal.' },
    bestCaseSampleSize: { method: 'Clopper-Pearson one-sided 95% zero-discordance planning bound',
      alpha: 0.05, minimumSeeds, selectedSeeds: n, discordanceReserve: n - minimumSeeds,
      zeroDiscordanceUpperBound: exactBound, marginDistinguishable: exactBound < margin,
      suggestedSeeds: [minimumSeeds + 2, minimumSeeds + 4],
      caveat: 'Best case only. The registered paired score interval can require more seeds; discordant pairs can widen it. This bound is not substituted for the reported score interval.' },
    costAxis: { role: 'primary', population: 'all registered runs including failures',
      interval: 'Student-t-95% on paired adaptive-minus-ablation costs',
      normalApproximationMdeInPairedStandardDeviations: (NI_Z95 + 0.8416212335729143) / Math.sqrt(n),
      caveat: 'Normal-approximation design diagnostic at 80% power, not observed power. No unconditional claim of good power at n=12: paired cost variance is unknown.' },
    nonInferiority: { definition: zeroDiscordanceInterval.definition, criterion: zeroDiscordanceInterval.criterion,
      planningAlternative: { trueDifference: 0, discordance: planningDiscordance,
        assumption: `No true completion loss; q=${planningDiscordance} is a stated planning scenario, not an estimate from five historical seeds. q=1 is deliberately demanding.` },
      power: planningPower, marginDistinguishable: zeroDiscordanceInterval.nonInferiorityPassed,
      targetPowerReached: planningPower >= NI_TARGET_POWER,
      minimumDetectableMarginAt80Power: hi, minimumDetectableMarginPercentagePoints: hi * 100,
      zeroDiscordanceInterval, sensitivity,
      caveat: 'Power is an exact enumeration of the nominal score decision rule, not a claim that its finite-sample size is exact. Null-boundary rejection rates are reported by scenario.' },
    readyToRun: n >= minimumSeeds && exactBound < margin && zeroDiscordanceInterval.nonInferiorityPassed,
    lowPowerAcknowledgementRequired: planningPower < NI_TARGET_POWER,
    causalClaim: false, benefitClaim: 'not-claimed' }
}
