/** Include every attempt, including oracle failures and budget exhaustion. */
export interface MeasurementRow {
  runId: string; model: string; mode: string; task: string
  evaluation: { passed: boolean }
  relativeMetrics: { relativeMessages: number; relativePayloadBytes: number } | null
  rewires: number
  stopReason: string
}

export function summarizeMeasurements(rows: readonly MeasurementRow[]) {
  const groups = new Map<string, MeasurementRow[]>()
  for (const row of rows) {
    const key = JSON.stringify([row.model, row.mode])
    groups.set(key, [...groups.get(key) ?? [], row])
  }
  return [...groups.values()].map(group => {
    const measured = group.flatMap(row => row.relativeMetrics ? [row.relativeMetrics] : [])
    return { model: group[0].model, mode: group[0].mode, attempts: group.length,
      passed: group.filter(row => row.evaluation.passed).length,
      answerPassRate: group.filter(row => row.evaluation.passed).length / group.length,
      meanRelativeMessages: measured.length ? measured.reduce((sum, row) => sum + row.relativeMessages, 0) / measured.length : null,
      meanRelativePayloadBytes: measured.length ? measured.reduce((sum, row) => sum + row.relativePayloadBytes, 0) / measured.length : null,
      measuredAttempts: measured.length,
      rewireOutcomes: group.map(row => ({ runId: row.runId, task: row.task, rewires: row.rewires,
        passed: row.evaluation.passed, stopReason: row.stopReason, relativeMetrics: row.relativeMetrics })),
      causalClaim: false, failurePolicy: 'All attempts retained; no replacements.' }
  })
}
