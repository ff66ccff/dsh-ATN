/** Descriptive intervals and pre-specified paired tests, never capability thresholds. */
const Z95 = 1.959963984540054
const TARGET_POWER = 0.8
const ALPHA = 0.05
export const SMALL_SAMPLE_CAUTION = '在 n=5 下，约 60 个百分点以下的效果不可靠区分；这不是一个可通过的能力闸门。'

function binomialProbability(n: number, k: number, p: number) {
  let choose = 1
  for (let i = 1; i <= k; i++) choose *= (n - i + 1) / i
  return choose * p ** k * (1 - p) ** (n - k)
}

/** Optimistic paired power: all discordance is in the proposed direction. */
export function completionPower(n: number) {
  const minimumDiscordantPairs = Math.ceil(Math.log2(2 / ALPHA))
  const bestCasePValue = n ? Math.min(1, 2 ** (1 - n)) : null
  const attainable = n >= minimumDiscordantPairs
  let mde: number | null = null
  if (attainable) {
    let lo = 0, hi = 1
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      let power = 0
      for (let k = minimumDiscordantPairs; k <= n; k++) power += binomialProbability(n, k, mid)
      if (power < TARGET_POWER) lo = mid; else hi = mid
    }
    mde = hi
  }
  return { method: 'two-sided-exact-McNemar', pairedSeeds: n, alpha: ALPHA, targetPower: TARGET_POWER,
    minimumDetectableEffect: mde, minimumDetectableEffectPercentagePoints: mde === null ? null : mde * 100,
    status: attainable ? 'optimistic-lower-bound' : 'unattainable-even-at-100-percentage-points',
    assumptions: 'All discordant pairs favor the same arm. Opposite discordance and multiplicity can only reduce power. This is a design calculation, not observed post-hoc power.',
    bestCasePValue, maximumPowerAtThisN: attainable ? 1 : 0,
    caution: SMALL_SAMPLE_CAUTION,
    statement: attainable ? 'The optimistic minimum detectable effect is a lower bound under the stated paired alternative.'
      : 'Five paired seeds cannot reject any completion difference at two-sided alpha=0.05: even 5 versus 0 discordances gives p=0.0625. No effect within [0,100] percentage points reaches 80% power.' }
}

export function completionInterval(successes: number, n: number) {
  if (!Number.isSafeInteger(n) || n < 0 || !Number.isSafeInteger(successes) || successes < 0 || successes > n) throw new Error('Invalid binomial counts')
  if (!n) return { successes, n, estimate: null, interval: null, method: 'Wilson-95%', power: completionPower(n) }
  const p = successes / n, z2 = Z95 ** 2, denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const half = Z95 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n ** 2)) / denominator
  return { successes, n, estimate: p, interval: { lower: Math.max(0, center - half), upper: Math.min(1, center + half) },
    method: 'Wilson-95%', power: completionPower(n) }
}

// Lanczos log-gamma and continued-fraction beta give t quantiles without a runtime dependency.
function logGamma(z: number): number {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z)
  z -= 1
  let x = 0.99999999999980993
  for (let i = 0; i < coefficients.length; i++) x += coefficients[i] / (z + i + 1)
  const t = z + coefficients.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}
function betaFraction(a: number, b: number, x: number) {
  const tiny = 1e-300
  let c = 1, d = 1 - (a + b) * x / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m <= 200; m++) {
    for (const coefficient of [m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m)),
      -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))]) {
      d = 1 + coefficient * d; if (Math.abs(d) < tiny) d = tiny
      c = 1 + coefficient / c; if (Math.abs(c) < tiny) c = tiny
      d = 1 / d; h *= d * c
    }
    if (Math.abs(d * c - 1) < 3e-14) break
  }
  return h
}
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x))
  return x < (a + 1) / (a + b + 2) ? factor * betaFraction(a, b, x) / a : 1 - factor * betaFraction(b, a, 1 - x) / b
}
export function studentT95(df: number) {
  if (!Number.isSafeInteger(df) || df < 1) throw new Error('Positive t degrees of freedom required')
  let lo = 0, hi = 1
  const tail = (t: number) => regularizedBeta(df / (df + t * t), df / 2, 0.5) / 2
  while (tail(hi) > 0.025) hi *= 2
  for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (tail(mid) > 0.025) lo = mid; else hi = mid }
  return (lo + hi) / 2
}

export function meanInterval(values: readonly (number | null | undefined)[]) {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const n = known.length, mean = n ? known.reduce((a, b) => a + b, 0) / n : null
  const variance = n > 1 ? known.reduce((sum, value) => sum + (value - mean!) ** 2, 0) / (n - 1) : null
  const half = variance === null ? null : studentT95(n - 1) * Math.sqrt(variance / n)
  return { observedRuns: values.length, knownRuns: n, unknownRuns: values.length - n, mean,
    interval: half === null ? null : { lower: mean! - half, upper: mean! + half }, method: 'Student-t-95%',
    totalKnown: n ? known.reduce((a, b) => a + b, 0) : null,
    status: !n ? 'no-known-observations' : n === 1 ? 'one-observation-no-estimable-interval' : 'estimated',
    assumptions: 'Independent seeds and approximately normal run means; descriptive at small n. Success-only statistics are conditional on completion, not an unconditional speed advantage. Unknown measurements are excluded with coverage, never set to zero.' }
}

export function exactMcNemar(aOnly: number, bOnly: number) {
  const n = aOnly + bOnly
  if (!n) return 1
  let tail = 0
  for (let k = 0; k <= Math.min(aOnly, bOnly); k++) tail += binomialProbability(n, k, 0.5)
  return Math.min(1, 2 * tail)
}

export function holmAdjusted(pValues: readonly number[]) {
  const ordered = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p)
  const result: number[] = [], length = ordered.length
  let previous = 0
  ordered.forEach(({ p, i }, rank) => { previous = Math.max(previous, Math.min(1, p * (length - rank))); result[i] = previous })
  return result
}
