/** Operator-only ATN observation. No tools, prompts, wakeups, or network mutations. */
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol'
import type TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import type {} from './runtime.ts'
import type { NetworkRecord } from './schema.ts'
import { collaborationPeers } from './topology.ts'
import { taskResultDigest } from './tasks.ts'
import type { AtnEventView, AtnNetworkView, AtnObserverSnapshot } from './observer-types.ts'
import {
  createObserverDescriptor, observerSessionIdSchema, observerSnapshotSchema,
  OBSERVER_MAX_EVENTS, OBSERVER_MAX_TASKS, OBSERVER_TEXT_LIMIT,
} from './observer-schema.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { atnObserver: AtnObserver }
  interface Events {
    /** Post-commit observation only; never a model-facing event. */
    'atn/network-updated'(payload: { record: NetworkRecord; at: number }): void
  }
}

interface NodeObservation { sessionId: string; lifecycle: string; peers: string[] }
interface Observation {
  nodes: Map<string, NodeObservation>
  events: AtnEventView[]
  tools: Map<string, Map<string, string>>
  seeded: Set<string>
}
const MAX_NETWORK_CACHES = 64
const MAX_SESSION_TAIL = 512

/** Bound display copy, strip controls, and redact common inline credential assignments. */
function display(value: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [redacted]')
    .replace(/\s+/g, ' ').trim()
  return cleaned.length > OBSERVER_TEXT_LIMIT ? `${cleaned.slice(0, OBSERVER_TEXT_LIMIT - 1)}…` : cleaned
}

function peers(record: NetworkRecord, nodeId: string): string[] {
  const node = record.nodes[nodeId]
  if (node.lifecycle !== 'active' || node.creationState !== 'published') return []
  return collaborationPeers(record.nodes, nodeId)
}

/** Human-readable history recoverable from the authoritative durable facts. */
function durableEvents(record: NetworkRecord): AtnEventView[] {
  const events: AtnEventView[] = []
  const add = (id: string, kind: string, at: number, nodeId: string, summary: string,
    targetId: string | null = null, taskId: string | null = null): void => {
    events.push({ id, kind, at, nodeId, targetId, taskId, summary: display(summary) })
  }
  for (const node of Object.values(record.nodes)) {
    add(`node:${node.id}`, 'node-created', node.createdAt, node.id,
      node.isEntry ? '入口节点启动网络' : `由 ${node.creatorId} 创建节点`, node.creatorId)
  }
  for (const task of Object.values(record.tasks)) {
    add(`task:${task.id}:created`, 'task-created', task.createdAt, task.requesterId,
      `分配任务：${task.description}`, task.holderId, task.id)
    if (task.settledAt !== null) add(`task:${task.id}:settled`, `task-${task.status}`, task.settledAt,
      task.settledBy ?? task.holderId, `${task.status === 'completed' ? '已提交，等待独立验收' : task.status === 'failed' ? '自报失败' : '无法送达'}：${task.result?.summary ?? task.description}`,
      task.requesterId, task.id)
    if (task.acceptance != null) {
      const valid = task.status === 'completed' && task.result !== null && task.acceptance.resultDigest === taskResultDigest(task)
      const status = valid ? task.acceptance.status : 'stale'
      const label = status === 'passed' ? '独立验收通过' : status === 'failed' ? '独立验收未通过' : '验收与当前提交不匹配，仍未验证'
      add(`task:${task.id}:acceptance`, `task-acceptance-${status}`, task.acceptance.checkedAt,
        task.holderId, `${label}（${task.acceptance.validatorId}）：${task.acceptance.summary}`, task.requesterId, task.id)
    }
  }
  for (const mail of Object.values(record.mails)) {
    const label = { task: '任务消息', note: '协作消息', result: '结果消息', delivery: '通知消息' }[mail.kind]
    add(`mail:${mail.id}:sent`, 'mail-sent', mail.enqueuedAt, mail.fromId, `发送${label}`, mail.toId, mail.taskId)
    if (mail.settledAt !== null) add(`mail:${mail.id}:settled`, `mail-${mail.status}`, mail.settledAt,
      mail.fromId, `${label}${mail.status === 'delivered' ? '已投递' : '无法投递'}`, mail.toId, mail.taskId)
  }
  for (const proposal of Object.values(record.proposals)) {
    add(`proposal:${proposal.id}:created`, 'proposal-created', proposal.createdAt, proposal.proposerId,
      `提出目标修订：${proposal.rationale}`)
    for (const vote of proposal.votes) add(`proposal:${proposal.id}:vote:${vote.voterId}`, 'proposal-vote', vote.at,
      vote.voterId, `${vote.approve ? '同意' : '拒绝'}目标修订 ${proposal.id}`, proposal.proposerId)
    if (proposal.settledAt !== null) add(`proposal:${proposal.id}:settled`, `proposal-${proposal.status}`,
      proposal.settledAt, proposal.proposerId, `目标修订 ${proposal.id}：${proposal.status}`)
  }
  for (const revision of record.goalHistory) add(`goal:${revision.version}`, 'goal-committed', revision.committedAt,
    revision.proposedBy ?? record.entryNodeId, `共享目标更新为 v${revision.version}`)
  const verdictLabels = {
    'observed-improvement': '局部观测改善', 'observed-regression': '局部观测退化',
    mixed: '指标存在取舍', unchanged: '未观察到改善', 'insufficient-evidence': '证据不足',
  }
  for (const rewire of record.rewireHistory ?? []) {
    const intent = rewire.intent === 'exploration' ? '探索，未声明验证收益' : '基于已验收的观测'
    add(`rewire:${rewire.id}`, `rewire-${rewire.intent}`, rewire.createdAt, rewire.nodeId,
      `主动重连（${intent}）：${rewire.previousPeers.join(', ') || '无'} → ${rewire.nextPeers.join(', ') || '无'}；` +
      `${verdictLabels[rewire.evaluation.verdict]}，不代表因果收益；` +
      `任务 ${rewire.evaluation.baselineTaskIds.join(', ') || '无'} → ${rewire.evaluation.candidateTaskIds.join(', ') || '无'}`)
  }
  return events
}

/** Bounded live observations supplement durable history; disposal is owned by Cordis. */
export class AtnObserver extends Service {
  static inject = ['atn', 'agents', 'sessions', 'typert']
  readonly typertRemote = bindTypertRemote(this, 'atnObserver')
  private readonly observations = new Map<string, Observation>()
  private serial = 0

  constructor(ctx: Context) {
    super(ctx, 'atnObserver')
    ;(ctx.typert as TypertRegistry).register({
      package: 'dsh-atn-observer', face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: [createObserverDescriptor()],
    })
    ctx.on('atn/network-updated', ({ record, at }) => {
      // Observer failures must never turn a committed operation into a tool failure.
      try { this.observeTopology(record, at) }
      catch (error) { ctx.logger.warn(`ATN observation skipped: ${String(error)}`) }
    })
    ctx.on('atn/task-claimed', ({ networkId, sourceTask, task, at }) => {
      try {
        this.push(this.observation(networkId), { id: `task:${task.id}:claimed`, kind: 'task-claimed', at,
          nodeId: task.holderId, targetId: sourceTask.holderId, taskId: task.id,
          summary: display(`${task.kind === 'delivery' ? '认领交付义务' : '认领恢复任务'}：${task.description}`) })
      } catch (error) { ctx.logger.warn(`ATN claim observation skipped: ${String(error)}`) }
    })
    ctx.on('session/event', (session, event) => {
      const networkId = ctx.atn.networkForSession(session.id)
      if (networkId === undefined) return
      const observation = this.observations.get(networkId)
      if (observation === undefined) return
      const nodeId = [...observation.nodes].find(([, node]) => node.sessionId === session.id)?.[0]
      if (nodeId !== undefined) this.observeSession(observation, nodeId, session, event)
    })
    ctx.effect(() => () => { this.observations.clear() }, 'atnObserver: bounded history')
  }

  private observation(id: string): Observation {
    let value = this.observations.get(id)
    if (value === undefined) {
      value = { nodes: new Map(), events: [], tools: new Map(), seeded: new Set() }
      this.observations.set(id, value)
      if (this.observations.size > MAX_NETWORK_CACHES) this.observations.delete(this.observations.keys().next().value!)
    }
    return value
  }

  private push(observation: Observation, event: AtnEventView): void {
    if (observation.events.some(existing => existing.id === event.id)) return
    observation.events.push(event)
    // Late first-read replay must not evict newer live changes merely because it
    // was appended after them. IDs deduplicate the live feed and persisted tail.
    observation.events.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
    if (observation.events.length > OBSERVER_MAX_EVENTS) observation.events.splice(0, observation.events.length - OBSERVER_MAX_EVENTS)
  }

  private observeTopology(record: NetworkRecord, at: number): Observation {
    const observation = this.observation(record.id)
    const next = new Map<string, NodeObservation>()
    for (const node of Object.values(record.nodes)) {
      const current = { sessionId: node.sessionId, lifecycle: node.lifecycle, peers: peers(record, node.id) }
      const prior = observation.nodes.get(node.id)
      if (prior !== undefined) {
        if (prior.lifecycle !== current.lifecycle) this.push(observation, {
          id: `live:${++this.serial}`, kind: 'node-lifecycle', at, nodeId: node.id,
          targetId: null, taskId: null, summary: `节点状态：${prior.lifecycle} → ${current.lifecycle}`,
        })
        for (const targetId of prior.peers.filter(id => !current.peers.includes(id))) this.push(observation, {
          id: `live:${++this.serial}`, kind: 'edge-removed', at, nodeId: node.id,
          targetId, taskId: null, summary: `断开协作邻接 ${node.id} → ${targetId}`,
        })
        for (const targetId of current.peers.filter(id => !prior.peers.includes(id))) this.push(observation, {
          id: `live:${++this.serial}`, kind: 'edge-added', at, nodeId: node.id,
          targetId, taskId: null, summary: `建立协作邻接 ${node.id} → ${targetId}`,
        })
      }
      next.set(node.id, current)
    }
    observation.nodes = next
    return observation
  }

  private observeSession(observation: Observation, nodeId: string, session: Session, event: SessionEvent): void {
    let tools = observation.tools.get(session.id)
    if (tools === undefined) { tools = new Map(); observation.tools.set(session.id, tools) }
    let summary: string | undefined
    if (event.type === 'tool/call') {
      tools.set(event.data.callId, display(event.data.name))
      if (tools.size > 64) tools.delete(tools.keys().next().value!)
      summary = `调用工具 ${event.data.name}`
    } else if (event.type === 'tool/result') {
      const name = tools.get(event.data.message.toolCallId) ?? '工具'
      tools.delete(event.data.message.toolCallId)
      summary = `${name}${event.data.message.isError ? '执行失败' : '返回结果'}`
    } else if (event.type === 'step/start') summary = `开始第 ${event.data.step} 步`
    else if (event.type === 'turn/end') { tools.clear(); summary = `本轮结束：${event.data.reason.kind}` }
    else if (event.type === 'assistant/message') summary = '智能体已输出回复'
    if (summary !== undefined) this.push(observation, {
      id: `session:${session.id}:${event.seq}`, kind: event.type, at: event.time, nodeId,
      targetId: null, taskId: null, summary: display(summary),
    })
  }

  /** Read the network belonging to the viewed session without waking or resuming any agent. */
  async snapshot(sessionId: string, signal: AbortSignal): Promise<AtnObserverSnapshot> {
    observerSessionIdSchema.parse(sessionId)
    signal.throwIfAborted()
    const found = await this.ctx.atn.findBySessionId(sessionId)
    signal.throwIfAborted()
    const observedAt = Date.now()
    if (found === undefined) return { observedAt, network: null }
    const record = found.record
    // Polling may finish after a newer commit's event. Only initialize a missing
    // baseline here; committed runtime events alone advance an existing one.
    const observation = this.observations.get(record.id) ?? this.observeTopology(record, observedAt)
    const tasks = Object.values(record.tasks)
    const proposals = Object.values(record.proposals)
    const nodes = Object.values(record.nodes).map(node => {
      const agent = this.ctx.agents.get(SessionId(node.sessionId))
      if (agent !== undefined && !observation.seeded.has(node.sessionId)) {
        observation.seeded.add(node.sessionId)
        observation.tools.delete(node.sessionId)
        for (const event of agent.session.snapshotEvents().slice(-MAX_SESSION_TAIL)) this.observeSession(observation, node.id, agent.session, event)
      }
      const currentTools = agent?.status === 'running' ? [...(observation.tools.get(node.sessionId)?.values() ?? [])] : []
      return {
        id: node.id, sessionId: node.sessionId, isEntry: node.isEntry, creatorId: node.creatorId,
        lifecycle: node.lifecycle, agentStatus: agent?.status ?? 'unloaded' as const,
        peers: peers(record, node.id),
        stepsUsed: node.stepsUsed ?? 0,
        openTasks: tasks.filter(task => task.holderId === node.id && task.status === 'open').length,
        pendingVotes: proposals.filter(proposal => proposal.status === 'pending' && proposal.voters.includes(node.id)
          && !proposal.votes.some(vote => vote.voterId === node.id)).length,
        currentTool: currentTools.length ? display(currentTools.join(' · ')) : null,
      }
    })
    const latest = record.goalHistory.at(-1)!
    const allEvents = new Map([...durableEvents(record), ...observation.events].map(event => [event.id, event]))
    const network: AtnNetworkView = {
      id: record.id, status: record.status, entryNodeId: record.entryNodeId, goalVersion: latest.version,
      objective: display(latest.document.objective), stepsUsed: record.stepsUsed,
      stepBudget: record.limits.stepBudget, deadlineAt: record.deadlineAt,
      nodes,
      edges: nodes.flatMap(node => [
        ...node.peers.map(target => ({ source: node.id, target, kind: 'collaboration' as const })),
        ...(node.creatorId !== null && record.nodes[node.creatorId] !== undefined
          ? [{ source: node.creatorId, target: node.id, kind: 'birth' as const }] : []),
      ]),
      tasks: tasks.sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open')
        || (b.settledAt ?? b.createdAt) - (a.settledAt ?? a.createdAt)).slice(0, OBSERVER_MAX_TASKS).map(task => ({
        id: task.id, holderId: task.holderId, requesterId: task.requesterId, description: display(task.description),
        status: task.status, summary: task.result === null ? null : display(task.result.summary),
        createdAt: task.createdAt, settledAt: task.settledAt,
      })),
      events: [...allEvents.values()].sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).slice(0, OBSERVER_MAX_EVENTS),
    }
    return observerSnapshotSchema.parse({ observedAt, network })
  }
}
