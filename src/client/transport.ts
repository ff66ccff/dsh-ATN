/** The observer uses the existing authenticated Web/Desktop Gateway carrier. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { atnObserverSnapshotSchema } from '../observer-schema.ts'
import type { AtnObserverSnapshot } from '../observer-types.ts'

export const transportInject = ['connection']

/** Capture the owning service before callbacks run on React's event stack. */
export function createSnapshotReader(ctx: Context): (sessionId: string, signal: AbortSignal) => Promise<AtnObserverSnapshot> {
  const connection = ctx.get('connection') as ConnectionHandle
  return async (sessionId, signal) => {
    signal.throwIfAborted()
    const result = await connection.rpc.call('/api', 'atnObserver/snapshot', { args: { sessionId } }, signal)
    signal.throwIfAborted()
    if (!result.ok) throw new Error(result.error.message)
    return atnObserverSnapshotSchema.parse(result.value)
  }
}
