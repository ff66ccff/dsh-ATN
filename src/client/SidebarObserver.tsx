/** Optional-provider adapter owns reactive session/locale seats, never the pure view. */
import { useSyncExternalStore } from 'react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { ObserverHost, type NetworkActionInjected } from './NetworkAction.tsx'
import type { Translate } from './NetworkView.tsx'

interface Source<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
export interface SidebarObserverProps extends NetworkActionInjected {
  sessionId: string
  visible: boolean
  sessions: Source<SessionListState>
  locale: Source<object>
  t: Translate
}
export function SidebarObserver({ sessionId, visible, sessions, locale, ...props }: SidebarObserverProps) {
  const sessionState = useSyncExternalStore(listener => sessions.subscribe(listener), () => sessions.getSnapshot())
  useSyncExternalStore(listener => locale.subscribe(listener), () => locale.getSnapshot())
  const isAtn = Object.entries(sessionState.byId).some(([id, summary]) =>
    id === sessionId && summary.projectionValues?.agentPreset === 'atn')
  return isAtn ? <ObserverHost {...props} sessionId={sessionId} visible={visible} /> : null
}
