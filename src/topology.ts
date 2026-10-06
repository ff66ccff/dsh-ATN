/**
 * Pure collaboration graph operations and legacy birth-neighbour derivation.
 *
 * The neighbourhood is derived from the birth lineage (`creatorId`) upward and
 * the selected-branch path (`selectedChildId`) downward. Non-`active` nodes are
 * skipped so a retiring or retired node leaves the current topology without
 * rewriting anyone's birth origin. The walk never crosses into a sibling
 * branch: when the selected path ends, the slot stays empty.
 *
 * Corrupt lineage (a dangling reference or a cycle) fails loudly instead of
 * quietly constructing a different graph.
 * @module dsh-atn/topology
 */
import type { NetworkRecord, NodeId, NodeRecord } from './schema.ts'

/** How many neighbours each direction holds. */
export const NEIGHBOURS_PER_DIRECTION = 2

/** Hard compatibility ceiling; a network may freeze a lower outgoing limit. */
export const MAX_COLLABORATION_PEERS = 4

function checkedPeerLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_COLLABORATION_PEERS) {
    throw new TopologyError('invalid-peer-limit', `maxCollaborationPeers must be an integer from 1 to ${MAX_COLLABORATION_PEERS}`)
  }
  return limit
}

/** Legacy records that omit the frozen network limit retain four outgoing slots. */
export function collaborationPeerLimit(record: Pick<NetworkRecord, 'limits'>): number {
  return checkedPeerLimit(record.limits.maxCollaborationPeers ?? MAX_COLLABORATION_PEERS)
}

/** Ordered neighbour slots of one node. */
export interface Neighbourhood {
  /** The node the neighbourhood was derived for. */
  readonly self: NodeId
  /** Nearest `active` ancestors along the birth lineage, nearest first. */
  readonly upstream: readonly NodeId[]
  /** Nearest `active` descendants along the selected-child path, nearest first. */
  readonly downstream: readonly NodeId[]
}

/** Why neighbour derivation refused to produce a graph. */
export type TopologyErrorCode =
  | 'unknown-node'
  | 'dangling-link'
  | 'lineage-cycle'
  | 'network-closed'
  | 'not-active'
  | 'target-not-active'
  | 'self-link'
  | 'duplicate-peer'
  | 'too-many-peers'
  | 'invalid-peer-limit'

/** Raised when stored lineage cannot describe a valid path. */
export class TopologyError extends Error {
  /** Machine-readable cause. */
  readonly code: TopologyErrorCode

  /**
   * @param code - Machine-readable cause.
   * @param message - Human-readable detail naming the offending record.
   */
  constructor(code: TopologyErrorCode, message: string) {
    super(message)
    this.name = 'TopologyError'
    this.code = code
  }
}

/** True when a node can take on new tasks and new proposals. */
export function isReceivable(node: NodeRecord): boolean {
  return node.lifecycle === 'active'
}

function resolve(nodes: Readonly<Record<NodeId, NodeRecord>>, id: NodeId, origin: NodeId, direction: string): NodeRecord {
  const node = nodes[id]
  if (!node) {
    throw new TopologyError('dangling-link', `${direction} link from ${origin} points at missing node ${id}`)
  }
  return node
}

/**
 * Derive the four neighbourhood slots of one node.
 *
 * @param nodes - Every node record of the network.
 * @param nodeId - The node whose neighbourhood is requested.
 * @returns Up to two `active` ancestors and two `active` selected descendants, nearest first.
 * @throws TopologyError when the node is unknown, a lineage link dangles, or a chain cycles.
 */
export function deriveNeighbourhood(nodes: Readonly<Record<NodeId, NodeRecord>>, nodeId: NodeId): Neighbourhood {
  const self = nodes[nodeId]
  if (!self) throw new TopologyError('unknown-node', `node ${nodeId} is not part of this network`)
  const seen = new Set<NodeId>([self.id])

  const upstream: NodeId[] = []
  let cursor: NodeId | null = self.creatorId
  while (cursor !== null && upstream.length < NEIGHBOURS_PER_DIRECTION) {
    if (seen.has(cursor)) {
      throw new TopologyError('lineage-cycle', `creator chain of ${nodeId} revisits ${cursor}`)
    }
    seen.add(cursor)
    const node = resolve(nodes, cursor, nodeId, 'creator')
    if (isReceivable(node)) upstream.push(node.id)
    cursor = node.creatorId
  }

  const downstream: NodeId[] = []
  cursor = self.selectedChildId
  while (cursor !== null && downstream.length < NEIGHBOURS_PER_DIRECTION) {
    if (seen.has(cursor)) {
      throw new TopologyError('lineage-cycle', `selected-child path of ${nodeId} revisits ${cursor}`)
    }
    seen.add(cursor)
    const node = resolve(nodes, cursor, nodeId, 'selected-child')
    if (isReceivable(node)) downstream.push(node.id)
    cursor = node.selectedChildId
  }

  return { self: self.id, upstream, downstream }
}

/**
 * Flatten a neighbourhood into the ordered slot list used by legacy graph
 * bootstrap and discovery: upstream nearest first, then downstream nearest first.
 *
 * @param neighbourhood - Result of {@link deriveNeighbourhood}.
 * @returns The neighbour ids without the node itself.
 */
export function neighbourIds(neighbourhood: Neighbourhood): NodeId[] {
  return [...neighbourhood.upstream, ...neighbourhood.downstream]
}

/**
 * Resolve the downstream node that should hold newly created children, walking
 * the selected path outward and skipping nodes that cannot receive work.
 *
 * @param nodes - Every node record of the network.
 * @param nodeId - The spawning node.
 * @returns The nearest `active` selected descendant, or `null` at the end of the path.
 */
export function nearestReceivingDescendant(
  nodes: Readonly<Record<NodeId, NodeRecord>>,
  nodeId: NodeId,
): NodeId | null {
  const { downstream } = deriveNeighbourhood(nodes, nodeId)
  return downstream[0] ?? null
}

function isCollaborator(node: NodeRecord): boolean {
  return node.lifecycle === 'active' && node.creationState === 'published'
}

function recordedPeers(nodes: Readonly<Record<NodeId, NodeRecord>>, node: NodeRecord): readonly NodeId[] {
  return node.peerIds ?? neighbourIds(deriveNeighbourhood(nodes, node.id))
}

/**
 * Read effective directed collaboration links. Missing lists bootstrap from the
 * old lineage. Explicit lists, including [], are authoritative.
 *
 * Active neighbours keep their slots. For each inactive link, one replacement
 * may be found by breadth-first traversal through inactive nodes' recorded
 * links. Active nodes stop traversal: repair never explores through a live
 * collaborator or adds links merely because unused capacity is available.
 */
export function collaborationPeers(
  nodes: Readonly<Record<NodeId, NodeRecord>>,
  nodeId: NodeId,
  limit = MAX_COLLABORATION_PEERS,
): NodeId[] {
  checkedPeerLimit(limit)
  const self = nodes[nodeId]
  if (self === undefined) throw new TopologyError('unknown-node', `node ${nodeId} is not part of this network`)
  const peers: NodeId[] = []
  const inactive: NodeId[] = []
  const seen = new Set<NodeId>([nodeId])
  for (const id of recordedPeers(nodes, self).slice(0, limit)) {
    if (seen.has(id)) continue
    seen.add(id)
    const peer = resolve(nodes, id, nodeId, 'collaboration')
    if (isCollaborator(peer)) peers.push(id)
    else inactive.push(id)
  }

  const capacity = Math.min(limit, peers.length + inactive.length)
  const queue = [...inactive]
  for (let index = 0; index < queue.length && peers.length < capacity; index += 1) {
    const current = nodes[queue[index]]!
    for (const id of recordedPeers(nodes, current).slice(0, limit)) {
      if (seen.has(id)) continue
      seen.add(id)
      const peer = resolve(nodes, id, current.id, 'collaboration')
      if (isCollaborator(peer)) peers.push(id)
      else queue.push(id)
      if (peers.length >= capacity) break
    }
  }
  return peers.slice(0, limit)
}

function requireOpen(record: NetworkRecord): void {
  if (record.status !== 'open') {
    throw new TopologyError('network-closed', `network ${record.id} is ${record.status}`)
  }
}

function requireActiveNode(record: NetworkRecord, nodeId: NodeId): NodeRecord {
  const node = record.nodes[nodeId]
  if (node === undefined) throw new TopologyError('unknown-node', `node ${nodeId} is not part of network ${record.id}`)
  if (!isCollaborator(node)) {
    throw new TopologyError('not-active', `node ${nodeId} must be active and published to choose collaborators`)
  }
  return node
}

function samePeers(left: readonly NodeId[] | undefined, right: readonly NodeId[]): boolean {
  return left !== undefined && left.length === right.length && left.every((id, index) => id === right[index])
}

/** Replace only this node's outgoing links; no birth records or other votes change. */
export function rewireNode(record: NetworkRecord, nodeId: NodeId, peers: readonly NodeId[]): NetworkRecord {
  requireOpen(record)
  const self = requireActiveNode(record, nodeId)
  const limit = collaborationPeerLimit(record)
  if (peers.length > limit) {
    throw new TopologyError('too-many-peers', `a node may choose at most ${limit} collaborators`)
  }
  const seen = new Set<NodeId>()
  for (const id of peers) {
    if (id === nodeId) throw new TopologyError('self-link', 'a node cannot choose itself as a collaborator')
    if (seen.has(id)) throw new TopologyError('duplicate-peer', `collaborator ${id} was listed more than once`)
    seen.add(id)
    const peer = record.nodes[id]
    if (peer === undefined) throw new TopologyError('unknown-node', `node ${id} is not part of network ${record.id}`)
    if (!isCollaborator(peer)) {
      throw new TopologyError('target-not-active', `collaborator ${id} must be active and published`)
    }
  }
  if (samePeers(self.peerIds, peers)) return record
  return { ...record, nodes: { ...record.nodes, [nodeId]: { ...self, peerIds: [...peers] } } }
}

/**
 * Persist bootstrap and inactive-link repair from one shared graph snapshot.
 * Published inactive nodes retain their last links so neighbours can bridge
 * through them. Provisioning nodes wait for connectPublishedNode; closed
 * networks are unchanged.
 */
export function reconcileTopology(record: NetworkRecord): NetworkRecord {
  if (record.status !== 'open') return record
  const limit = collaborationPeerLimit(record)
  let nodes = record.nodes
  for (const node of Object.values(record.nodes)) {
    // Preserve departed nodes' exit links for local repair, within this network's
    // frozen cap. Pending nodes still wait for publication to acquire any links.
    if (node.creationState !== 'published' || (node.lifecycle !== 'active' && node.peerIds !== undefined)) {
      if (node.peerIds !== undefined && node.peerIds.length > limit) {
        if (nodes === record.nodes) nodes = { ...record.nodes }
        nodes[node.id] = { ...node, peerIds: node.peerIds.slice(0, limit) }
      }
      continue
    }
    const peers = collaborationPeers(record.nodes, node.id, limit)
    if (samePeers(node.peerIds, peers)) continue
    if (nodes === record.nodes) nodes = { ...record.nodes }
    nodes[node.id] = { ...node, peerIds: peers }
  }
  return nodes === record.nodes ? record : { ...record, nodes }
}

/**
 * Give a newly published node a small initial neighbourhood. The creator adds
 * the new node only when it has a free slot; existing links are never evicted.
 * An already initialized node is left alone, including an explicitly empty
 * list, making recovery retries unable to undo subsequent model choices.
 */
export function connectPublishedNode(record: NetworkRecord, nodeId: NodeId): NetworkRecord {
  requireOpen(record)
  const node = requireActiveNode(record, nodeId)
  const limit = collaborationPeerLimit(record)
  if (node.peerIds !== undefined) return record
  if (node.creatorId === null) {
    return { ...record, nodes: { ...record.nodes, [nodeId]: { ...node, peerIds: [] } } }
  }
  const creator = resolve(record.nodes, node.creatorId, nodeId, 'creator')
  const creatorPeers = collaborationPeers(record.nodes, creator.id, limit)
  const peers = [...new Set([creator.id, ...creatorPeers])]
    .filter(id => id !== nodeId && isCollaborator(record.nodes[id]!))
    .slice(0, limit)
  const nodes = { ...record.nodes, [nodeId]: { ...node, peerIds: peers } }
  if (isCollaborator(creator)) {
    const nextCreatorPeers = creatorPeers.includes(nodeId) || creatorPeers.length >= limit
      ? creatorPeers
      : [...creatorPeers, nodeId]
    if (!samePeers(creator.peerIds, nextCreatorPeers)) nodes[creator.id] = { ...creator, peerIds: nextCreatorPeers }
  }
  return { ...record, nodes }
}
