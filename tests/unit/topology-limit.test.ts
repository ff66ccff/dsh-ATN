/** The network's frozen degree bound applies to every graph mutation. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { networkRecordSchema, type NetworkRecord } from '../../src/schema.ts'
import {
  collaborationPeerLimit, collaborationPeers, connectPublishedNode, reconcileTopology, rewireNode,
} from '../../src/topology.ts'
import { makeChain, makeNode } from '../fixtures/network.ts'

function limited(ids: string[], maxCollaborationPeers = 2): NetworkRecord {
  const record = makeChain(ids)
  return { ...record, limits: { ...record.limits, maxCollaborationPeers } }
}

function assertBound(record: NetworkRecord): void {
  const limit = collaborationPeerLimit(record)
  for (const node of Object.values(record.nodes)) {
    assert.ok((node.peerIds?.length ?? 0) <= limit, `${node.id} has at most ${limit} stored peers`)
    if (node.lifecycle === 'active' && node.creationState === 'published') {
      assert.ok(collaborationPeers(record.nodes, node.id, limit).length <= limit)
    }
  }
  assert.deepEqual(networkRecordSchema.parse(record), record)
}

function distances(record: NetworkRecord, start: string): Map<string, number> {
  const distance = new Map([[start, 0]])
  const queue = [start]
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]
    for (const peer of collaborationPeers(record.nodes, id, collaborationPeerLimit(record))) {
      if (distance.has(peer)) continue
      distance.set(peer, distance.get(id)! + 1)
      queue.push(peer)
    }
  }
  return distance
}

test('DEGREE-01: legacy records preserve four while a frozen cap bounds bootstrap and explicit rewires', () => {
  const old = makeChain(['A', 'B', 'C', 'D', 'E'])
  old.limits = { ...old.limits }
  delete old.limits.maxCollaborationPeers
  assert.equal(collaborationPeerLimit(old), 4)
  assert.equal(networkRecordSchema.parse(old).limits.maxCollaborationPeers, undefined)
  assert.deepEqual(reconcileTopology(old).nodes.C.peerIds, ['B', 'A', 'D', 'E'])
  const record = limited(['A', 'B', 'C', 'D', 'E'])
  assert.deepEqual(collaborationPeers(record.nodes, 'C', collaborationPeerLimit(record)), ['B', 'A'])
  const initialized = reconcileTopology(record)
  assertBound(initialized)
  assert.throws(() => rewireNode(initialized, 'C', ['A', 'B', 'D']), /at most 2/)
  assert.deepEqual(initialized.nodes.C.peerIds, ['B', 'A'], 'rejected rewiring cannot partially change the graph')
  const changed = rewireNode(initialized, 'C', ['A', 'E'])
  assertBound(changed)
  assert.deepEqual(changed.nodes.C.peerIds, ['A', 'E'])
  const disconnected = rewireNode(changed, 'C', [])
  assert.deepEqual(reconcileTopology(disconnected).nodes.C.peerIds, [], 'reconciliation does not refill an intentional empty graph')
})

test('DEGREE-02: publication inherits bounded links and never evicts a full creator edge', () => {
  let record = limited(['A'])
  record.nodes.A.peerIds = []
  for (const [id, creatorId] of [['B', 'A'], ['C', 'A'], ['D', 'B'], ['E', 'C'], ['F', 'A']]) {
    record = { ...record, nodes: { ...record.nodes, [id]: makeNode(id, { creatorId }) } }
    const creatorPeers = record.nodes[creatorId].peerIds
    record = connectPublishedNode(record, id)
    assertBound(record)
    assert.ok(record.nodes[id].peerIds?.includes(creatorId))
    if (creatorPeers?.length === 2) assert.deepEqual(record.nodes[creatorId].peerIds, creatorPeers)
    assert.equal(connectPublishedNode(record, id), record, 'publication retry keeps the original bounded choice')
  }
  assert.deepEqual(record.nodes.A.peerIds, ['B', 'C'])
  assert.deepEqual(record.nodes.F.peerIds, ['A', 'B'])
})

test('DEGREE-03: failed-peer repair and legacy oversized exit links obey the same cap', () => {
  const record = limited(['A'])
  record.nodes.A.peerIds = ['B', 'C']
  record.nodes.B = makeNode('B', { lifecycle: 'failed', peerIds: ['C', 'D', 'E', 'F'] })
  for (const id of ['C', 'D', 'E', 'F']) record.nodes[id] = makeNode(id, { peerIds: [] })
  record.nodes.pending = makeNode('pending', { lifecycle: 'provisioning', creationState: 'pending', peerIds: ['D', 'E', 'F'] })
  const repaired = reconcileTopology(record)
  assertBound(repaired)
  assert.deepEqual(repaired.nodes.A.peerIds, ['C', 'D'])
  assert.deepEqual(repaired.nodes.B.peerIds, ['C', 'D'], 'historical exit edges remain available only within the frozen cap')
  assert.deepEqual(repaired.nodes.pending.peerIds, ['D', 'E'])
  assert.deepEqual(record.nodes.B.peerIds, ['C', 'D', 'E', 'F'], 'repair is a pure transform')
  assert.equal(reconcileTopology(repaired), repaired)
  const reversed = reconcileTopology({ ...record, nodes: Object.fromEntries(Object.entries(record.nodes).reverse()) })
  for (const id of Object.keys(record.nodes)) assert.deepEqual(reversed.nodes[id].peerIds, repaired.nodes[id].peerIds)
})

test('DEGREE-04: a sixteen-node degree-two ring stays connected, scarce and bounded after every write and failure repair', () => {
  const ids = Array.from({ length: 16 }, (_, index) => `node-${index.toString().padStart(2, '0')}`)
  let record = limited(ids)
  for (const node of Object.values(record.nodes)) node.peerIds = []
  for (let index = 0; index < ids.length; index++) {
    record = rewireNode(record, ids[index], [ids[(index + ids.length - 1) % ids.length], ids[(index + 1) % ids.length]])
    assertBound(record)
  }
  for (const id of ids) {
    const reachable = distances(record, id)
    assert.equal(reachable.size, 16)
    assert.equal(Math.max(...reachable.values()), 8, 'the initial graph is not a near-complete diameter-two graph')
  }
  record = { ...record, nodes: { ...record.nodes, [ids[7]]: { ...record.nodes[ids[7]], lifecycle: 'failed' } } }
  record = reconcileTopology(record)
  assertBound(record)
  for (const id of ids.filter(id => id !== ids[7])) {
    const reachable = distances(record, id)
    assert.equal(reachable.size, 15)
    assert.equal(reachable.has(ids[7]), false)
  }
})

test('DEGREE-05: degree one works and invalid explicit read limits fail instead of widening', () => {
  let record = limited(['A'], 1)
  record.nodes.A.peerIds = []
  record.nodes.B = makeNode('B', { creatorId: 'A' })
  record = connectPublishedNode(record, 'B')
  assertBound(record)
  assert.deepEqual(record.nodes.A.peerIds, ['B'])
  assert.deepEqual(record.nodes.B.peerIds, ['A'])
  record.nodes.C = makeNode('C', { creatorId: 'B' })
  record = connectPublishedNode(record, 'C')
  assertBound(record)
  assert.deepEqual(record.nodes.C.peerIds, ['B'])
  assert.throws(() => rewireNode(record, 'A', ['B', 'C']), /at most 1/)
  for (const limit of [0, -1, 1.5, 5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => collaborationPeers(record.nodes, 'A', limit), /integer from 1 to 4/)
    assert.throws(() => collaborationPeerLimit({ limits: { ...record.limits, maxCollaborationPeers: limit } }), /integer from 1 to 4/)
  }
})
