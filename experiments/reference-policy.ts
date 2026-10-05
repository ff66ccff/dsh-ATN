/** Deterministic local policies. Evidence enters only through the scenario ACL. */
import type { DeliverInput, RewireInput, SendInput } from '../src/runtime.ts'
import type { MailRecord, NodeRecord, TaskRecord } from '../src/schema.ts'
import { collaborationPeers } from '../src/topology.ts'
import { ACCOUNTS, type LedgerEntry, type LedgerShard, type TopologyScenario } from './topology-task.ts'

export const REFERENCE_POLICIES = ['hub', 'ring-gossip', 'tree-aggregate', 'adaptive'] as const
export type ReferencePolicyName = typeof REFERENCE_POLICIES[number]
export type AccountTotals = Record<typeof ACCOUNTS[number], number>

/** Slots identify disjoint contributions; account values never encode raw entries. */
export interface ReferenceSubtotal {
  slots: number[]
  netByAccount: AccountTotals
  appliedEntries: number
}

export interface ReferenceNodeState {
  phase: 0 | 1 | 2
  slot?: number
  documents: string[]
  initial: Map<number, LedgerEntry[]>
  local: Map<number, ReferenceSubtotal>
  known: Map<string, ReferenceSubtotal>
  seenMail: Set<string>
  sent: Map<string, Set<string>>
  initialPeers?: string[]
  rewired: boolean
  claimed: boolean
  refreshDocuments: boolean
  treeSent: boolean
  final?: ReferenceSubtotal
  finalSent: Set<string>
  treeChildren: Map<string, ReferenceSubtotal>
}

export function createReferenceNodeState(): ReferenceNodeState {
  return { phase: 0, documents: [], initial: new Map(), local: new Map(), known: new Map(),
    seenMail: new Set(), sent: new Map(), rewired: false, claimed: false, refreshDocuments: false, treeSent: false,
    finalSent: new Set(), treeChildren: new Map() }
}

/** The host supplies topology metadata and only this node's delivered mailbox. */
export interface NodeView {
  node: NodeRecord
  nodes: Record<string, NodeRecord>
  entryNodeId: string
  goalVersion: number
  phase: 1 | 2
  inbox: readonly MailRecord[]
  tasks: readonly TaskRecord[]
  state: ReferenceNodeState
  /** No foreign open tasks, pending proposals or undelivered mail. */
  canDeliver: boolean
}

export type Action =
  | { type: 'read'; ids: string[] }
  | { type: 'send'; input: SendInput }
  | { type: 'rewire'; input: RewireInput }
  | { type: 'claim'; taskId: string }
  | { type: 'deliver'; input: DeliverInput }

export type ReferencePolicy = (view: NodeView, scenario: TopologyScenario) => Promise<Action | null>

interface SubtotalMessage {
  type: 'reference-subtotals'
  phase: 2
  subtotals: ReferenceSubtotal[]
  role?: 'tree-up' | 'tree-final'
}

const subtotalKey = (value: ReferenceSubtotal) => [...value.slots].sort((a, b) => a - b).join(',')
const emptyTotals = (): AccountTotals => ({ A: 0, B: 0, C: 0, D: 0 })

/** Overlapping provenance is an error, rather than a second application of a shard. */
function aggregate(parts: readonly ReferenceSubtotal[]): ReferenceSubtotal {
  const slots = new Set<number>()
  const netByAccount = emptyTotals()
  let appliedEntries = 0
  for (const part of parts) {
    for (const slot of part.slots) {
      if (slots.has(slot)) throw new Error(`Overlapping reference subtotal for slot ${slot}`)
      slots.add(slot)
    }
    for (const account of ACCOUNTS) netByAccount[account] += part.netByAccount[account]
    appliedEntries += part.appliedEntries
  }
  return { slots: [...slots].sort((a, b) => a - b), netByAccount, appliedEntries }
}

function subtotal(slot: number, rows: readonly LedgerEntry[], correction: LedgerShard['correction']): ReferenceSubtotal {
  const netByAccount = emptyTotals()
  let appliedEntries = 0
  for (const row of [...rows, ...correction.add]) {
    if (row.id === correction.remove) continue
    const account = row.id === correction.move.id ? correction.move.account : row.account
    netByAccount[account] += row.amount
    appliedEntries++
  }
  return { slots: [slot], netByAccount, appliedEntries }
}

function remember(view: NodeView): void {
  const state = view.state
  state.initialPeers ??= collaborationPeers(view.nodes, view.node.id)
  for (const mail of view.inbox) {
    if (mail.toId !== view.node.id || mail.status !== 'delivered' || state.seenMail.has(mail.id)) continue
    state.seenMail.add(mail.id)
    let message: SubtotalMessage
    try { message = JSON.parse(mail.body) as SubtotalMessage } catch { continue }
    if (message.type !== 'reference-subtotals' || message.phase !== 2) continue
    for (const part of message.subtotals) {
      const key = subtotalKey(part)
      const previous = state.known.get(key)
      if (previous && JSON.stringify(previous) !== JSON.stringify(part)) throw new Error(`Conflicting reference subtotal for ${key}`)
      if (message.role === 'tree-final') state.final = part
      else state.known.set(key, part)
      if (message.role === 'tree-up') state.treeChildren.set(mail.fromId, part)
      const sent = state.sent.get(mail.fromId) ?? new Set<string>()
      sent.add(key)
      state.sent.set(mail.fromId, sent)
    }
  }
}

/** Each read action performs exactly one read_document-equivalent ACL access. */
function readNext(view: NodeView, scenario: TopologyScenario): Action | null {
  const state = view.state
  if (state.phase !== view.phase || state.refreshDocuments) {
    const mine = scenario.read(view.node.sessionId, 'mine') as { slot: number; phase: 1 | 2; documents: string[] }
    state.phase = mine.phase
    state.slot = mine.slot
    state.refreshDocuments = false
    state.documents = mine.documents.filter(id => {
      const slot = Number(id.slice(id.indexOf('-') + 1))
      return !state.local.has(slot) && (!id.startsWith('initial-') || !state.initial.has(slot))
    })
    return { type: 'read', ids: ['mine'] }
  }
  const id = state.documents[0]
  if (!id) return null
  const slot = Number(id.slice(id.indexOf('-') + 1))
  const document = scenario.read(view.node.sessionId, id) as { data: LedgerEntry[] | LedgerShard['correction'] }
  state.documents.shift()
  if (id.startsWith('initial-')) state.initial.set(slot, document.data as LedgerEntry[])
  else {
    const initial = state.initial.get(slot)
    if (!initial) throw new Error(`Correction ${id} has no locally read initial evidence`)
    const part = subtotal(slot, initial, document.data as LedgerShard['correction'])
    state.local.set(slot, part)
    state.known.set(subtotalKey(part), part)
    // Raw input is no longer needed after its local correction is applied.
    state.initial.delete(slot)
  }
  return { type: 'read', ids: [id] }
}

/** Every idle node follows the same rule; the scheduler does not choose a backup. */
function recover(view: NodeView, scenario: TopologyScenario): Action | null {
  if (scenario.recoveryMode !== 'self-organized' || view.state.claimed
    || view.tasks.some(task => task.holderId === view.node.id && task.status === 'open')) return null
  const orphan = view.tasks.find(task => scenario.recoverySlot(task.id) !== undefined
    && (task.status === 'unreachable' || task.status === 'failed')
    && !view.tasks.some(candidate => candidate.retryOf === task.id))
  if (!orphan) return null
  view.state.claimed = true
  view.state.refreshDocuments = true
  return { type: 'claim', taskId: orphan.id }
}

function recoveryReady(view: NodeView, scenario: TopologyScenario): boolean {
  return !view.tasks.some(task => scenario.recoverySlot(task.id) !== undefined
    && task.status !== 'completed' && !view.tasks.some(candidate => candidate.retryOf === task.id))
}

/** Control-only settlement must not become a hidden payload shortcut to a parent. */
function settleLocalTask(view: NodeView): Action | null {
  if (view.node.id === view.entryNodeId) return null
  const task = view.tasks.find(candidate => candidate.holderId === view.node.id && candidate.status === 'open')
  if (!task) return null
  return { type: 'send', input: { to: task.requesterId, kind: 'result', taskId: task.id,
    body: JSON.stringify({ type: 'reference-work-complete', phase: 2 }),
    summary: 'Local corrected subtotals computed; exchange follows collaboration edges.', evidence: [] } }
}

function sendParts(view: NodeView, to: string, parts: ReferenceSubtotal[], role?: SubtotalMessage['role']): Action {
  const sent = view.state.sent.get(to) ?? new Set<string>()
  parts.forEach(part => sent.add(subtotalKey(part)))
  view.state.sent.set(to, sent)
  return { type: 'send', input: { to, kind: 'note', body: JSON.stringify({
    type: 'reference-subtotals', phase: 2, subtotals: parts, ...(role ? { role } : {}),
  } satisfies SubtotalMessage) } }
}

function complete(view: NodeView, scenario: TopologyScenario, parts: readonly ReferenceSubtotal[]): Action | null {
  if (view.node.id !== view.entryNodeId || !view.canDeliver) return null
  const result = aggregate(parts)
  if (result.slots.length !== scenario.task.agents || result.slots.some((slot, index) => slot !== index)) return null
  // The public task contract defines the document-id grammar. No values or
  // evidence lists are taken from the host's private oracle or shard fixtures.
  const evidence = result.slots.flatMap(slot => [`initial-${slot}`, `correction-${slot}`])
  return { type: 'deliver', input: { goalVersion: view.goalVersion, evidence,
    summary: JSON.stringify({ phase: 2, netByAccount: result.netByAccount, evidence }) } }
}

/** A packet goes over actual directed edges, including every intermediate hop. */
function nextHop(view: NodeView): string | null {
  const queue: string[][] = [[view.node.id]]
  const seen = new Set([view.node.id])
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index]!
    for (const peer of collaborationPeers(view.nodes, path[path.length - 1]!)) {
      if (seen.has(peer)) continue
      const next = [...path, peer]
      if (peer === view.entryNodeId) return next[1]!
      seen.add(peer)
      queue.push(next)
    }
  }
  return null
}

export const hub: ReferencePolicy = async (view, scenario) => {
  remember(view)
  const reading = readNext(view, scenario)
  if (reading || view.phase !== 2) return reading
  const settlement = settleLocalTask(view)
  if (settlement) return settlement
  const claiming = recover(view, scenario)
  if (claiming) return claiming
  if (view.node.id === view.entryNodeId) return complete(view, scenario, [...view.state.known.values()])
  const to = nextHop(view)
  if (!to) throw new Error(`No collaboration route from ${view.node.id} to the hub`)
  const parts = [...view.state.known.values()].filter(part => !view.state.sent.get(to)?.has(subtotalKey(part)))
  return parts.length ? sendParts(view, to, parts) : null
}

function gossip(view: NodeView, scenario: TopologyScenario): Action | null {
  const settlement = settleLocalTask(view)
  if (settlement) return settlement
  const claiming = recover(view, scenario)
  if (claiming) return claiming
  for (const to of collaborationPeers(view.nodes, view.node.id)) {
    const parts = [...view.state.known.values()].filter(part => !view.state.sent.get(to)?.has(subtotalKey(part)))
    if (parts.length) return sendParts(view, to, parts)
  }
  return complete(view, scenario, [...view.state.known.values()])
}

export const ringGossip: ReferencePolicy = async (view, scenario) => {
  remember(view)
  const reading = readNext(view, scenario)
  return reading || view.phase !== 2 ? reading : gossip(view, scenario)
}

function activeParent(view: NodeView, node: NodeRecord): string | null {
  let id = node.creatorId
  const visited = new Set<string>()
  while (id !== null) {
    if (visited.has(id)) throw new Error('Cycle in reference birth tree')
    visited.add(id)
    const parent = view.nodes[id]
    if (!parent) throw new Error(`Missing reference birth parent ${id}`)
    if (parent.lifecycle === 'active') return parent.id
    id = parent.creatorId
  }
  return null
}

/** The seed birth tree is a chain; each edge still carries one summed vector. */
export const treeAggregate: ReferencePolicy = async (view, scenario) => {
  remember(view)
  const reading = readNext(view, scenario)
  if (reading || view.phase !== 2) return reading
  const settlement = settleLocalTask(view)
  if (settlement) return settlement
  const claiming = recover(view, scenario)
  if (claiming) return claiming
  if (!recoveryReady(view, scenario)) return null
  const children = Object.values(view.nodes).filter(node => node.lifecycle === 'active'
    && activeParent(view, node) === view.node.id)
  if (!view.state.final) {
    if (children.some(child => !view.state.treeChildren.has(child.id))) return null
    const combined = aggregate([...view.state.local.values(), ...view.state.treeChildren.values()])
    if (view.node.id === view.entryNodeId) view.state.final = combined
    else {
      if (view.state.treeSent) return null // Wait for the root's downward final aggregate.
      const parent = activeParent(view, view.node)
      if (!parent || !collaborationPeers(view.nodes, view.node.id).includes(parent)) {
        throw new Error(`Birth-tree aggregation edge from ${view.node.id} is unavailable`)
      }
      view.state.treeSent = true
      return sendParts(view, parent, [combined], 'tree-up')
    }
  }
  for (const child of children) {
    if (view.state.finalSent.has(child.id)) continue
    if (!collaborationPeers(view.nodes, view.node.id).includes(child.id)) {
      throw new Error(`Birth-tree dissemination edge ${view.node.id} -> ${child.id} is unavailable`)
    }
    view.state.finalSent.add(child.id)
    return sendParts(view, child.id, [view.state.final], 'tree-final')
  }
  return complete(view, scenario, [view.state.final])
}

export const adaptive: ReferencePolicy = async (view, scenario) => {
  remember(view)
  const reading = readNext(view, scenario)
  if (reading || view.phase !== 2) return reading
  if (!view.state.rewired && view.state.initialPeers!.some(id => view.nodes[id]?.lifecycle !== 'active')) {
    view.state.rewired = true
    const peers = collaborationPeers(view.nodes, view.node.id)
    const replacement = Object.values(view.nodes).find(node => node.lifecycle === 'active'
      && node.id !== view.node.id && !peers.includes(node.id))
    // Runtime repair already fills dead slots. Explicitly explore a different
    // surviving collaborator to measure an actual atn_rewire operation too.
    if (replacement) return { type: 'rewire', input: {
      peers: [...peers.slice(0, Math.max(0, peers.length - 1)), replacement.id], intent: 'exploration',
    } }
  }
  return gossip(view, scenario)
}

export const referencePolicies: Record<ReferencePolicyName, ReferencePolicy> = {
  hub, 'ring-gossip': ringGossip, 'tree-aggregate': treeAggregate, adaptive,
}
