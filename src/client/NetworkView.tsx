/** Pure operator presentation shared by the header and optional sidebar. */
import type { Translate as LocaleTranslate } from '@deepseek-ai/dsh-client-ui-slots'
import type { AtnNetworkView, AtnNodeView, AtnObserverSnapshot, AtnTaskView } from '../observer-types.ts'
import type { AtnKey } from './locales.ts'

export type Translate = LocaleTranslate<AtnKey>
export interface NetworkViewProps {
  sessionId: string
  snapshot: AtnObserverSnapshot | null
  error: string | null
  selectedId: string | null
  selectNode: (id: string) => void
  retry: () => void
  t: Translate
}

/** No transport, service access, subscription or local state enters this view. */
export function NetworkView({ sessionId, snapshot, error, selectedId, selectNode, retry, t }: NetworkViewProps) {
  const network = snapshot?.network
  const selected = network?.nodes.find(node => node.id === selectedId)
    ?? network?.nodes.find(node => node.sessionId === sessionId)
    ?? network?.nodes.find(node => node.id === network.entryNodeId)
  return <div className="atn-shell">
    <header className="atn-head"><h2>{t('title')}</h2><span className="atn-chip">{t('readOnly')}</span><p>{t('description')}</p></header>
    {error && <div role={snapshot ? 'status' : 'alert'} className="atn-error-banner">
      <span>{t(snapshot ? 'disconnected' : 'error')}</span>{!snapshot && <span>{error}</span>}
      <button type="button" className="atn-control" onClick={retry}>{t('retry')}</button>
    </div>}
    <div className="atn-scroll">
      {!snapshot && !error && <div className="atn-empty" role="status">{t('loading')}</div>}
      {snapshot && !network && <div className="atn-empty"><h3>{t('empty')}</h3><p>{t('emptyHelp')}</p></div>}
      {network && <>
        <Overview network={network} t={t} />
        {network.substrate && <section className="atn-relations atn-substrate" aria-label={t('substrate')}>
          <h3>{t('substrate')}</h3>
          <p>{t('substrateEpoch')} {network.substrate.epoch} · {network.substrate.capacity.messages} / {network.substrate.capacity.maxMessages} {t('substrateMessages')}
            {' · '}{network.substrate.capacity.bytes} / {network.substrate.capacity.maxBytes} UTF-8 bytes</p>
          <p className="atn-muted">{t('substrateMetrics')} {network.substrate.metrics.publishCalls} / {network.substrate.metrics.readCalls}
            {' · '}{network.substrate.metrics.publishedBytes} / {network.substrate.metrics.readBytes} UTF-8 bytes · {t('substrateNotBilling')}</p>
          <div className="atn-table-scroll"><table aria-label={t('substrateMessages')}><thead><tr>
            {[t('substrateAddress'),t('substrateTask'),t('createdBy'),t('substrateWeight'),t('substrateRefs')].map(label=><th key={label}>{label}</th>)}
          </tr></thead><tbody>{network.substrate.messages.map(message=><tr key={message.address}>
            <td>{message.address}</td><td>{message.sub_task}</td><td>{message.authorId}</td>
            <td>{message.weight === undefined ? '—' : `${message.weight} / 1000000`}</td>
            <td>{message.refCount} / {message.citerCount}</td>
          </tr>)}</tbody></table></div>
          {network.substrate.evidenceChains.length>0 && <><h4>{t('substrateEvidence')}</h4>{network.substrate.evidenceChains.map(chain=><p key={chain.taskId}>
            {chain.taskId}: {chain.addresses.join(' → ')}{chain.truncated && ` … (${chain.total})`}
          </p>)}</>}
        </section>}
        <NodeList network={network} selectedId={selected?.id ?? null} selectNode={selectNode} t={t} />
        <section className="atn-relations" aria-label={t('collaboration')}><h3>{t('collaboration')}</h3>
          <Edges network={network} kind="collaboration" selectNode={selectNode} t={t} /></section>
        <section className="atn-relations" aria-label={t('birth')}><h3>{t('birth')}</h3>
          <Edges network={network} kind="birth" selectNode={selectNode} t={t} /></section>
        <NodeDetails network={network} node={selected} currentSessionId={sessionId} selectNode={selectNode} t={t} />
        <section className="atn-relations" aria-label={t('orphans')}><h3>{t('orphans')}</h3><p className="atn-muted">{t('orphanHelp')}</p>
          {network.tasks.filter(task => ['failed', 'unreachable'].includes(task.status)
            && network.nodes.some(node => node.id === task.holderId && ['failed', 'retired'].includes(node.lifecycle)))
            .map(task => <p key={task.id}>{task.id} · {task.description}</p>)}</section>
        <Activity network={network} selectNode={selectNode} t={t} />
      </>}
    </div>
    <footer className="atn-foot"><span>{error ? t('disconnected') : snapshot ? t('live') : t('loading')}
      {snapshot && <> · {t('updated')} {time(snapshot.observedAt)}</>}</span><span>{t('noNetworkActivity')}</span></footer>
  </div>
}

function NodeList({ network, selectedId, selectNode, t }: {
  network: AtnNetworkView; selectedId: string | null; selectNode: (id: string) => void; t: Translate
}) {
  return <section className="atn-node-list" aria-label={t('showAll')}>
    <h3>{t('showAll')}</h3><p className="atn-muted">{t('fulfilmentHelp')}</p>
    <div className="atn-table-scroll"><table aria-label={t('showAll')}><thead><tr>
      {[t('nodes'), t('state'), t('tasks'), t('tool'), t('remaining'), t('peerQuota'), t('fulfilment')].map(label => <th key={label}>{label}</th>)}
    </tr></thead><tbody>{network.nodes.map(node => {
      const settled = network.tasks.filter(task => task.holderId === node.id && task.status !== 'open')
      return <tr key={node.id}>
        <td><button type="button" className="atn-link" aria-label={node.id} aria-pressed={node.id === selectedId}
          onClick={() => selectNode(node.id)}>{shortId(node.id)}</button>{node.isEntry && <span> · {t('entry')}</span>}</td>
        <td>{nodeState(node, t)}</td><td>{node.openTasks}</td><td>{node.currentTool ?? t('noTool')}</td>
        <td>{Math.max(0, network.stepBudget - node.stepsUsed)}</td>
        <td>{network.maxCollaborationPeers === undefined ? t('unknown') : Math.max(0, network.maxCollaborationPeers - node.peers.length)}</td>
        <td>{settled.length ? `${settled.filter(task => task.status === 'completed').length} / ${settled.length}` : t('noSamples')}</td>
      </tr>
    })}</tbody></table></div>
  </section>
}

function Edges({ network, kind, selectNode, t }: {
  network: AtnNetworkView; kind: 'collaboration' | 'birth'; selectNode: (id: string) => void; t: Translate
}) {
  const edges = network.edges.filter(edge => edge.kind === kind)
  return edges.length ? <ul>{edges.map(edge => <li key={`${edge.source}:${edge.target}`}>
    <button type="button" className="atn-link" onClick={() => selectNode(edge.source)}>{edge.source}</button>
    {' → '}<button type="button" className="atn-link" onClick={() => selectNode(edge.target)}>{edge.target}</button>
  </li>)}</ul> : <p>{t('noPeers')}</p>
}

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

