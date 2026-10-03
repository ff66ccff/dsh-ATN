/**
 * Pure neighbour derivation over persistent node records.
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
import type { NodeId, NodeRecord } from './schema.ts'

/** How many neighbours each direction holds. */
export const NEIGHBOURS_PER_DIRECTION = 2

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
export type TopologyErrorCode = 'unknown-node' | 'dangling-link' | 'lineage-cycle'

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
 * Flatten a neighbourhood into the ordered slot list used by approval lists and
 * discovery results: upstream nearest first, then downstream nearest first.
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
