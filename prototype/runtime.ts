// THROWAWAY: ATN ownership and tool wiring over the real Harness Agent factory.
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { setTimeout as delay } from 'node:timers/promises'
import type { Command, Kernel } from './harness.ts'
import { NetworkStore, type Limits, type Mail } from './state.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'atn-prototype-mail': { kind: 'atn-prototype-mail'; mailId: string; sender: string }
    'atn-prototype-goal': { kind: 'atn-prototype-goal'; revision: number }
    'atn-prototype-control': { kind: 'atn-prototype-control' }
  }
}

const OUTPUT = {
  schema: { type: 'object', properties: {}, additionalProperties: true } as const,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}
const POLICY = 'ATN prototype: same tools and rules on every node. Work locally, send explicit results, wait without polling. Shared-goal changes require every snapshotted neighbor. Birth is not runtime ownership.'

export class PrototypeRuntime {
  readonly store: NetworkStore
  readonly handles = new Map<string, AgentHandle>()
  owner!: Fiber
  closed = false
  /** Controlled fault: target persisted the receipt, but the sender lost its acknowledgement. */
  loseNextAcknowledgement = false
  private readonly delivery = new Map<string, Promise<void>>()

  constructor(readonly ctx: Context, readonly kernel: Kernel, readonly scratch: string, limits: Partial<Limits>) {
    this.store = new NetworkStore(scratch, limits)
    ctx.effect(() => () => this.close(), 'atn-prototype.close')
  }

  private caller(agent: Agent | undefined): string {
    if (!agent || this.handles.get(agent.id)?.agent !== agent) throw new Error('EXACT_LIVE_CALLER_REQUIRED')
    if (this.closed) throw new Error('RUNTIME_CLOSED')
    this.store.requireOpen()
    return agent.id
  }

  private setup(agentCtx: Context, agent: Agent): void {
    agentCtx.systemPrompt.section({ name: 'atn-prototype:policy', order: 100, text: POLICY })
    agentCtx.on('agent/pre-step', async (_payload, next) => {
      const decision = await next()
      if (decision.kind !== 'enter') return decision
      if (this.closed || this.store.state.mode !== 'open') return { kind: 'reject' }
      if (this.store.state.admittedRequests >= this.store.limits.requests) {
        this.halt('request budget exhausted')
        return { kind: 'reject' }
      }
      this.store.change('request.admitted', agent.id, state => { state.admittedRequests++ })
      const goal = this.store.state.goals.at(-1)!
      const previous = agent.session.snapshotEvents().findLast(event =>
        event.type === 'user/message' && event.data.source.kind === 'atn-prototype-goal')
      if (previous?.type === 'user/message' && previous.data.source.kind === 'atn-prototype-goal'
        && previous.data.source.revision === goal.revision) return decision
      const snapshot = createUserMessage({
        source: { kind: 'atn-prototype-goal', revision: goal.revision },
        content: [{ type: 'text', text: `Shared goal, revision ${goal.revision}:\n${goal.body}` }],
      })
      return { ...decision, messages: [snapshot, ...decision.messages] }
    })

    agentCtx.tools.register(defineTool({
      name: 'atn_spawn', description: 'Create an independent equal-capability node.',
      parameters: {
        id: { type: 'string', required: true }, task: { type: 'string', required: true }, lease: { type: 'integer' },
      }, output: OUTPUT,
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        await this.spawn(args.id, this.caller(exec.agent), args.task, args.lease)
        return { node: args.id, task: `task-${args.id}` }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'atn_send', description: 'Send a task, note, or explicit result; the runtime supplies sender identity.',
      parameters: {
        to: { type: 'string', required: true }, kind: { type: 'string', required: true, enum: ['task', 'note', 'result'] },
        content: { type: 'string', required: true }, replyTo: { type: 'string' },
      }, output: OUTPUT,
      execute: async (args, exec) => {
        exec.signal.throwIfAborted()
        const mail = this.store.send(this.caller(exec.agent), args.to, args.kind, args.content, args.replyTo)
        await this.deliver(mail.id)
        return { mailId: mail.id, reference: mail.reference ?? null, status: this.store.state.mail[mail.id].status }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'atn_peers', description: 'Read own neighbors or discover up to three task-relevant peers.',
      parameters: { query: { type: 'string' } }, output: OUTPUT,
      execute: async (args, exec) => {
        const caller = this.caller(exec.agent)
        const neighbors = this.store.neighbors(caller)
        const peers = Object.values(this.store.state.nodes)
          .filter(node => node.id !== caller && node.phase === 'active'
            && (args.query ? node.description.toLowerCase().includes(args.query.toLowerCase()) : neighbors.includes(node.id)))
          .slice(0, args.query ? 3 : 4)
          .map(node => ({ id: node.id, description: node.description }))
        return { neighbors, peers }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'atn_finish', description: 'Leave the new-work topology; finish old obligations before resource release.',
      parameters: {}, output: OUTPUT,
      execute: async (_args, exec) => {
        const caller = this.caller(exec.agent)
        this.store.drain(caller)
        return { phase: 'draining', obligations: this.store.obligations(caller) }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'atn_propose', description: 'Propose an immutable goal change to the current neighbor electorate.',
      parameters: {
        baseRevision: { type: 'integer', required: true }, body: { type: 'string', required: true },
        reason: { type: 'string', required: true },
      }, output: OUTPUT,
      execute: async (args, exec) => {
        const proposal = this.store.propose(this.caller(exec.agent), args.baseRevision, args.body, args.reason)
        await this.flushMail()
        return { proposalId: proposal.id, voters: proposal.voters, status: proposal.status }
      },
    }))
    agentCtx.tools.register(defineTool({
      name: 'atn_vote', description: 'Vote as yourself on exactly one assigned proposal, even while draining.',
      parameters: {
        proposalId: { type: 'string', required: true }, decision: { type: 'string', required: true, enum: ['approve', 'reject'] },
      }, output: OUTPUT,
      execute: async (args, exec) => ({ ...this.store.vote(this.caller(exec.agent), args.proposalId, args.decision) }),
    }))
    agentCtx.tools.register(defineTool({
      name: 'atn_renew', description: 'Renew an active node lease for its outstanding task, within the configured cap.',
      parameters: { duration: { type: 'integer', required: true } }, output: OUTPUT,
      execute: async (args, exec) => ({ ...this.store.renew(this.caller(exec.agent), args.duration) }),
    }))
  }

  async spawn(id: string, creator: string | null, task: string, lease?: number): Promise<void> {
    if (this.closed) throw new Error('RUNTIME_CLOSED')
    this.store.reserveNode(id, creator, task, lease)
    let handle: AgentHandle | undefined
    try {
      // Critical seam: call through the network owner's context, NOT the creator's.
      // Do not pass parentAgent. Durable birth information lives in NetworkStore.
      handle = await this.ctx.agents.create({
        sessionId: SessionId(id), meta: { cwd: this.scratch },
        agentOptions: { provider: 'atn-script', model: 'same-scripted-model', maxTokens: 128 },
        setup: (ctx, agent) => { this.setup(ctx, agent) },
      })
      this.handles.set(id, handle)
      const mail = this.store.activateNode(id)
      await this.deliver(mail.id)
    } catch (error) {
      await handle?.dispose()
      this.handles.delete(id)
      this.store.change('node.creation-failed', id, state => { state.nodes[id].phase = 'retired' })
      throw error
    }
  }

  async resume(): Promise<void> {
    if (this.closed) throw new Error('RUNTIME_CLOSED')
    this.store.requireOpen()
    for (const node of Object.values(this.store.state.nodes)) {
      if (node.phase === 'retired') continue
      if (node.phase === 'provisioning') throw new Error('Prototype does not recover interrupted creation')
      const handle = await this.ctx.agents.resume({
        resumeSessionId: SessionId(node.id),
        agentOptions: { provider: 'atn-script', model: 'same-scripted-model', maxTokens: 128 },
        setup: (ctx, agent) => { this.setup(ctx, agent) },
      })
      this.handles.set(node.id, handle)
    }
    await this.flushMail()
    await this.settle()
  }

  private recorded(agent: Agent, mailId: string): boolean {
    const matches = (message: UserMessage): boolean =>
      message.source.kind === 'atn-prototype-mail' && message.source.mailId === mailId
    return [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(matches)
      || agent.session.snapshotEvents().some(event => event.type === 'user/message' && matches(event.data))
  }

  async deliver(mailId: string): Promise<void> {
    const mail = this.store.state.mail[mailId]
    if (!mail || mail.status !== 'queued') return
    const previous = this.delivery.get(mail.to) ?? Promise.resolve()
    const pending = previous.then(async () => {
      const current = this.store.state.mail[mailId]
      if (current.status !== 'queued') return
      if (this.closed) throw new Error('RUNTIME_CLOSED')
      this.store.requireOpen()
      if (current.to !== 'USER') {
        const target = this.handles.get(current.to)?.agent
        if (!target) throw new Error(`TARGET_NOT_RESIDENT: ${current.to}`)
        if (!this.recorded(target, mailId)) {
          const record = this.store.node(current.to)
          const oldReview = current.kind === 'review' && !!current.reference
            && this.store.state.proposals[current.reference]?.voters.includes(current.to)
          const oldResult = current.kind === 'result' && !!current.reference
            && this.store.state.tasks[current.reference]?.requester === current.to
          if (record.phase !== 'active' && !(record.phase === 'draining' && (oldReview || oldResult))) {
            throw new Error('TARGET_NOT_ACCEPTING_THIS_WORK')
          }
          target.steer(createUserMessage({
            source: { kind: 'atn-prototype-mail', mailId, sender: current.from },
            content: [{ type: 'text', text: JSON.stringify(current) }],
          }))
        }
        await this.ctx.sessions.flush(target.session)
      }
      if (this.loseNextAcknowledgement) {
        this.loseNextAcknowledgement = false
        return
      }
      this.store.change('mail.receipt', mailId, state => { state.mail[mailId].status = 'delivered' })
    })
    this.delivery.set(mail.to, pending.catch(() => {}))
    await pending
  }

  async flushMail(): Promise<void> {
    for (const mail of Object.values(this.store.state.mail)) {
      if (mail.status === 'queued') await this.deliver(mail.id)
    }
  }

  /** Drive a real model/tool turn with a fixture; not a production user command. */
  async drive(id: string, commands: Command[]): Promise<SessionEvent[]> {
    const agent = this.handles.get(id)?.agent
    if (!agent) throw new Error(`No live handle: ${id}`)
    const before = agent.session.seq
    this.kernel.model.enqueue(id, commands)
    agent.followup(createUserMessage({
      source: { kind: 'atn-prototype-control' },
      content: [{ type: 'text', text: 'Execute the next deterministic fixture commands.' }],
    }))
    await this.settle()
    return (await this.events(id)).filter(event => event.seq > before)
  }

  /** Observe all activity, then release only nodes whose old obligations have settled. */
  async settle(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      await Promise.all([...this.delivery.values()])
      await Promise.all([...this.handles.values()].map(handle => handle.agent.whenIdle()))
      let released = false
      for (const [id, handle] of this.handles) {
        const obligations = this.store.obligations(id)
        if (this.store.node(id).phase === 'draining' && !obligations.tasks.length && !obligations.reviews.length) {
          if (handle.agent.inbox.nextStep.length || handle.agent.inbox.nextTurn.length) continue
          // Outside the tool/driver stack: never await self-disposal from execute().
          await handle.dispose()
          this.handles.delete(id)
          this.store.change('node.retired', id, state => { state.nodes[id].phase = 'retired' })
          released = true
        }
      }
      if (!released && [...this.handles.values()].every(handle => handle.agent.status === 'idle')) return
      await delay(0)
    }
    throw new Error('Prototype did not reach quiescence')
  }

  async events(id: string): Promise<readonly SessionEvent[]> {
    const live = this.handles.get(id)?.agent
    if (live) return live.session.snapshotEvents()
    const handle = await this.ctx.sessionPersistence.open(SessionId(id), 'read')
    try { return (await handle.read()).events } finally { await handle.close() }
  }

  halt(reason: string): void {
    if (this.store.state.mode !== 'open') return
    this.store.change('network.stopped', reason, state => {
      state.mode = 'stopped'
      for (const task of Object.values(state.tasks)) if (task.status === 'pending') task.status = 'cancelled'
      for (const proposal of Object.values(state.proposals)) if (proposal.status === 'pending') proposal.status = 'cancelled'
      for (const mail of Object.values(state.mail)) if (mail.status === 'queued') mail.status = 'cancelled'
    })
    for (const handle of this.handles.values()) handle.agent.cancel({ kind: 'disposed' })
  }

  async finalize(): Promise<void> {
    await this.settle()
    this.store.change('network.completed', 'Fixture acceptance gate, not an LLM quality judgment', state => {
      this.store.requireOpen(state)
      if (Object.values(state.tasks).some(task => task.status !== 'completed')) throw new Error('UNFINISHED_TASKS')
      if (Object.values(state.proposals).some(proposal => proposal.status === 'pending')) throw new Error('PENDING_PROPOSALS')
      if (Object.values(state.mail).some(mail => mail.status === 'queued')) throw new Error('PENDING_MAIL')
      const deliveries = Object.values(state.mail).filter(mail => mail.to === 'USER' && mail.kind === 'result')
      if (!deliveries.length) throw new Error('NO_USER_DELIVERABLE')
      state.mode = 'completed'
    })
    await this.close()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await Promise.all([...this.handles.values()].map(handle => handle.dispose()))
    this.handles.clear()
  }

  view(): object {
    const state = this.store.state
    return {
      mode: state.mode, logicalClock: state.clock, goal: state.goals.at(-1),
      admittedRequests: state.admittedRequests,
      nodes: Object.values(state.nodes).map(node => ({
        ...node, activity: this.handles.get(node.id)?.agent.status ?? 'not-resident',
        neighbors: this.store.neighbors(node.id), obligations: this.store.obligations(node.id),
      })),
      tasks: Object.values(state.tasks), proposals: Object.values(state.proposals),
      pendingMail: Object.values(state.mail).filter(mail => mail.status === 'queued'),
      deliveredMail: Object.values(state.mail).filter(mail => mail.status === 'delivered').length,
      events: state.events.length,
    }
  }
}

export async function attachRuntime(kernel: Kernel, scratch: string, limits: Partial<Limits> = {}): Promise<PrototypeRuntime> {
  let runtime: PrototypeRuntime | undefined
  const plugin = {
    name: 'atn-throwaway-prototype', inject: ['agents', 'tools', 'systemPrompt', 'sessions', 'sessionPersistence'],
    apply(ctx: Context) { runtime = new PrototypeRuntime(ctx, kernel, scratch, limits) },
  }
  const fiber = await kernel.ctx.plugin(plugin)
  if (!runtime) throw new Error('Prototype owner did not activate')
  runtime.owner = fiber
  return runtime
}
