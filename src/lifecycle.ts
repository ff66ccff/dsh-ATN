/**
 * Node lifecycle transitions and the creation/recovery decisions around them.
 *
 * A node is durable before it is visible: creation writes a `provisioning`
 * record first, and only a successful publish makes it available and lets it
 * claim the `selected_child` slot. Retirement is a two-step move: `draining`
 * stops new work, and the node reaches `retired` only once its existing tasks
 * and review obligations are settled.
 * @module dsh-atn/lifecycle
 */
import type { NetworkRecord, NodeLifecycle, NodeRecord } from './schema.ts'
import { openTasksOf } from './tasks.ts'
import { pendingVotesFor, pendingProposals } from './proposals.ts'

/** Why a lifecycle transition was refused. */
export type LifecycleErrorCode = 'unknown-node' | 'not-published' | 'not-active' | 'terminal'

/** Raised when a lifecycle transition is not legal from the node's current state. */
export class LifecycleError extends Error {
  /** Machine-readable cause. */
  readonly code: LifecycleErrorCode

  /**
   * @param code - Machine-readable cause.
   * @param message - Human-readable detail.
   */
  constructor(code: LifecycleErrorCode, message: string) {
    super(message)
    this.name = 'LifecycleError'
    this.code = code
  }
}

/**
 * Publish a provisioned node: mark it available and let the first successfully
 * published child claim its creator's `selected_child` slot.
 *
 * The claim is evaluated inside the same atomic network update that publishes
 * the node, so two concurrent creations cannot both believe they were first.
 *
 * @param record - Current network record, with the node still `provisioning`.
 * @param sessionId - Session id of the created node.
 * @param now - Publish timestamp (epoch ms).
 * @returns The updated record and the published node id.
 * @throws LifecycleError when the node is unknown, already published, or the creator cannot hold a child.
 */
export function publishNode(record: NetworkRecord, sessionId: string, now: number): { record: NetworkRecord; nodeId: string } {
  const node = findBySession(record, sessionId)
  if (node === undefined) throw new LifecycleError('unknown-node', `no node record for session ${sessionId}`)
  if (node.creationState === 'published') return { record, nodeId: node.id }
  if (node.creationState === 'failed') {
    throw new LifecycleError('terminal', `node ${node.id} is recorded as failed and cannot be published`)
  }

  const nodes = { ...record.nodes, [node.id]: { ...node, creationState: 'published' as const, lifecycle: 'active' as const } }
  const creatorId = node.creatorId
  if (creatorId !== null) {
    const creator = nodes[creatorId]
    if (creator === undefined) {
      throw new LifecycleError('unknown-node', `creator ${creatorId} of node ${node.id} is missing`)
    }
    if (creator.selectedChildId === null) {
      nodes[creatorId] = { ...creator, selectedChildId: node.id }
    }
  }
  return { record: { ...record, nodes }, nodeId: node.id }
}

/**
 * Record that provisioning failed, releasing the reserved slot and keeping an
 * explicit failure fact instead of a node that claims to exist.
 *
 * @param record - Current network record.
 * @param sessionId - Session id whose creation failed.
 * @param note - Human-readable failure reason.
 * @returns The updated record.
 */
export function failProvisioning(record: NetworkRecord, sessionId: string, note: string): NetworkRecord {
  const node = findBySession(record, sessionId)
  if (node === undefined) return record
  return {
    ...record,
    nodes: {
      ...record.nodes,
      [node.id]: { ...node, creationState: 'failed', lifecycle: 'failed', note },
    },
  }
}

/**
 * Move a node into `draining`: it leaves the current topology and takes no new
 * task or proposal, but keeps its existing tasks and already assigned review
 * obligations.
 *
 * @param record - Current network record.
 * @param nodeId - Node requesting retirement.
 * @param note - Why the node is retiring.
 * @returns The updated record.
 * @throws LifecycleError when the node is unknown or already terminal.
 */
export function requestDrain(record: NetworkRecord, nodeId: string, note: string): NetworkRecord {
  const node = record.nodes[nodeId]
  if (node === undefined) throw new LifecycleError('unknown-node', `node ${nodeId} is not part of network ${record.id}`)
  if (node.lifecycle === 'retired' || node.lifecycle === 'failed') {
    throw new LifecycleError('terminal', `node ${nodeId} is already ${node.lifecycle}`)
  }
  if (node.lifecycle === 'draining') return record
  return { ...record, nodes: { ...record.nodes, [nodeId]: { ...node, lifecycle: 'draining', note } } }
}

/**
 * Whether a node still owes work to the network.
 *
 * @param record - Current network record.
 * @param nodeId - Node to inspect.
 * @returns The obligations that keep the node from being released.
 */
export function outstandingObligations(record: NetworkRecord, nodeId: string): { tasks: string[]; proposals: string[] } {
  return {
    tasks: openTasksOf(record, nodeId).map((task) => task.id),
    proposals: pendingVotesFor(record, nodeId).map((proposal) => proposal.id),
  }
}

/**
 * Decide whether a draining node can be released: a node already recorded its
 * own vote, so it does not wait for the other approvers.
 *
 * @param record - Current network record.
 * @param nodeId - Node to inspect.
 * @returns True when no task and no uncast vote remains.
 */
export function canRelease(record: NetworkRecord, nodeId: string): boolean {
  const obligations = outstandingObligations(record, nodeId)
  return obligations.tasks.length === 0 && obligations.proposals.length === 0
}

/**
 * Retire a draining node that has settled everything it owed.
 *
 * @param record - Current network record.
 * @param nodeId - Node to retire.
 * @param now - Retirement timestamp (epoch ms).
 * @returns The updated record; the node is left untouched when obligations remain.
 */
export function retireIfSettled(record: NetworkRecord, nodeId: string, now: number): NetworkRecord {
  const node = record.nodes[nodeId]
  if (node === undefined || node.lifecycle !== 'draining') return record
  if (!canRelease(record, nodeId)) return record
  return {
    ...record,
    nodes: { ...record.nodes, [nodeId]: { ...node, lifecycle: 'retired', leaseDeadlineAt: null, note: node.note ?? 'retired after settling its work' } },
  }
}

/**
 * Release every draining node whose obligations are settled.
 *
 * @param record - Current network record.
 * @param now - Evaluation timestamp (epoch ms).
 * @returns The updated record.
 */
export function retireSettledNodes(record: NetworkRecord, now: number): NetworkRecord {
  let next = record
  for (const node of Object.values(record.nodes)) {
    if (node.lifecycle === 'draining') next = retireIfSettled(next, node.id, now)
  }
  return next
}

/** What recovery decided for one node that was not cleanly stopped. */
export type RecoveryAction = 'leave' | 'resume' | 'rebuild' | 'fail'

/** The recovery decision for one node, with its reason. */
export interface RecoveryDecision {
  /** Node being considered. */
  readonly nodeId: string
  /** Action to take. */
  readonly action: RecoveryAction
  /** Why this action was chosen. */
  readonly reason: string
}

/**
 * Decide what a restarted runtime must do with each stored node.
 *
 * `retired` and `failed` nodes are never revived, and a terminal network is
 * never reopened. A `provisioning` node whose creation intent outlived the
 * process is either rebuilt on its recorded session or failed — never silently
 * re-published as a second node with the same identity.
 *
 * @param record - Stored network record.
 * @param sessionExists - Predicate telling whether a session is already persisted on the medium.
 * @returns One decision per node, in creation order.
 */
export function planRecovery(record: NetworkRecord, sessionExists: (sessionId: string) => boolean): RecoveryDecision[] {
  const decisions: RecoveryDecision[] = []
  const nodes = Object.values(record.nodes).sort((left, right) => left.createdAt - right.createdAt)
  for (const node of nodes) {
    if (record.status !== 'open') {
      decisions.push({ nodeId: node.id, action: 'leave', reason: `network is ${record.status}` })
      continue
    }
    if (node.lifecycle === 'retired' || node.lifecycle === 'failed') {
      decisions.push({ nodeId: node.id, action: 'leave', reason: `node is ${node.lifecycle}` })
      continue
    }
    if (node.creationState === 'pending') {
      decisions.push({
        nodeId: node.id,
        action: sessionExists(node.sessionId) ? 'resume' : 'fail',
        reason: sessionExists(node.sessionId)
          ? 'creation intent survived but the node was never published; its session exists, so it can be rebuilt'
          : 'creation intent survived, no session was ever persisted, so the creation failed',
      })
      continue
    }
    decisions.push({ nodeId: node.id, action: 'resume', reason: `node is ${node.lifecycle} and published` })
  }
  return decisions
}

/**
 * Look up one node by its backing session.
 *
 * @param record - Current network record.
 * @param sessionId - Session id.
 * @returns The node record, or `undefined`.
 */
export function findBySession(record: NetworkRecord, sessionId: string): NodeRecord | undefined {
  return Object.values(record.nodes).find((node) => node.sessionId === sessionId)
}

/**
 * Record that a node's live model input has actually been given one goal
 * revision. The value is a durable fact about the session, not about the
 * network, so it is what recovery replays when a commit happened while the node
 * had no live Agent.
 *
 * @param record - Current network record.
 * @param nodeId - Node whose context was synced.
 * @param version - Revision that was handed to the node.
 * @returns The updated record; an older version never moves the counter back.
 */
export function markGoalSynced(record: NetworkRecord, nodeId: string, version: number): NetworkRecord {
  const node = record.nodes[nodeId]
  if (node === undefined) return record
  if ((node.lastGoalVersionSent ?? 0) >= version) return record
  return { ...record, nodes: { ...record.nodes, [nodeId]: { ...node, lastGoalVersionSent: version } } }
}

/**
 * Whether a lifecycle may take on new tasks and new proposals.
 *
 * @param lifecycle - Lifecycle to test.
 * @returns True only for `active`.
 */
export function acceptsNewWork(lifecycle: NodeLifecycle): boolean {
  return lifecycle === 'active'
}

/**
 * Nodes that still hold an uncast vote on any pending proposal, used to report
 * why a network cannot be considered settled.
 *
 * @param record - Current network record.
 * @returns Node ids with outstanding review obligations.
 */
export function nodesWithReviewObligations(record: NetworkRecord): string[] {
  const ids = new Set<string>()
  for (const proposal of pendingProposals(record)) {
    for (const voter of proposal.voters) {
      if (!proposal.votes.some((vote) => vote.voterId === voter)) ids.add(voter)
    }
  }
  return [...ids]
}
