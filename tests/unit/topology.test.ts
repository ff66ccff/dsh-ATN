/**
 * Neighbour derivation: four slots, skipping non-active nodes, no invented
 * placeholders, and loud failure on corrupt lineage.
 * @module dsh-atn/tests/unit/topology
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { deriveNeighbourhood, neighbourIds, TopologyError } from '../../src/topology.ts'
import { makeChain, makeNode } from '../fixtures/network.ts'

test('TOPO-01: a middle node of a long chain has exactly two ancestors and two selected descendants', () => {
  const network = makeChain(['A', 'B', 'C', 'D', 'E'])
  const hood = deriveNeighbourhood(network.nodes, 'C')
  assert.deepEqual(hood.upstream, ['B', 'A'])
  assert.deepEqual(hood.downstream, ['D', 'E'])
  assert.deepEqual(neighbourIds(hood), ['B', 'A', 'D', 'E'])
})

test('TOPO-01: chain ends do not get placeholder neighbours', () => {
  const network = makeChain(['A', 'B', 'C', 'D'])
  assert.deepEqual(deriveNeighbourhood(network.nodes, 'A').upstream, [])
  assert.deepEqual(deriveNeighbourhood(network.nodes, 'D').downstream, [])
})

test('TOPO-02: a second branch becomes a child but never replaces the first selected child', () => {
  const network = makeChain(['A', 'B', 'C'])
  network.nodes['X'] = makeNode('X', { creatorId: 'A', selectedChildId: 'Y' })
  network.nodes['Y'] = makeNode('Y', { creatorId: 'X' })

  assert.equal(network.nodes['A']!.selectedChildId, 'B')
  const a = deriveNeighbourhood(network.nodes, 'A')
  // The selected path is A -> B -> C; X never enters it.
  assert.deepEqual(a.downstream, ['B', 'C'])

  const x = deriveNeighbourhood(network.nodes, 'X')
  assert.deepEqual(x.upstream, ['A'])
  assert.deepEqual(x.downstream, ['Y'])
  // The neighbourhood is not symmetric: X takes A upstream, A never takes X downstream.
  assert.ok(!neighbourIds(a).includes('X'))
})

test('TOPO-04: a draining node leaves both directions without rewriting birth origins', () => {
  const network = makeChain(['A', 'B', 'C', 'D'])
  network.nodes['B'] = { ...network.nodes['B']!, lifecycle: 'draining' }

  const c = deriveNeighbourhood(network.nodes, 'C')
  assert.deepEqual(c.upstream, ['A'])
  assert.deepEqual(c.downstream, ['D'])

  const a = deriveNeighbourhood(network.nodes, 'A')
  assert.deepEqual(a.downstream, ['C', 'D'])

  assert.equal(network.nodes['C']!.creatorId, 'B', 'the recorded creator is untouched by retirement')
})

test('TOPO-05: an idle but active node stays in the neighbourhood', () => {
  const network = makeChain(['A', 'B', 'C'])
  // An active node that holds no in-flight request is still a neighbour.
  assert.deepEqual(neighbourIds(deriveNeighbourhood(network.nodes, 'C')), ['B', 'A'])
})

test('TOPO-04: a retired node is skipped but still spans the path', () => {
  const network = makeChain(['A', 'B', 'C', 'D', 'E'])
  network.nodes['C'] = { ...network.nodes['C']!, lifecycle: 'retired' }
  const d = deriveNeighbourhood(network.nodes, 'D')
  assert.deepEqual(d.upstream, ['B', 'A'])
  assert.deepEqual(d.downstream, ['E'])
})

test('TOPO-06: the walk stops at the end of the selected path instead of crossing branches', () => {
  const network = makeChain(['A', 'B'])
  network.nodes['X'] = makeNode('X', { creatorId: 'A' })
  network.nodes['Y'] = makeNode('Y', { creatorId: 'X' })
  // B has no selected child, so its downstream slot stays empty even though X/Y exist.
  assert.deepEqual(deriveNeighbourhood(network.nodes, 'B').downstream, [])
})

test('TOPO-06: a dangling lineage link fails loudly', () => {
  const network = makeChain(['A', 'B'])
  network.nodes['B'] = { ...network.nodes['B']!, creatorId: 'ghost' }
  assert.throws(
    () => deriveNeighbourhood(network.nodes, 'B'),
    (error: unknown) => error instanceof TopologyError && error.code === 'dangling-link',
  )
})

test('TOPO-06: a lineage cycle fails loudly', () => {
  const network = makeChain(['A', 'B'])
  network.nodes['A'] = { ...network.nodes['A']!, creatorId: 'B' }
  assert.throws(
    () => deriveNeighbourhood(network.nodes, 'B'),
    (error: unknown) => error instanceof TopologyError && error.code === 'lineage-cycle',
  )
})

test('TOPO-06: an unknown node fails loudly', () => {
  const network = makeChain(['A'])
  assert.throws(
    () => deriveNeighbourhood(network.nodes, 'ZZ'),
    (error: unknown) => error instanceof TopologyError && error.code === 'unknown-node',
  )
})
