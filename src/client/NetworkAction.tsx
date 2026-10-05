/** Read-only header action and observer panel. Polling lives only while open. */
import { useEffect, useId, useMemo, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { AtnNetworkView, AtnNodeView, AtnObserverSnapshot, AtnTaskView } from '../observer-types.ts'
import { edgeLine, layoutNodes } from './layout.ts'
import { NS, type AtnKey } from './locales.ts'

/** Transport callback owned by the registration, with request cancellation. */
export interface NetworkActionInjected {
  readSnapshot: (sessionId: string, signal: AbortSignal) => Promise<AtnObserverSnapshot>
}

/** Header action props derived from the Harness session and locale seats. */
export type NetworkActionProps = PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS> & NetworkActionInjected

type Translate = TranslateNS<typeof NS>
type Observation = { sessionId: string; snapshot: AtnObserverSnapshot | null; error: string | null }

const lifecycleKeys: Record<string, AtnKey | undefined> = {
  active: 'lifecycleActive', provisioning: 'lifecycleProvisioning', draining: 'lifecycleDraining',
  retired: 'lifecycleRetired', failed: 'lifecycleFailed',
}
const taskKeys: Record<AtnTaskView['status'], AtnKey> = {
  open: 'taskOpen', completed: 'taskCompleted', failed: 'taskFailed', unreachable: 'taskUnreachable',
}

function shortId(id: string): string { return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id }
function time(at: number): string { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
function nodeState(node: AtnNodeView, t: Translate): string {
  if (node.lifecycle !== 'active') return lifecycleKeys[node.lifecycle] ? t(lifecycleKeys[node.lifecycle]!) : node.lifecycle
  return t(node.agentStatus === 'running' ? 'running' : node.agentStatus === 'unloaded' ? 'unloaded' : 'idle')
}
function NetworkIcon({ size = 15 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M12 5 5 18m7-13 7 13M5 18h14" /><circle cx="12" cy="5" r="3" /><circle cx="5" cy="18" r="3" /><circle cx="19" cy="18" r="3" />
  </svg>
}

/** Only ATN sessions mount the observer, including its dialog and polling lifetime. */
export function NetworkAction(props: NetworkActionProps) {
  const isAtn = props.useSessions(state => state.byId[props.sessionId]?.projectionValues?.agentPreset === 'atn')
  return isAtn ? <NetworkPanel {...props} /> : null
}

/** Render the ATN session header action. */
function NetworkPanel({ sessionId, readSnapshot, t }: NetworkActionProps) {
  const [open, setOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  const [observation, setObservation] = useState<Observation>({ sessionId, snapshot: null, error: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showBirth, setShowBirth] = useState(false)
  const [zoom, setZoom] = useState(1)
  const snapshot = observation.sessionId === sessionId ? observation.snapshot : null
  const error = observation.sessionId === sessionId ? observation.error : null
  const network = snapshot?.network ?? null

  useEffect(() => { setSelectedId(null); setZoom(1) }, [sessionId])

  useEffect(() => {
    if (!open) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let pending: AbortController | undefined
    setObservation(previous => previous.sessionId === sessionId
      ? { ...previous, error: null } : { sessionId, snapshot: null, error: null })
    const poll = async (): Promise<void> => {
      pending = new AbortController()
      try {
        const next = await readSnapshot(sessionId, pending.signal)
        if (!disposed) setObservation({ sessionId, snapshot: next, error: null })
      } catch (reason) {
        if (!disposed) setObservation(previous => ({
          sessionId, snapshot: previous.sessionId === sessionId ? previous.snapshot : null,
          error: reason instanceof Error ? reason.message : String(reason),
        }))
      } finally {
        // Scheduling after settlement prevents overlapping requests on slow hosts.
        if (!disposed) timer = setTimeout(() => { void poll() }, 1000)
      }
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer); pending?.abort() }
  }, [open, sessionId, readSnapshot, retry])

  const selected = network?.nodes.find(node => node.id === selectedId)
    ?? network?.nodes.find(node => node.sessionId === sessionId)
    ?? network?.nodes.find(node => node.id === network.entryNodeId)
  const selectNode = (id: string): void => { setSelectedId(id) }

  return <>
    <button type="button" className="atn-trigger" aria-label={t('trigger')} title={t('trigger')}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true) }}>
      <NetworkIcon /><span className="atn-trigger-label">{t('trigger')}</span>
    </button>
    <Modal open={open} onClose={() => { setOpen(false) }} title={t('title')} className="atn-modal" headless>
      <div className="atn-shell">
        <header className="atn-head">
          <div><div className="atn-heading"><NetworkIcon size={21} /><h2>{t('title')}</h2><span className="atn-chip">{t('readOnly')}</span></div><p>{t('description')}</p></div>
          <button type="button" className="atn-close" aria-label={t('close')} onClick={() => { setOpen(false) }}>×</button>
        </header>
        {error && snapshot && <div className="atn-error-banner" role="status"><span>{t('disconnected')}</span><button type="button" className="atn-control" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</button></div>}
        <div className="atn-scroll">
          {!snapshot && !error && <div className="atn-empty" role="status"><NetworkIcon size={34} /><h3>{t('loading')}</h3></div>}
          {!snapshot && error && <div className="atn-empty" role="alert"><h3>{t('error')}</h3><p>{error}</p><button type="button" className="atn-control" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</button></div>}
          {snapshot && !network && <div className="atn-empty"><NetworkIcon size={40} /><h3>{t('empty')}</h3><p>{t('emptyHelp')}</p></div>}
          {network && <>
            <Overview network={network} t={t} />
            <div className="atn-main">
              <div className="atn-graph-area">
                <div className="atn-toolbar">
                  <label><input type="checkbox" checked={showBirth} onChange={event => { setShowBirth(event.target.checked) }} />{t('birthEdges')}</label>
                  <div className="atn-tools"><button type="button" className="atn-control" aria-label={t('zoomOut')} onClick={() => { setZoom(value => Math.max(.5, value - .25)) }}>−</button><button type="button" className="atn-control" aria-label={t('zoomIn')} onClick={() => { setZoom(value => Math.min(2.5, value + .25)) }}>+</button><button type="button" className="atn-control" onClick={() => { setZoom(1); setSelectedId(null) }}>{t('reset')}</button></div>
                </div>
                <Topology network={network} selectedId={selected?.id ?? null} currentSessionId={sessionId} selectNode={selectNode} showBirth={showBirth} zoom={zoom} t={t} />
                <div className="atn-legend"><span><i className="atn-legend-line" />{t('collaboration')}</span>{showBirth && <span><i className="atn-legend-line atn-legend-birth" />{t('birth')}</span>}<span className="atn-live"><i className="atn-dot" />{t('running')}</span></div>
                <p className="atn-graph-help">{t('graphHelp')}</p>
              </div>
              <NodeDetails network={network} node={selected} currentSessionId={sessionId} selectNode={selectNode} t={t} />
            </div>
            <Activity network={network} selectNode={selectNode} t={t} />
          </>}
        </div>
        <footer className="atn-foot"><span className="atn-foot-status"><span className={error ? 'atn-warning' : snapshot ? 'atn-live' : ''}><i className="atn-dot" /> {error ? t('disconnected') : snapshot ? t('live') : t('loading')}</span>{snapshot && <span>{t('updated')} {time(snapshot.observedAt)}</span>}</span><span>{t('noNetworkActivity')}</span></footer>
      </div>
    </Modal>
  </>
}

function Overview({ network, t }: { network: AtnNetworkView; t: Translate }) {
  const metrics = [
    [t('nodes'), network.nodes.length], [t('connections'), network.edges.filter(edge => edge.kind === 'collaboration').length],
    [t('running'), network.nodes.filter(node => node.agentStatus === 'running').length], [t('tasks'), network.nodes.reduce((total, node) => total + node.openTasks, 0)],
  ] as const
  return <section className="atn-overview" aria-label={t('goal')}>
    <div className="atn-metrics">{metrics.map(([label, count]) => <div className="atn-metric" key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>
    <div className="atn-goal"><small>{t('goal')} · {t('revision')} {network.goalVersion} · {t(network.status === 'open' ? 'networkOpen' : network.status === 'completed' ? 'networkCompleted' : 'networkStopped')}</small><p>{network.objective}</p><small>{t('totalSteps')} {network.stepsUsed} · {t('nodeBudget')} {network.stepBudget} · {t('deadline')} {time(network.deadlineAt)}</small></div>
  </section>
}

function Topology({ network, selectedId, currentSessionId, selectNode, showBirth, zoom, t }: {
  network: AtnNetworkView; selectedId: string | null; currentSessionId: string; selectNode: (id: string) => void; showBirth: boolean; zoom: number; t: Translate
}) {
  const markerId = useId().replace(/:/g, '')
  const points = useMemo(() => layoutNodes(network.nodes, network.entryNodeId), [network.nodes, network.entryNodeId])
  const values = [...points.values()]
  const minX = Math.min(0, ...values.map(point => point.x - 80))
  const minY = Math.min(0, ...values.map(point => point.y - 65))
  const maxX = Math.max(840, ...values.map(point => point.x + 80))
  const maxY = Math.max(560, ...values.map(point => point.y + 65))
  const width = (maxX - minX) / zoom
  const height = (maxY - minY) / zoom
  const center = selectedId ? points.get(selectedId) : undefined
  const centerX = zoom > 1 && center ? center.x : (minX + maxX) / 2
  const centerY = zoom > 1 && center ? center.y : (minY + maxY) / 2
  return <svg className="atn-canvas" viewBox={`${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`} role="group" aria-label={t('graph')}>
    <defs><marker id={`${markerId}-peer`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path className="atn-arrow" d="M0 0 7 3.5 0 7z" /></marker><marker id={`${markerId}-birth`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path className="atn-arrow-birth" d="M0 0 7 3.5 0 7z" /></marker></defs>
    {network.edges.filter(edge => showBirth || edge.kind === 'collaboration').map(edge => {
      const source = points.get(edge.source)
      const target = points.get(edge.target)
      if (!source || !target) return null
      const selected = edge.source === selectedId || edge.target === selectedId
      const line = edgeLine(source, target)
      const length = Math.max(1, Math.hypot(target.x - source.x, target.y - source.y))
      const reciprocal = network.edges.some(other => other.kind === edge.kind && other.source === edge.target && other.target === edge.source)
      const bend = edge.kind === 'birth' ? -28 : reciprocal ? 22 : 0
      const cx = (source.x + target.x) / 2 - (target.y - source.y) * bend / length
      const cy = (source.y + target.y) / 2 + (target.x - source.x) * bend / length
      return <path key={`${edge.kind}:${edge.source}:${edge.target}`} fill="none"
        d={`M${line.x1},${line.y1} Q${cx},${cy} ${line.x2},${line.y2}`}
        data-atn-edge={`${edge.source}:${edge.target}`} data-atn-edge-kind={edge.kind}
        className={`atn-edge ${edge.kind === 'birth' ? 'atn-edge-birth' : ''} ${selected ? 'atn-edge-selected' : selectedId ? 'atn-edge-faded' : ''}`}
        markerEnd={`url(#${markerId}-${edge.kind === 'birth' ? 'birth' : 'peer'})`}><title>{edge.source} → {edge.target} · {t(edge.kind === 'birth' ? 'birth' : 'collaboration')}</title></path>
    })}
    {network.nodes.map((node, index) => {
      const position = points.get(node.id)
      if (!position) return null
      const label = node.isEntry ? t('entry') : `N${index + 1}`
      return <g key={node.id} transform={`translate(${position.x},${position.y})`} role="button" tabIndex={0}
        aria-label={`${label} · ${node.id} · ${nodeState(node, t)}`} aria-pressed={node.id === selectedId}
        className={`atn-node ${node.id === selectedId ? 'atn-node-selected' : ''} ${node.agentStatus === 'running' ? 'atn-node-running' : ''} ${node.lifecycle === 'failed' ? 'atn-node-failed' : ''} ${node.lifecycle === 'retired' ? 'atn-node-retired' : ''}`}
        onClick={() => { selectNode(node.id) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectNode(node.id) } }}>
        <title>{node.id}\n{nodeState(node, t)}{node.currentTool ? ` · ${node.currentTool}` : ''}\n{node.sessionId}</title>
        <circle className="atn-node-ring" r="26" /><circle className="atn-node-icon" cy="-6" r="6" /><path className="atn-node-icon" d="M-10 12v-3a10 10 0 0 1 20 0v3" /><circle className="atn-node-dot" cx="20" cy="-18" r="4" />
        <text y="46">{label}{node.sessionId === currentSessionId ? ` · ${t('current')}` : ''}</text><text className="atn-node-status" y="62">{nodeState(node, t)}</text>
      </g>
    })}
  </svg>
}

function NodeDetails({ network, node, currentSessionId, selectNode, t }: {
  network: AtnNetworkView; node: AtnNodeView | undefined; currentSessionId: string; selectNode: (id: string) => void; t: Translate
}) {
  if (!node) return <aside className="atn-details"><h3 className="atn-section-heading">{t('details')}</h3><p className="atn-muted">{t('selectNode')}</p></aside>
  const incoming = network.edges.filter(edge => edge.kind === 'collaboration' && edge.target === node.id).map(edge => edge.source)
  const tasks = network.tasks.filter(task => task.holderId === node.id || task.requesterId === node.id)
  const neighborLinks = (ids: string[], empty: AtnKey) => ids.length
    ? <div className="atn-neighbor-list">{ids.map(id => <button className="atn-link" type="button" key={id} title={id} onClick={() => { selectNode(id) }}>{shortId(id)}</button>)}</div>
    : <span className="atn-muted">{t(empty)}</span>
  return <aside className="atn-details" aria-label={t('details')}>
    <h3 className="atn-section-heading">{t('details')}</h3>
    <div className="atn-node-title"><strong title={node.id}>{shortId(node.id)}</strong>{node.isEntry && <span className="atn-chip">{t('entry')}</span>}{node.sessionId === currentSessionId && <span className="atn-chip">{t('current')}</span>}</div>
    <dl className="atn-facts"><div><dt>{t('state')}</dt><dd>{nodeState(node, t)}</dd></div><div><dt>{t('session')}</dt><dd className="atn-code">{node.sessionId}</dd></div><div><dt>{t('tool')}</dt><dd className={node.currentTool ? 'atn-code' : 'atn-muted'}>{node.currentTool ?? t('noTool')}</dd></div><div><dt>{t('createdBy')}</dt><dd>{node.creatorId ? neighborLinks([node.creatorId], 'entryOrigin') : t('entryOrigin')}</dd></div><div><dt>{t('tasks')}</dt><dd>{node.openTasks}</dd></div><div><dt>{t('steps')}</dt><dd>{node.stepsUsed} / {network.stepBudget}</dd></div><div><dt>{t('pendingVotes')}</dt><dd>{node.pendingVotes}</dd></div></dl>
    <section className="atn-neighbors"><h4>{t('peers')} →</h4>{neighborLinks(node.peers, 'noPeers')}</section>
    <section className="atn-neighbors"><h4>{t('incoming')} →</h4>{neighborLinks(incoming, 'noIncoming')}</section>
    <section className="atn-neighbors"><h4>{t('nodeTasks')}</h4>{network.tasks.length >= 200 && <p className="atn-muted">{t('taskWindow')}</p>}{tasks.length ? tasks.map(task => <article className="atn-task" key={task.id}>
      <div className="atn-task-head"><span className="atn-code" title={task.id}>{shortId(task.id)}</span><span className={task.status === 'failed' || task.status === 'unreachable' ? 'atn-error' : task.status === 'completed' ? 'atn-live' : ''}>{t(taskKeys[task.status])}</span></div>
      <p>{task.description}</p><small>{t('requester')} {shortId(task.requesterId)} → {t('holder')} {shortId(task.holderId)}</small>
      {task.summary !== null && <p className="atn-task-result"><small>{t('result')}</small><br />{task.summary}</p>}
    </article>) : <p className="atn-muted">{t('noTasks')}</p>}</section>
  </aside>
}

function Activity({ network, selectNode, t }: { network: AtnNetworkView; selectNode: (id: string) => void; t: Translate }) {
  const events = [...network.events].sort((a, b) => b.at - a.at).slice(0, 60)
  return <section className="atn-feed" aria-label={t('activity')}>
    <h3 className="atn-section-heading"><span>{t('activity')}</span><small className="atn-muted">{t('bounded')}</small></h3>
    {events.length ? <ol className="atn-feed-list">{events.map(event => <li className="atn-event" key={event.id}>
      <time dateTime={new Date(event.at).toISOString()}>{time(event.at)}</time><span className="atn-event-kind">{event.kind}</span><div className="atn-event-body"><button type="button" className="atn-link" title={event.nodeId} onClick={() => { selectNode(event.nodeId) }}>{shortId(event.nodeId)}</button>{event.targetId && <span className="atn-muted">→ {shortId(event.targetId)} · </span>}{event.summary}</div>
    </li>)}</ol> : <p className="atn-muted">{t('noActivity')}</p>}
  </section>
}
