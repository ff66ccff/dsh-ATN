/** Additive timing for new probes; the archived telemetry module is untouched.
 * Legacy modelDurationMs sums settled llm/stream attempt lifetimes, including
 * queueing and cleanup. Summing concurrent lifetimes can exceed wall time.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

export interface ProbeTimingAttempt {
  id: number; session: string; enteredAt: number; dispatchAt: number | null
  providerSettledAt: number | null; settledAt: number | null
  queueMs: number | null; serviceMs: number | null; cleanupMs: number | null; totalMs: number | null
  status: string; associated: boolean
}

export function createProbeTiming(now: () => number = Date.now) {
  const attempts: ProbeTimingAttempt[] = []
  function install(ctx: Context) {
    return ctx.on('llm/stream', (request, next) => (async function* () {
      const row: ProbeTimingAttempt = { id: attempts.length + 1, session: String(request.sessionId ?? 'unattributed'),
        enteredAt: now(), dispatchAt: null, providerSettledAt: null, settledAt: null,
        queueMs: null, serviceMs: null, cleanupMs: null, totalMs: null, status: 'incomplete', associated: false }
      attempts.push(row)
      try {
        for await (const chunk of next()) {
          if (chunk.type === 'finish') row.status = chunk.reason.kind
          yield chunk
        }
      } catch (error) {
        row.status = request.signal?.aborted ? 'aborted' : 'error'
        throw error
      } finally {
        row.settledAt = now()
        row.totalMs = row.settledAt - row.enteredAt
        row.queueMs = (row.dispatchAt ?? row.settledAt) - row.enteredAt
        row.serviceMs = row.dispatchAt === null ? 0 : (row.providerSettledAt ?? row.settledAt) - row.dispatchAt
        row.cleanupMs = row.dispatchAt === null ? 0 : row.settledAt - (row.providerSettledAt ?? row.settledAt)
      }
    })(), { global: true, prepend: true })
  }
  function associate(options: GenerateOptions) {
    const row = attempts.find(row => row.session === String(options.sessionId ?? 'unattributed') && !row.associated && row.settledAt === null)
    if (!row) throw new Error('Provider stream has no observed kernel attempt')
    row.associated = true
    return row
  }
  return { install, associate, now, snapshot: () => structuredClone(attempts) }
}

/** Abortable FIFO pool. A queued cancellation never dispatches to the provider. */
export function createProbeDispatcher(concurrency: number, timing: ReturnType<typeof createProbeTiming>) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('Positive integer concurrency required')
  let active = 0
  const waiting: Array<() => void> = []
  const acquire = (signal?: AbortSignal): Promise<() => void> => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return }
    const abort = () => {
      const index = waiting.indexOf(start)
      if (index >= 0) waiting.splice(index, 1)
      reject(signal?.reason)
    }
    const start = () => {
      signal?.removeEventListener('abort', abort)
      active++
      let released = false
      resolve(() => {
        if (released) return
        released = true; active--
        waiting.shift()?.()
      })
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (active < concurrency) start()
    else waiting.push(start)
  })
  return {
    async *stream(options: GenerateOptions, provider: () => AsyncIterable<StreamChunk>, prepare?: () => Promise<void>): AsyncIterable<StreamChunk> {
      const row = timing.associate(options)
      const release = await acquire(options.signal)
      try {
        options.signal?.throwIfAborted()
        await prepare?.()
        options.signal?.throwIfAborted()
        row.dispatchAt = timing.now()
        yield* provider()
      } finally {
        row.providerSettledAt = timing.now()
        release()
      }
    },
  }
}
