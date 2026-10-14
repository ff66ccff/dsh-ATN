/** Session gate and transport lifetime; the shared view receives only props. */
import { useEffect, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { AtnObserverSnapshot } from '../observer-types.ts'
import { NS } from './locales.ts'
import { NetworkView, type Translate } from './NetworkView.tsx'

export interface NetworkActionInjected {
  readSnapshot: (sessionId: string, signal: AbortSignal) => Promise<AtnObserverSnapshot>
}
export type NetworkActionProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS> & NetworkActionInjected

export function NetworkAction(props: NetworkActionProps) {
  const isAtn = props.useSessions(state => state.byId[props.sessionId]?.projectionValues?.agentPreset === 'atn')
  return isAtn ? <HeaderObserver {...props} /> : null
}

function HeaderObserver({ sessionId, readSnapshot, t }: NetworkActionProps) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="atn-trigger" aria-label={t('trigger')} title={t('trigger')}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>{t('trigger')}</button>
    <Modal open={open} onClose={() => setOpen(false)} title={t('title')} className="atn-modal" headless>
      <button type="button" className="atn-close" aria-label={t('close')} onClick={() => setOpen(false)}>×</button>
      <ObserverHost sessionId={sessionId} readSnapshot={readSnapshot} t={t} visible={open} />
    </Modal>
  </>
}

export interface ObserverHostProps extends NetworkActionInjected { sessionId: string; visible: boolean; t: Translate }
/** Both carriers share serial, cancellable, visible-only polling. */
export function ObserverHost({ sessionId, visible, readSnapshot, t }: ObserverHostProps) {
  const [retry, setRetry] = useState(0)
  const [observation, setObservation] = useState<{ sessionId: string; snapshot: AtnObserverSnapshot | null; error: string | null }>({ sessionId, snapshot: null, error: null })
  const [selection, setSelection] = useState<{ sessionId: string; nodeId: string | null }>({ sessionId, nodeId: null })
  useEffect(() => {
    if (!visible) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: AbortController | undefined
    setObservation(previous => previous.sessionId === sessionId ? { ...previous, error: null } : { sessionId, snapshot: null, error: null })
    const poll = async (): Promise<void> => {
      pending = new AbortController()
      try {
        const snapshot = await readSnapshot(sessionId, pending.signal)
        if (!disposed) setObservation({ sessionId, snapshot, error: null })
      } catch (reason) {
        if (!disposed) setObservation(previous => ({ sessionId, snapshot: previous.sessionId === sessionId ? previous.snapshot : null,
          error: reason instanceof Error ? reason.message : String(reason) }))
      } finally {
        if (!disposed) timer = setTimeout(() => { void poll() }, 1000)
      }
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer); pending?.abort() }
  }, [visible, sessionId, readSnapshot, retry])
  return <NetworkView sessionId={sessionId} t={t}
    snapshot={observation.sessionId === sessionId ? observation.snapshot : null}
    error={observation.sessionId === sessionId ? observation.error : null}
    selectedId={selection.sessionId === sessionId ? selection.nodeId : null}
    selectNode={nodeId => setSelection({ sessionId, nodeId })} retry={() => setRetry(value => value + 1)} />
}
