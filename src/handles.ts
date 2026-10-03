/** Session-scoped disposal tracking. Returned outcomes are immutable snapshots. */
export type HandleReleaseStatus = 'pending' | 'released' | 'failed' | 'timed-out'
export interface HandleReleaseOutcome {
  readonly nodeId: string
  readonly sessionId: string
  readonly status: HandleReleaseStatus
  readonly reason: string | null
}
export interface HandleReleaseRecord extends HandleReleaseOutcome {
  readonly settled: Promise<void>
}
/** A session has one disposal operation, even after a caller's wait times out. */
export class HandleReleaser {
  private readonly records = new Map<string, HandleReleaseRecord>()
  constructor(readonly cleanupTimeoutMs: number) {}
  begin(nodeId: string, sessionId: string, dispose: () => Promise<void>): HandleReleaseRecord {
    const existing = this.records.get(sessionId)
    if (existing !== undefined) return existing
    const settled = Promise.resolve().then(dispose).then(
      () => this.complete(sessionId, 'released', null),
      (error: unknown) => this.complete(sessionId, 'failed', `dispose failed: ${error instanceof Error ? error.message : String(error)}`),
    )
    const record = { nodeId, sessionId, status: 'pending' as const, reason: null, settled }
    this.records.set(sessionId, record)
    return record
  }
  private complete(sessionId: string, status: 'released' | 'failed', reason: string | null): void {
    const current = this.records.get(sessionId)!
    // Late settlement updates live state, not previously returned snapshots.
    this.records.set(sessionId, { ...current, status, reason })
  }
  async settle(sessionIds?: ReadonlySet<string>, timeoutMs = this.cleanupTimeoutMs): Promise<HandleReleaseOutcome[]> {
    const pending = [...this.records.values()].filter(record =>
      (sessionIds === undefined || sessionIds.has(record.sessionId)) &&
      (record.status === 'pending' || record.status === 'timed-out'),
    )
    if (pending.length > 0) {
      await waitBounded(Promise.all(pending.map(record => record.settled)), timeoutMs)
      for (const record of pending) {
        const current = this.records.get(record.sessionId)!
        if (current.status === 'pending') {
          this.records.set(record.sessionId, {
            ...current, status: 'timed-out', reason: `dispose did not settle inside ${timeoutMs}ms`,
          })
        }
      }
    }
    return this.outcomes(sessionIds)
  }
  maintain(sessionIds?: ReadonlySet<string>): HandleReleaseOutcome[] { return this.outcomes(sessionIds) }
  outcomes(sessionIds?: ReadonlySet<string>): HandleReleaseOutcome[] {
    return [...this.records.values()]
      .filter(record => sessionIds === undefined || sessionIds.has(record.sessionId))
      .map(({ nodeId, sessionId, status, reason }) => ({ nodeId, sessionId, status, reason }))
  }
  isReleased(sessionId: string): boolean { return this.records.get(sessionId)?.status === 'released' }
  recordFor(sessionId: string): HandleReleaseRecord | undefined { return this.records.get(sessionId) }
}
/** A timeout bounds a wait; ownership of the underlying operation is retained. */
export async function waitBounded(work: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(resolve, Math.max(0, timeoutMs)) })])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
