/** Directed collaboration links evolve without changing node birth records. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { nodeRecordSchema } from '../../src/schema.ts'
import {
  collaborationPeers,
  connectPublishedNode,
  reconcileTopology,
  rewireNode,
  TopologyError,
  type TopologyErrorCode,
} from '../../src/topology.ts'
import { makeChain, makeNode } from '../fixtures/network.ts'

function rejects(code: TopologyErrorCode): (error: unknown) => boolean {
  return error => error instanceof TopologyError && error.code === code
}

test('ADAPT-01: legacy nodes bootstrap once; explicit empty neighbourhoods stay empty', () => {
  const original = makeChain(['A', 'B', 'C', 'D', 'E'])
  assert.deepEqual(collaborationPeers(original.nodes, 'C'), ['B', 'A', 'D', 'E'])
  const initialized = reconcileTopology(original)
  assert.deepEqual(initialized.nodes.C.peerIds, ['B', 'A', 'D', 'E'])
  assert.equal(original.nodes.C.peerIds, undefined, 'reading and reconciliation never mutate the input')
  const disconnected = rewireNode(initialized, 'C', [])
  assert.deepEqual(collaborationPeers(disconnected.nodes, 'C'), [])
  assert.equal(reconcileTopology(disconnected), disconnected, 'unused slots do not restore birth neighbours')
  assert.deepEqual(disconnected.nodes.C.creatorId, original.nodes.C.creatorId)
  assert.deepEqual(disconnected.nodes.C.selectedChildId, original.nodes.C.selectedChildId)
})

test('ADAPT-02: rewiring crosses branches and changes only the caller outgoing links', () => {
  const original = reconcileTopology(makeChain(['A', 'B', 'C']))
  original.nodes.X = makeNode('X', { creatorId: 'A', peerIds: ['A'] })
  const next = rewireNode(original, 'B', ['X'])
  assert.deepEqual(collaborationPeers(next.nodes, 'B'), ['X'])
  assert.deepEqual(collaborationPeers(next.nodes, 'X'), ['A'], 'a directed link does not silently rewrite its target')
  assert.equal(next.nodes.B.creatorId, 'A')
  assert.equal(next.nodes.B.selectedChildId, 'C')
  assert.equal(next.nodes.A, original.nodes.A)
  assert.equal(next.nodes.X, original.nodes.X)
  assert.equal(rewireNode(next, 'B', ['X']), next, 'an identical rewire is a no-op')
})

test('ADAPT-03: rewiring refuses invalid callers, targets and edge lists', () => {
  const original = makeChain(['A', 'B', 'C', 'D', 'E', 'F'])
  assert.throws(() => rewireNode(original, 'ghost', []), rejects('unknown-node'))
  assert.throws(() => rewireNode(original, 'A', ['ghost']), rejects('unknown-node'))
  assert.throws(() => rewireNode(original, 'A', ['A']), rejects('self-link'))
  assert.throws(() => rewireNode(original, 'A', ['B', 'B']), rejects('duplicate-peer'))
  assert.throws(() => rewireNode(original, 'A', ['B', 'C', 'D', 'E', 'F']), rejects('too-many-peers'))
  for (const lifecycle of ['provisioning', 'draining', 'retired', 'failed'] as const) {
    const record = { ...original, nodes: { ...original.nodes, B: { ...original.nodes.B, lifecycle } } }
    assert.throws(() => rewireNode(record, 'B', ['A']), rejects('not-active'))
    assert.throws(() => rewireNode(record, 'A', ['B']), rejects('target-not-active'))
  }
  const unpublished = { ...original, nodes: { ...original.nodes, B: { ...original.nodes.B, creationState: 'pending' as const } } }
  assert.throws(() => rewireNode(unpublished, 'A', ['B']), rejects('target-not-active'))
  assert.throws(() => rewireNode(unpublished, 'B', ['A']), rejects('not-active'))
  for (const status of ['stopped', 'completed'] as const) {
    assert.throws(() => rewireNode({ ...original, status }, 'A', ['B']), rejects('network-closed'))
  }
})

test('ADAPT-04: repair reserves existing active peers and replaces only lost slots', () => {
  const record = makeChain(['A'])
  record.nodes.A = { ...record.nodes.A, peerIds: ['B', 'C'] }
  record.nodes.B = makeNode('B', { lifecycle: 'draining', peerIds: ['C', 'D', 'E'] })
  record.nodes.C = makeNode('C', { peerIds: [] })
  record.nodes.D = makeNode('D', { peerIds: [] })
  record.nodes.E = makeNode('E', { peerIds: [] })
  assert.deepEqual(collaborationPeers(record.nodes, 'A'), ['C', 'D'])
  const repaired = reconcileTopology(record)
  assert.deepEqual(repaired.nodes.A.peerIds, ['C', 'D'])
  assert.equal(repaired.nodes.B, record.nodes.B, 'the departing node retains its exit edges for bridging')
  assert.equal(reconcileTopology(repaired), repaired, 'repair settles instead of filling all four slots')
})

test('ADAPT-05: repair walks inactive cycles breadth first and stops at live candidates', () => {
  const record = makeChain(['A'])
  record.nodes.A = { ...record.nodes.A, peerIds: ['B', 'C'] }
  record.nodes.B = makeNode('B', { lifecycle: 'retired', peerIds: ['A', 'D'] })
  record.nodes.C = makeNode('C', { lifecycle: 'failed', peerIds: ['E', 'B'] })
  record.nodes.D = makeNode('D', { lifecycle: 'draining', peerIds: ['B', 'F'] })
  record.nodes.E = makeNode('E', { peerIds: ['G'] })
  record.nodes.F = makeNode('F', { peerIds: [] })
  record.nodes.G = makeNode('G', { peerIds: [] })
  assert.deepEqual(collaborationPeers(record.nodes, 'A'), ['E', 'F'])
  assert.ok(!collaborationPeers(record.nodes, 'A').includes('G'), 'repair never traverses a live peer')
})

test('ADAPT-06: an inactive explicit empty list cannot revive its birth links', () => {
  const record = makeChain(['A', 'B', 'C'])
  record.nodes.A = { ...record.nodes.A, peerIds: ['B'] }
  record.nodes.B = { ...record.nodes.B, lifecycle: 'retired', peerIds: [] }
  assert.deepEqual(collaborationPeers(record.nodes, 'A'), [])
  assert.deepEqual(reconcileTopology(record).nodes.A.peerIds, [])
  const legacyB = { ...record.nodes.B }
  delete legacyB.peerIds
  assert.deepEqual(collaborationPeers({ ...record.nodes, B: legacyB }, 'A'), ['C'], 'only a missing list bootstraps the old lineage')
})

test('ADAPT-07: reconciliation uses one snapshot regardless of record iteration order', () => {
  const record = makeChain(['A'])
  record.nodes.A = { ...record.nodes.A, peerIds: ['B'] }
  record.nodes.B = makeNode('B', { lifecycle: 'draining', peerIds: ['C'] })
  record.nodes.C = makeNode('C', { peerIds: ['D'] })
  record.nodes.D = makeNode('D', { lifecycle: 'retired', peerIds: ['E'] })
  record.nodes.E = makeNode('E', { peerIds: [] })
  const reversed = { ...record, nodes: Object.fromEntries(Object.entries(record.nodes).reverse()) }
  const forwardRepair = reconcileTopology(record)
  const reverseRepair = reconcileTopology(reversed)
  for (const id of Object.keys(record.nodes)) {
    assert.deepEqual(forwardRepair.nodes[id].peerIds, reverseRepair.nodes[id].peerIds)
  }
  assert.deepEqual(forwardRepair.nodes.A.peerIds, ['C'])
  assert.deepEqual(forwardRepair.nodes.C.peerIds, ['E'])
  assert.deepEqual(forwardRepair.nodes.B.peerIds, ['C'])
  assert.deepEqual(forwardRepair.nodes.D.peerIds, ['E'])
})

test('ADAPT-08: graph cycles are legal while dangling stored links fail clearly', () => {
  const record = makeChain(['A', 'B'])
  record.nodes.A = { ...record.nodes.A, peerIds: ['B'] }
  record.nodes.B = { ...record.nodes.B, peerIds: ['A'] }
  assert.deepEqual(collaborationPeers(record.nodes, 'A'), ['B'])
  assert.deepEqual(collaborationPeers(record.nodes, 'B'), ['A'])
  assert.throws(() => collaborationPeers(record.nodes, 'ghost'), rejects('unknown-node'))
  record.nodes.B = { ...record.nodes.B, lifecycle: 'draining', peerIds: ['ghost'] }
  assert.throws(() => collaborationPeers(record.nodes, 'A'), rejects('dangling-link'))
})

test('ADAPT-09: published children connect to creator and its peers without eviction', () => {
  const record = makeChain(['A', 'B', 'C'])
  record.nodes.A = { ...record.nodes.A, peerIds: ['B', 'C'] }
  record.nodes.B = { ...record.nodes.B, peerIds: ['A'] }
  record.nodes.C = { ...record.nodes.C, peerIds: [] }
  record.nodes.X = makeNode('X', { creatorId: 'A' })
  const connected = connectPublishedNode(record, 'X')
  assert.deepEqual(connected.nodes.X.peerIds, ['A', 'B', 'C'])
  assert.deepEqual(connected.nodes.A.peerIds, ['B', 'C', 'X'])
  assert.equal(connected.nodes.A.selectedChildId, 'B')
  assert.equal(connected.nodes.X.creatorId, 'A')
  assert.equal(connectPublishedNode(connected, 'X'), connected, 'publication retries are idempotent')

  const full = makeChain(['A', 'B', 'C', 'D', 'E'])
  full.nodes.A = { ...full.nodes.A, peerIds: ['B', 'C', 'D', 'E'] }
  full.nodes.X = makeNode('X', { creatorId: 'A' })
  const added = connectPublishedNode(full, 'X')
  assert.deepEqual(added.nodes.A.peerIds, ['B', 'C', 'D', 'E'])
  assert.deepEqual(added.nodes.X.peerIds, ['A', 'B', 'C', 'D'])
})

test('ADAPT-10: provisioning waits for publication and later retries preserve explicit choices', () => {
  const record = makeChain(['A'])
  record.nodes.A = { ...record.nodes.A, peerIds: [] }
  record.nodes.X = makeNode('X', { creatorId: 'A', lifecycle: 'provisioning', creationState: 'pending' })
  assert.equal(reconcileTopology(record).nodes.X.peerIds, undefined)
  assert.throws(() => connectPublishedNode(record, 'X'), rejects('not-active'))
  const published = { ...record, nodes: { ...record.nodes, X: { ...record.nodes.X, lifecycle: 'active' as const, creationState: 'published' as const } } }
  const connected = connectPublishedNode(published, 'X')
  assert.deepEqual(connected.nodes.X.peerIds, ['A'])
  assert.deepEqual(connected.nodes.A.peerIds, ['X'])
  const removed = rewireNode(rewireNode(connected, 'X', []), 'A', [])
  assert.equal(connectPublishedNode(removed, 'X'), removed)
})

test('ADAPT-11: a creator exiting during provisioning does not prevent independent child publication', () => {
  const record = makeChain(['A'])
  record.nodes.A = { ...record.nodes.A, lifecycle: 'draining', peerIds: ['B'] }
  record.nodes.B = makeNode('B', { peerIds: [] })
  record.nodes.X = makeNode('X', { creatorId: 'A' })
  const connected = connectPublishedNode(record, 'X')
  assert.deepEqual(connected.nodes.X.peerIds, ['B'])
  assert.equal(connected.nodes.A, record.nodes.A, 'publication cannot change the departed creator\'s links')
})

test('ADAPT-12: terminal networks remain unchanged and persisted graphs keep explicit emptiness', () => {
  const record = makeChain(['A', 'B'])
  for (const status of ['stopped', 'completed'] as const) {
    const closed = { ...record, status }
    assert.equal(reconcileTopology(closed), closed)
    assert.throws(() => connectPublishedNode(closed, 'B'), rejects('network-closed'))
  }
  assert.equal(nodeRecordSchema.parse(makeNode('A')).peerIds, undefined)
  assert.deepEqual(nodeRecordSchema.parse(makeNode('A', { peerIds: [] })).peerIds, [])
  assert.throws(() => nodeRecordSchema.parse(makeNode('A', { peerIds: ['B', 'C', 'D', 'E', 'F'] })))
})
