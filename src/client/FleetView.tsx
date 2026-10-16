/** Same read-only panel carrier, one explicit partition per authorized network. */
import { useEffect, useState } from 'react'
import type { AtnFleetSnapshot } from '../observer-schema.ts'
import type { Translate } from './NetworkView.tsx'
export interface FleetViewProps { snapshot: AtnFleetSnapshot | null; error: string | null; retry(): void; t: Translate }
export function FleetView({ snapshot, error, retry, t }: FleetViewProps) {
 return <section className="atn-shell" data-fleet-view aria-label={t('fleet')}>
  <header className="atn-head"><h2>{t('fleet')}</h2><p>{t('fleetHelp')}</p></header>
  {error && <div className="atn-error-banner" role="alert">{t(snapshot ? 'disconnected' : 'error')} <button className="atn-control" onClick={retry}>{t('retry')}</button></div>}
  {!snapshot ? <p className="atn-empty">{t(error ? 'error' : 'loading')}</p> : <div className="atn-scroll">
   {!snapshot.networks.length && <p className="atn-empty">{t('fleetEmpty')}</p>}
   {snapshot.networks.map(network => <section className="atn-node-list" data-fleet-network={network.id} key={network.id}>
    <h3>{network.id} <span className="atn-chip">{network.status}</span></h3>
    <dl className="atn-facts">
     <div><dt>{t('fleetHealth')}</dt><dd>{network.health ? `${network.health.activeNodes} / ${network.health.failedNodes}` : '—'}</dd></div>
     <div><dt>{t('totalSteps')}</dt><dd>{network.stepsUsed ?? '—'} · {t('nodeBudget')}: {network.stepBudget ?? '—'}</dd></div>
     <div><dt>{t('substrateMessages')}</dt><dd>{network.substrate ? `${network.substrate.messages} / ${network.substrate.maxMessages}` : '—'}</dd></div>
     <div><dt>UTF-8</dt><dd>{network.substrate ? `${network.substrate.bytes} / ${network.substrate.maxBytes}` : '—'}</dd></div>
     <div><dt>{t('refusals')}</dt><dd>{network.refusals.total}</dd></div>
    </dl>
    <p className="atn-muted">{Object.entries(network.refusals.buckets).filter(([, count]) => count > 0).map(([code, count]) => `${code}: ${count}`).join(' · ') || '0'}</p>
   </section>)}
   {snapshot.truncated && <p className="atn-muted">{t('fleetTruncated')}</p>}
  </div>}
  <footer className="atn-foot">{t('fleetVolatile')} · 65535 / {t('refusals')} <span>{t('readOnly')}</span></footer>
 </section>
}

export function FleetHost({ readFleet, visible, t }: { readFleet: (signal: AbortSignal) => Promise<AtnFleetSnapshot>; visible: boolean; t: Translate }) {
 const [state, setState] = useState<{ snapshot: AtnFleetSnapshot | null; error: string | null }>({ snapshot: null, error: null })
 const [retry, setRetry] = useState(0)
 useEffect(() => {
  if (!visible) return
  let disposed = false, timer: ReturnType<typeof setTimeout> | undefined, pending: AbortController | undefined
  const poll = async () => {
   pending = new AbortController()
   try {
    const snapshot = await readFleet(pending.signal)
    if (!disposed) setState({ snapshot, error: null })
   } catch (error) {
    if (!disposed) setState(previous => ({ ...previous, error: error instanceof Error ? error.message : String(error) }))
   } finally { if (!disposed) timer = setTimeout(() => { void poll() }, 1000) }
  }
  void poll()
  return () => { disposed = true; clearTimeout(timer); pending?.abort() }
 }, [readFleet, visible, retry])
 return <FleetView {...state} t={t} retry={() => setRetry(value => value + 1)} />
}
