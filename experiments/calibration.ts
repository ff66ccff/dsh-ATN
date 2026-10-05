/** Measured cost is a prerequisite for the main experiment, never an invented estimate. */
export interface CalibrationKey {
  model: string; task: string; maxAgents: number; perNodeSteps: number; maxOutputTokens: number
  recoveryMode: 'self-organized' | 'preassigned-backup'
}
export interface CalibrationSample {
  runId: string
  mode: string
  model: string
  task: string
  calibration: boolean
  limits: CalibrationKey & { observedTokenLimit: number | null }
  stopReason: string
  evaluation: { passed: boolean }
  maxTokenTruncations?: number
  metrics: { totals: { tokens: { totalTokens: { known: number; unknownCalls: number } } } } | null
}

export function calibratedTokenLimit(samples: readonly CalibrationSample[], key: CalibrationKey) {
  const pair = ['atn-no-rewire', 'atn-adaptive'].map(mode => {
    const expectedMode = key.recoveryMode === 'preassigned-backup' ? `${mode}-preassigned-backup` : mode
    const matches = samples.filter(sample => sample != null && sample.mode === expectedMode && sample.calibration === true
      && sample.limits?.observedTokenLimit === null && sample.model === key.model && sample.task === key.task
      && Object.entries(key).every(([name, value]) => sample.limits[name as keyof CalibrationKey] === value))
    if (!matches.length) throw new Error(`Missing matching unlimited-token calibration for ${mode}`)
    for (const sample of matches) {
      const tokens = sample.metrics?.totals.tokens.totalTokens
      if (sample.evaluation?.passed !== true || (sample.maxTokenTruncations ?? 0) !== 0 || !['submitted', 'final-text'].includes(sample.stopReason)
        || !tokens || tokens.unknownCalls !== 0 || !Number.isSafeInteger(tokens.known) || tokens.known <= 0) {
        throw new Error('Calibration must complete successfully with fully observed token usage; retain failed samples and repair the protocol first')
      }
    }
    return matches
  }).flat()
  const observedTokenLimit = Math.max(...pair.map(sample => sample.metrics!.totals.tokens.totalTokens.known)) * 2
  if (!Number.isSafeInteger(observedTokenLimit)) throw new Error('Invalid calibrated token threshold')
  return { observedTokenLimit, multiplier: 2, sourceRuns: pair.map(sample => sample.runId) }
}
