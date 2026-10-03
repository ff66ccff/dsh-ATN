// THROWAWAY state model: one small, atomic scratch snapshot, not a production store.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Phase = 'provisioning' | 'active' | 'draining' | 'retired'
export interface NodeRecord {
  id: string
  creator: string | null
  selectedChild: string | null
  phase: Phase
  description: string
  leaseUntil: number
}
export interface TaskRecord {
  id: string
  owner: string
  requester: string
  description: string
  status: 'pending' | 'completed' | 'cancelled'
  result?: string
}
export interface Proposal {
  id: string
  author: string
  baseRevision: number
  body: string
  reason: string
  voters: string[]
  votes: Record<string, 'approve' | 'reject'>
  status: 'pending' | 'committed' | 'rejected' | 'stale' | 'expired' | 'cancelled'
  expiresAt: number
}
export interface Mail {
  id: string
  from: string
  to: string
  kind: 'task' | 'result' | 'note' | 'review'
  content: string
  reference?: string
  status: 'queued' | 'delivered' | 'cancelled'
}
export interface NetworkState {
  format: 'ATN-THROWAWAY-1'
  mode: 'open' | 'completed' | 'stopped'
  clock: number
  serial: number
  admittedRequests: number
  nodes: Record<string, NodeRecord>
  tasks: Record<string, TaskRecord>
  proposals: Record<string, Proposal>
  mail: Record<string, Mail>
  goals: { revision: number; body: string; proposal?: string }[]
  events: { seq: number; action: string; detail: string }[]
}
export interface Limits {
  liveNodes: number
  totalNodes: number
  requests: number
  pendingMail: number
  messageBytes: number
  maxLease: number
}
const DEFAULT_LIMITS: Limits = {
  liveNodes: 16, totalNodes: 32, requests: 500, pendingMail: 32,
  messageBytes: 4096, maxLease: 1000,
}

export class NetworkStore {
  state: NetworkState
  readonly path: string
  readonly limits: Limits

  constructor(scratch: string, limits: Partial<Limits> = {}) {
    this.path = join(scratch, 'network.PROTOTYPE-WIPE-ME.json')
    this.limits = { ...DEFAULT_LIMITS, ...limits }
    this.state = existsSync(this.path)
      ? JSON.parse(readFileSync(this.path, 'utf8')) as NetworkState
      : {
        format: 'ATN-THROWAWAY-1', mode: 'open', clock: 0, serial: 0, admittedRequests: 0,
        nodes: {}, tasks: {}, proposals: {}, mail: {},
        goals: [{ revision: 1, body: 'Deliver a checked ATN fixture result. Never count silence as success.' }],
        events: [],
      }
    if (this.state.format !== 'ATN-THROWAWAY-1') throw new Error('Not an ATN prototype snapshot')
    this.persist(this.state)
  }

  private persist(state: NetworkState): void {
    const temporary = `${this.path}.next`
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flush: true })
    renameSync(temporary, this.path)
  }

  /** No await inside a mutation: concurrent actors serialize at this commit point. */
  change<T>(action: string, detail: string, mutate: (state: NetworkState) => T): T {
    const next = structuredClone(this.state)
    const result = mutate(next)
    next.events.push({ seq: next.events.length + 1, action, detail })
    this.persist(next)
    this.state = next
    return structuredClone(result)
  }

  requireOpen(state = this.state): void {
    if (state.mode !== 'open') throw new Error(`NETWORK_${state.mode.toUpperCase()}`)
  }

  node(id: string, state = this.state): NodeRecord {
    const node = state.nodes[id]
    if (!node) throw new Error(`UNKNOWN_NODE: ${id}`)
    return node
  }

  active(id: string, state = this.state): NodeRecord {
    this.requireOpen(state)
    const node = this.node(id, state)
    if (node.phase !== 'active') throw new Error(`NOT_ACCEPTING: ${id} is ${node.phase}`)
    return node
  }

  neighbors(id: string, state = this.state): string[] {
    const start = this.node(id, state)
    const walk = (first: string | null, direction: 'creator' | 'selectedChild'): string[] => {
      const result: string[] = []
      const seen = new Set([id])
      let cursor = first
      while (cursor && result.length < 2) {
        if (seen.has(cursor)) throw new Error('TOPOLOGY_CYCLE')
        seen.add(cursor)
        const node = this.node(cursor, state)
        if (node.phase === 'active') result.push(node.id)
        cursor = node[direction]
      }
      return result
    }
    return [...walk(start.creator, 'creator'), ...walk(start.selectedChild, 'selectedChild')]
  }

  obligations(id: string, state = this.state): { tasks: string[]; reviews: string[] } {
    return {
      tasks: Object.values(state.tasks).filter(t => t.owner === id && t.status === 'pending').map(t => t.id),
      reviews: Object.values(state.proposals)
        .filter(p => p.status === 'pending' && p.voters.includes(id) && !p.votes[id]).map(p => p.id),
    }
  }

  /** Mail acceptance and obligation assignment are committed together. */
  enqueue(state: NetworkState, fields: Omit<Mail, 'id' | 'status'>): Mail {
    const pending = Object.values(state.mail).filter(m => m.to === fields.to && m.status === 'queued').length
    if (pending >= this.limits.pendingMail) throw new Error('MAILBOX_FULL')
    const mail: Mail = { ...fields, id: `mail-${++state.serial}`, status: 'queued' }
    if (Buffer.byteLength(JSON.stringify(mail), 'utf8') > this.limits.messageBytes) throw new Error('MESSAGE_TOO_LARGE')
    state.mail[mail.id] = mail
    return mail
  }

  reserveNode(id: string, creator: string | null, description: string, lease = 100): void {
    this.change('node.reserve', id, state => {
      this.requireOpen(state)
      if (!/^[A-Z][A-Z0-9-]{0,20}$/.test(id)) throw new Error('INVALID_NODE_ID')
      if (state.nodes[id]) throw new Error('NODE_EXISTS')
      if (creator) this.active(creator, state)
      const nodes = Object.values(state.nodes)
      if (nodes.length >= this.limits.totalNodes) throw new Error('TOTAL_NODE_LIMIT')
      if (nodes.filter(n => n.phase !== 'retired').length >= this.limits.liveNodes) throw new Error('LIVE_NODE_LIMIT')
      if (!Number.isSafeInteger(lease) || lease <= 0 || lease > this.limits.maxLease) throw new Error('INVALID_LEASE')
      state.nodes[id] = { id, creator, description, selectedChild: null, phase: 'provisioning', leaseUntil: state.clock + lease }
    })
  }

  activateNode(id: string): Mail {
    return this.change('node.active', id, state => {
      this.requireOpen(state)
      const node = this.node(id, state)
      if (node.creator) this.active(node.creator, state)
      node.phase = 'active'
      if (node.creator && this.node(node.creator, state).selectedChild === null) {
        this.node(node.creator, state).selectedChild = id
      }
      const task: TaskRecord = { id: `task-${id}`, owner: id, requester: node.creator ?? 'USER', description: node.description, status: 'pending' }
      state.tasks[task.id] = task
      return this.enqueue(state, { from: task.requester, to: id, kind: 'task', content: task.description, reference: task.id })
    })
  }

  send(from: string, to: string, kind: 'task' | 'result' | 'note', content: string, replyTo?: string): Mail {
    return this.change(`mail.${kind}`, `${from} -> ${to}`, state => {
      this.requireOpen(state)
      const sender = this.node(from, state)
      if (sender.phase !== 'active' && sender.phase !== 'draining') throw new Error('SENDER_RETIRED')
      let reference = replyTo
      if (kind === 'result') {
        const task = replyTo ? state.tasks[replyTo] : undefined
        if (!task || task.owner !== from || task.requester !== to || task.status !== 'pending') throw new Error('NOT_TASK_OWNER_OR_ALREADY_SETTLED')
        if (to !== 'USER' && !['active', 'draining'].includes(this.node(to, state).phase)) throw new Error('RESULT_TARGET_RETIRED')
        task.status = 'completed'
        task.result = content
      } else {
        this.active(from, state)
        this.active(to, state)
        if (kind === 'task') {
          reference = `task-${++state.serial}`
          state.tasks[reference] = { id: reference, owner: to, requester: from, description: content, status: 'pending' }
        }
      }
      return this.enqueue(state, { from, to, kind, content, ...(reference ? { reference } : {}) })
    })
  }

  propose(author: string, baseRevision: number, body: string, reason: string): Proposal {
    return this.change('proposal.create', author, state => {
      this.active(author, state)
      if (state.goals.at(-1)!.revision !== baseRevision) throw new Error('STALE_BASE_REVISION')
      const voters = this.neighbors(author, state)
      if (!voters.length) throw new Error('NO_NEIGHBORS_NO_SELF_APPROVAL')
      const proposal: Proposal = {
        id: `proposal-${++state.serial}`, author, baseRevision, body, reason, voters, votes: {},
        status: 'pending', expiresAt: state.clock + 50,
      }
      state.proposals[proposal.id] = proposal
      for (const voter of voters) {
        this.enqueue(state, { from: author, to: voter, kind: 'review', reference: proposal.id,
          content: JSON.stringify({ proposal: proposal.id, baseRevision, body, reason }) })
      }
      return proposal
    })
  }

  vote(voter: string, proposalId: string, decision: 'approve' | 'reject'): Proposal {
    return this.change('proposal.vote', `${voter}: ${proposalId} ${decision}`, state => {
      this.requireOpen(state)
      const proposal = state.proposals[proposalId]
      if (!proposal) throw new Error('UNKNOWN_PROPOSAL')
      if (!proposal.voters.includes(voter)) throw new Error('NOT_IN_FROZEN_ELECTORATE')
      if (proposal.votes[voter] === decision) return proposal
      if (proposal.status !== 'pending') throw new Error(`PROPOSAL_${proposal.status.toUpperCase()}`)
      if (proposal.votes[voter]) throw new Error('VOTE_ALREADY_RECORDED')
      if (!['active', 'draining'].includes(this.node(voter, state).phase)) throw new Error('VOTER_RETIRED')
      proposal.votes[voter] = decision
      if (decision === 'reject') proposal.status = 'rejected'
      else if (proposal.voters.every(id => proposal.votes[id] === 'approve')) {
        if (state.goals.at(-1)!.revision !== proposal.baseRevision) proposal.status = 'stale'
        else {
          proposal.status = 'committed'
          state.goals.push({ revision: proposal.baseRevision + 1, body: proposal.body, proposal: proposal.id })
        }
      }
      return proposal
    })
  }

  drain(id: string): void {
    this.change('node.draining', id, state => {
      this.requireOpen(state)
      const node = this.node(id, state)
      if (node.phase !== 'active' && node.phase !== 'draining') throw new Error('NODE_NOT_LIVE')
      node.phase = 'draining'
    })
  }

  renew(id: string, duration: number): NodeRecord {
    return this.change('node.renew', id, state => {
      const node = this.active(id, state)
      if (!this.obligations(id, state).tasks.length) throw new Error('RENEWAL_REQUIRES_OWN_TASK')
      if (!Number.isSafeInteger(duration) || duration <= 0 || duration > this.limits.maxLease) throw new Error('INVALID_LEASE')
      node.leaseUntil = Math.max(node.leaseUntil, state.clock + duration)
      return node
    })
  }

  /** A logical clock makes expiry reproducible without waiting in real time. */
  advance(duration: number): void {
    this.change('clock.advance', String(duration), state => {
      this.requireOpen(state)
      if (!Number.isSafeInteger(duration) || duration < 0) throw new Error('INVALID_CLOCK_ADVANCE')
      state.clock += duration
      for (const node of Object.values(state.nodes)) {
        if (node.phase === 'active' && node.leaseUntil <= state.clock) node.phase = 'draining'
      }
      for (const proposal of Object.values(state.proposals)) {
        if (proposal.status === 'pending' && proposal.expiresAt <= state.clock) proposal.status = 'expired'
      }
    })
  }
}
