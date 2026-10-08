import * as React from 'react'
import { useState, useId, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { zh } from '../src/client/locales.ts'
import { edgeLine, layoutNodes } from '../src/client/layout.ts'
import type { AtnNetworkView, AtnNodeView, AtnObserverSnapshot, AtnTaskView } from '../src/observer-types.ts'

;(window as any).React = React

const t = (key: keyof typeof zh) => zh[key] ?? key

const mockSnapshot: AtnObserverSnapshot = {
  observedAt: 1760000000000,
  network: {
    id: 'net-atn-2026-audit',
    status: 'open',
    entryNodeId: 'node-root',
    goalVersion: 3,
    objective: '全面核对 docs/ 下 13 条出站通道安全保管策略，完成分片查证并汇聚最终合规证据链',
    stepsUsed: 28,
    stepBudget: 64,
    deadlineAt: 1760003600000,
    nodes: [
      {
        id: 'node-root',
        sessionId: 'session-entry-01',
        isEntry: true,
        creatorId: null,
        lifecycle: 'active',
        agentStatus: 'idle',
        peers: ['node-sec-audit', 'node-topo-sync'],
        stepsUsed: 6,
        openTasks: 1,
        pendingVotes: 0,
        currentTool: null,
      },
      {
        id: 'node-sec-audit',
        sessionId: 'session-worker-audit',
        isEntry: false,
        creatorId: 'node-root',
        lifecycle: 'active',
        agentStatus: 'running',
        peers: ['node-root', 'node-shard-03'],
        stepsUsed: 14,
        openTasks: 2,
        pendingVotes: 0,
        currentTool: 'tool_check_claims',
      },
      {
        id: 'node-topo-sync',
        sessionId: 'session-worker-topo',
        isEntry: false,
        creatorId: 'node-root',
        lifecycle: 'active',
        agentStatus: 'idle',
        peers: ['node-root', 'node-sec-audit'],
        stepsUsed: 8,
        openTasks: 0,
        pendingVotes: 0,
        currentTool: null,
      },
      {
        id: 'node-shard-03',
        sessionId: 'session-worker-shard',
        isEntry: false,
        creatorId: 'node-sec-audit',
        lifecycle: 'active',
        agentStatus: 'running',
        peers: ['node-sec-audit'],
        stepsUsed: 12,
        openTasks: 2,
        pendingVotes: 0,
        currentTool: 'pwsh',
      },
      {
        id: 'node-retired-worker',
        sessionId: 'session-worker-old',
        isEntry: false,
        creatorId: 'node-root',
        lifecycle: 'retired',
        agentStatus: 'unloaded',
        peers: [],
        stepsUsed: 32,
        openTasks: 0,
        pendingVotes: 0,
        currentTool: null,
      },
    ],
    edges: [
      { source: 'node-root', target: 'node-sec-audit', kind: 'collaboration' },
      { source: 'node-sec-audit', target: 'node-root', kind: 'collaboration' },
      { source: 'node-root', target: 'node-topo-sync', kind: 'collaboration' },
      { source: 'node-topo-sync', target: 'node-root', kind: 'collaboration' },
      { source: 'node-sec-audit', target: 'node-shard-03', kind: 'collaboration' },
      { source: 'node-shard-03', target: 'node-sec-audit', kind: 'collaboration' },
      { source: 'node-root', target: 'node-sec-audit', kind: 'birth' },
      { source: 'node-root', target: 'node-topo-sync', kind: 'birth' },
      { source: 'node-sec-audit', target: 'node-shard-03', kind: 'birth' },
      { source: 'node-root', target: 'node-retired-worker', kind: 'birth' },
    ],
    tasks: [
      {
        id: 'task-101',
        holderId: 'node-sec-audit',
        requesterId: 'node-root',
        description: '核对 13 条出站通道的 defineCustodyPolicy 拦截与原子事务性',
        status: 'completed',
        summary: '全通道策略均已通过原子拦截验证，未出现脏写或未授权证据提交 [code: evidence-not-owned]',
        createdAt: 1760000000000 - 450000,
        settledAt: 1760000000000 - 200000,
      },
      {
        id: 'task-102',
        holderId: 'node-sec-audit',
        requesterId: 'node-root',
        description: '验证 review.summary 历史漏洞修复与红灯测试留档一致性',
        status: 'completed',
        summary: '修复前失败记录已归档，当前版本对 review 自由文本实现了精确策略约束',
        createdAt: 1760000000000 - 300000,
        settledAt: 1760000000000 - 100000,
      },
      {
        id: 'task-103',
        holderId: 'node-shard-03',
        requesterId: 'node-sec-audit',
        description: '分片 03 数据结构校验与未授权字段拦截测试',
        status: 'open',
        summary: null,
        createdAt: 1760000000000 - 80000,
        settledAt: null,
      },
      {
        id: 'task-104',
        holderId: 'node-root',
        requesterId: 'node-root',
        description: '汇聚全局证据链，准备生成形式化隔离审计报告',
        status: 'open',
        summary: null,
        createdAt: 1760000000000 - 50000,
        settledAt: null,
      },
    ],
    events: [
      {
        id: 'ev-1',
        kind: 'send.result',
        at: 1760000000000 - 100000,
        nodeId: 'node-sec-audit',
        targetId: 'node-root',
        taskId: 'task-102',
        summary: '交付成果：已确认 review.summary 违规拦截有效 [evidence-not-owned]',
      },
      {
        id: 'ev-2',
        kind: 'status.rewire',
        at: 1760000000000 - 140000,
        nodeId: 'node-sec-audit',
        targetId: null,
        taskId: null,
        summary: '自主换边：与 node-shard-03 建立协作边以查证深层分片',
      },
      {
        id: 'ev-3',
        kind: 'send.task',
        at: 1760000000000 - 180000,
        nodeId: 'node-sec-audit',
        targetId: 'node-shard-03',
        taskId: 'task-103',
        summary: '下发子任务：核对分片 03 数据结构与字段约束',
      },
      {
        id: 'ev-4',
        kind: 'finish.node',
        at: 1760000000000 - 250000,
        nodeId: 'node-retired-worker',
        targetId: null,
        taskId: null,
        summary: '节点两阶段优雅退休：步数预算耗尽，清算在途任务后平滑释放资源',
      },
      {
        id: 'ev-5',
        kind: 'spawn',
        at: 1760000000000 - 400000,
        nodeId: 'node-root',
        targetId: 'node-sec-audit',
        taskId: 'task-101',
        summary: '创建新工作节点并挂载初始审查任务',
      },
    ],
  },
}

function shortId(id: string): string { return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-5)}` : id }
function time(at: number): string { return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }
function nodeState(node: AtnNodeView): string {
  if (node.lifecycle !== 'active') return t(node.lifecycle === 'retired' ? 'lifecycleRetired' : 'lifecycleFailed')
  return t(node.agentStatus === 'running' ? 'running' : 'idle')
}

function NetworkIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M12 5 5 18m7-13 7 13M5 18h14" />
      <circle cx="12" cy="5" r="3" />
      <circle cx="5" cy="18" r="3" />
      <circle cx="19" cy="18" r="3" />
    </svg>
  )
}

function Overview({ network }: { network: AtnNetworkView }) {
  const metrics = [
    [t('nodes'), network.nodes.length],
    [t('connections'), network.edges.filter(e => e.kind === 'collaboration').length],
    [t('running'), network.nodes.filter(n => n.agentStatus === 'running').length],
    [t('tasks'), network.nodes.reduce((acc, n) => acc + n.openTasks, 0)],
  ] as const
  return (
    <section className="atn-overview" aria-label={t('goal')}>
      <div className="atn-metrics">
        {metrics.map(([label, count]) => (
          <div className="atn-metric" key={label}>
            <strong>{count}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="atn-goal">
        <small>{t('goal')} · {t('revision')} {network.goalVersion} · {t('networkOpen')}</small>
        <p>{network.objective}</p>
        <small>{t('totalSteps')} {network.stepsUsed} · {t('nodeBudget')} {network.stepBudget} · {t('deadline')} {time(network.deadlineAt)}</small>
      </div>
    </section>
  )
}

function Topology({
  network,
  selectedId,
  currentSessionId,
  selectNode,
  showBirth,
  zoom,
}: {
  network: AtnNetworkView
  selectedId: string | null
  currentSessionId: string
  selectNode: (id: string) => void
  showBirth: boolean
  zoom: number
}) {
  const markerId = 'atn-m'
  const points = useMemo(() => layoutNodes(network.nodes, network.entryNodeId), [network.nodes, network.entryNodeId])
  const values = [...points.values()]
  const minX = Math.min(0, ...values.map(p => p.x - 80))
  const minY = Math.min(0, ...values.map(p => p.y - 65))
  const maxX = Math.max(840, ...values.map(p => p.x + 80))
  const maxY = Math.max(560, ...values.map(p => p.y + 65))
  const width = (maxX - minX) / zoom
  const height = (maxY - minY) / zoom
  const center = selectedId ? points.get(selectedId) : undefined
  const centerX = zoom > 1 && center ? center.x : (minX + maxX) / 2
  const centerY = zoom > 1 && center ? center.y : (minY + maxY) / 2

  return (
    <svg className="atn-canvas" viewBox={`${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`} role="group">
      <defs>
        <marker id={`${markerId}-peer`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path className="atn-arrow" d="M0 0 7 3.5 0 7z" />
        </marker>
        <marker id={`${markerId}-birth`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
          <path className="atn-arrow-birth" d="M0 0 7 3.5 0 7z" />
        </marker>
      </defs>
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
        return (
          <path
            key={`${edge.kind}:${edge.source}:${edge.target}`}
            fill="none"
            d={`M${line.x1},${line.y1} Q${cx},${cy} ${line.x2},${line.y2}`}
            data-atn-edge={`${edge.source}:${edge.target}`}
            data-atn-edge-kind={edge.kind}
            className={`atn-edge ${edge.kind === 'birth' ? 'atn-edge-birth' : ''} ${selected ? 'atn-edge-selected' : selectedId ? 'atn-edge-faded' : ''}`}
            markerEnd={`url(#${markerId}-${edge.kind === 'birth' ? 'birth' : 'peer'})`}
          />
        )
      })}
      {network.nodes.map((node, index) => {
        const position = points.get(node.id)
        if (!position) return null
        const label = node.isEntry ? t('entry') : `N${index + 1}`
        return (
          <g
            key={node.id}
            transform={`translate(${position.x},${position.y})`}
            role="button"
            className={`atn-node ${node.id === selectedId ? 'atn-node-selected' : ''} ${node.agentStatus === 'running' ? 'atn-node-running' : ''} ${node.lifecycle === 'failed' ? 'atn-node-failed' : ''} ${node.lifecycle === 'retired' ? 'atn-node-retired' : ''}`}
            onClick={() => { selectNode(node.id) }}
          >
            <circle className="atn-node-ring" r="26" />
            <circle className="atn-node-icon" cy="-6" r="6" />
            <path className="atn-node-icon" d="M-10 12v-3a10 10 0 0 1 20 0v3" />
            <circle className="atn-node-dot" cx="20" cy="-18" r="4" />
            <text y="46">{label}{node.sessionId === currentSessionId ? ` · ${t('current')}` : ''}</text>
            <text className="atn-node-status" y="62">{nodeState(node)}</text>
          </g>
        )
      })}
    </svg>
  )
}

function NodeDetails({
  network,
  node,
  currentSessionId,
  selectNode,
}: {
  network: AtnNetworkView
  node: AtnNodeView | undefined
  currentSessionId: string
  selectNode: (id: string) => void
}) {
  if (!node) return <aside className="atn-details"><h3 className="atn-section-heading">{t('details')}</h3><p className="atn-muted">{t('selectNode')}</p></aside>
  const incoming = network.edges.filter(e => e.kind === 'collaboration' && e.target === node.id).map(e => e.source)
  const tasks = network.tasks.filter(tk => tk.holderId === node.id || tk.requesterId === node.id)
  const neighborLinks = (ids: string[], empty: string) => ids.length
    ? <div className="atn-neighbor-list">{ids.map(id => <button className="atn-link" type="button" key={id} onClick={() => { selectNode(id) }}>{shortId(id)}</button>)}</div>
    : <span className="atn-muted">{empty}</span>

  return (
    <aside className="atn-details">
      <h3 className="atn-section-heading">{t('details')}</h3>
      <div className="atn-node-title">
        <strong>{shortId(node.id)}</strong>
        {node.isEntry && <span className="atn-chip">{t('entry')}</span>}
        {node.sessionId === currentSessionId && <span className="atn-chip">{t('current')}</span>}
      </div>
      <dl className="atn-facts">
        <div><dt>{t('state')}</dt><dd>{nodeState(node)}</dd></div>
        <div><dt>{t('session')}</dt><dd className="atn-code">{node.sessionId}</dd></div>
        <div><dt>{t('tool')}</dt><dd className={node.currentTool ? 'atn-code' : 'atn-muted'}>{node.currentTool ?? t('noTool')}</dd></div>
        <div><dt>{t('createdBy')}</dt><dd>{node.creatorId ? neighborLinks([node.creatorId], t('entryOrigin')) : t('entryOrigin')}</dd></div>
        <div><dt>{t('tasks')}</dt><dd>{node.openTasks}</dd></div>
        <div><dt>{t('steps')}</dt><dd>{node.stepsUsed} / {network.stepBudget}</dd></div>
        <div><dt>{t('pendingVotes')}</dt><dd>{node.pendingVotes}</dd></div>
      </dl>
      <section className="atn-neighbors">
        <h4>{t('peers')} →</h4>
        {neighborLinks(node.peers, t('noPeers'))}
      </section>
      <section className="atn-neighbors">
        <h4>{t('incoming')} →</h4>
        {neighborLinks(incoming, t('noIncoming'))}
      </section>
      <section className="atn-neighbors">
        <h4>{t('nodeTasks')}</h4>
        {tasks.map(task => (
          <article className="atn-task" key={task.id}>
            <div className="atn-task-head">
              <span className="atn-code">{shortId(task.id)}</span>
              <span className={task.status === 'completed' ? 'atn-live' : ''}>{task.status === 'completed' ? t('taskCompleted') : t('taskOpen')}</span>
            </div>
            <p>{task.description}</p>
            <small>{t('requester')} {shortId(task.requesterId)} → {t('holder')} {shortId(task.holderId)}</small>
            {task.summary && <p className="atn-task-result"><small>{t('result')}</small><br />{task.summary}</p>}
          </article>
        ))}
      </section>
    </aside>
  )
}

function Activity({ network, selectNode }: { network: AtnNetworkView; selectNode: (id: string) => void }) {
  return (
    <section className="atn-feed">
      <h3 className="atn-section-heading">
        <span>{t('activity')}</span>
        <small className="atn-muted">{t('bounded')}</small>
      </h3>
      <ol className="atn-feed-list">
        {network.events.map(ev => (
          <li className="atn-event" key={ev.id}>
            <time>{time(ev.at)}</time>
            <span className="atn-event-kind">{ev.kind}</span>
            <div className="atn-event-body">
              <button type="button" className="atn-link" onClick={() => { selectNode(ev.nodeId) }}>{shortId(ev.nodeId)}</button>
              {ev.targetId && <span className="atn-muted">→ {shortId(ev.targetId)} · </span>}
              {ev.summary}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function App() {
  const [selectedId, setSelectedId] = useState<string>('node-sec-audit')
  const [showBirth, setShowBirth] = useState<boolean>(true)
  const [zoom, setZoom] = useState<number>(1)
  const network = mockSnapshot.network!
  const selected = network.nodes.find(n => n.id === selectedId)

  return (
    <div className="dsh-app-shell">
      {/* 侧边栏 */}
      <aside className="dsh-sidebar">
        <div className="dsh-brand">
          <div className="dsh-logo-icon">▲</div>
          <span className="dsh-brand-title">DeepSeek Harness</span>
        </div>
        <div className="dsh-new-btn">+ 新建会话</div>
        <div className="dsh-session-list">
          <div className="dsh-session-item active">
            <span className="dsh-session-dot" />
            <div className="dsh-session-info">
              <span className="dsh-session-title">出站通道安全审计与分片查证</span>
              <span className="dsh-session-meta">ATN 预设 · 5 节点</span>
            </div>
          </div>
          <div className="dsh-session-item">
            <span className="dsh-session-dot idle" />
            <div className="dsh-session-info">
              <span className="dsh-session-title">基准测试数据验证 (Round 11)</span>
              <span className="dsh-session-meta">Standard · 昨天</span>
            </div>
          </div>
        </div>
      </aside>

      {/* 主对话区 */}
      <main className="dsh-main-chat">
        <header className="dsh-chat-header">
          <div className="dsh-chat-title-group">
            <h1 className="dsh-chat-title">出站通道安全审计与分片查证</h1>
            <span className="dsh-preset-badge">ATN 预设</span>
          </div>
          <div className="dsh-header-actions">
            <button type="button" className="atn-trigger">
              <NetworkIcon />
              <span className="atn-trigger-label">可视化ATN网络</span>
            </button>
          </div>
        </header>

        <div className="dsh-chat-body">
          <div className="dsh-message user">
            <div className="dsh-avatar user">U</div>
            <div className="dsh-bubble">
              请全面核对 docs/ 下的 13 条出站通道策略，拆分给多个节点并行查证，并向宿主汇聚带有权属的合规证据链。
            </div>
          </div>
          <div className="dsh-message assistant">
            <div className="dsh-avatar assistant">D</div>
            <div className="dsh-bubble">
              <p>已通过 <code>atn_start</code> 初始化网络 <code>net-atn-2026-audit</code>。目前已派发子节点并发开展安全审查：</p>
              <ul>
                <li><strong>node-sec-audit</strong>：完成 13 通道出站审查，验证 <code>evidence-not-owned</code> 拦截；</li>
                <li><strong>node-shard-03</strong>：正在执行分片 03 的数据合规扫描；</li>
                <li><strong>实时拓扑</strong>：已自动建立协作拓扑，您可点击右上角「可视化ATN网络」观察实时状态。</li>
              </ul>
            </div>
          </div>
        </div>

        {/* 弹出的 ATN 观测面板 Modal */}
        <div className="atn-modal-overlay">
          <div className="atn-modal-window atn-modal">
            <div className="atn-shell">
              <header className="atn-head">
                <div>
                  <div className="atn-heading">
                    <NetworkIcon size={21} />
                    <h2>{t('title')}</h2>
                    <span className="atn-chip">{t('readOnly')}</span>
                  </div>
                  <p>{t('description')}</p>
                </div>
                <button type="button" className="atn-close">×</button>
              </header>

              <div className="atn-scroll">
                <Overview network={network} />
                <div className="atn-main">
                  <div className="atn-graph-area">
                    <div className="atn-toolbar">
                      <label>
                        <input
                          type="checkbox"
                          checked={showBirth}
                          onChange={e => { setShowBirth(e.target.checked) }}
                        />
                        {t('birthEdges')}
                      </label>
                      <div className="atn-tools">
                        <button type="button" className="atn-control" onClick={() => { setZoom(z => Math.max(0.5, z - 0.25)) }}>−</button>
                        <button type="button" className="atn-control" onClick={() => { setZoom(z => Math.min(2.5, z + 0.25)) }}>+</button>
                        <button type="button" className="atn-control" onClick={() => { setZoom(1); setSelectedId('node-sec-audit') }}>{t('reset')}</button>
                      </div>
                    </div>
                    <Topology
                      network={network}
                      selectedId={selectedId}
                      currentSessionId="session-entry-01"
                      selectNode={setSelectedId}
                      showBirth={showBirth}
                      zoom={zoom}
                    />
                    <div className="atn-legend">
                      <span><i className="atn-legend-line" />{t('collaboration')}</span>
                      {showBirth && <span><i className="atn-legend-line atn-legend-birth" />{t('birth')}</span>}
                      <span className="atn-live"><i className="atn-dot" />{t('running')}</span>
                    </div>
                    <p className="atn-graph-help">{t('graphHelp')}</p>
                  </div>
                  <NodeDetails
                    network={network}
                    node={selected}
                    currentSessionId="session-entry-01"
                    selectNode={setSelectedId}
                  />
                </div>
                <Activity network={network} selectNode={setSelectedId} />
              </div>

              <footer className="atn-foot">
                <span className="atn-foot-status">
                  <span className="atn-live"><i className="atn-dot" /> {t('live')}</span>
                  <span>{t('updated')} {time(mockSnapshot.observedAt)}</span>
                </span>
                <span>{t('noNetworkActivity')}</span>
              </footer>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
