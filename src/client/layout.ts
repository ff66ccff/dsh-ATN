/** Deterministic graph coordinates avoid drift while topology is unchanged. */
import type { AtnNodeView } from '../observer-types.ts'

/** A node's logical canvas position. */
export interface Point { x: number; y: number }

/**
 * Position an entry node centrally and other nodes in concentric rings.
 * Coordinates depict adjacency through edges, without claiming spatial semantics.
 * @param nodes - Observer nodes in durable creation order.
 * @param entryNodeId - Stable entry node identity.
 * @returns Coordinates indexed by node id.
 */
export function layoutNodes(nodes: readonly AtnNodeView[], entryNodeId: string): Map<string, Point> {
  const points = new Map<string, Point>()
  const others = nodes.filter(node => node.id !== entryNodeId)
  if (nodes.some(node => node.id === entryNodeId)) points.set(entryNodeId, { x: 420, y: 280 })
  for (let index = 0; index < others.length; index++) {
    const ring = Math.floor(index / 10)
    const inRing = index % 10
    const count = Math.min(10, others.length - ring * 10)
    const angle = -Math.PI / 2 + inRing * Math.PI * 2 / count
    const radius = 170 + ring * 130
    points.set(others[index].id, { x: 420 + Math.cos(angle) * radius * 1.35, y: 280 + Math.sin(angle) * radius })
  }
  return points
}

/**
 * Trim a directed line to its nodes' visible radii.
 * @param from - Source node center.
 * @param to - Target node center.
 * @returns SVG line endpoints with the arrow outside the node circle.
 */
export function edgeLine(from: Point, to: Point): { x1: number; y1: number; x2: number; y2: number } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.max(1, Math.hypot(dx, dy))
  return { x1: from.x + dx * 28 / length, y1: from.y + dy * 28 / length, x2: to.x - dx * 34 / length, y2: to.y - dy * 34 / length }
}
