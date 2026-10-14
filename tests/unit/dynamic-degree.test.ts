/** Network-size degree, compatibility and preservation, without model calls. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { makeChain, makeNode, testConfig } from '../fixtures/network.ts'
import { assertConfigRelations, limitsFromConfig } from '../../src/config.ts'
import { collaborationPeerLimit, collaborationPeers, reconcileTopology, rewireNode, MAX_COLLABORATION_PEERS } from '../../src/topology.ts'
import { networkRecordSchema } from '../../src/schema.ts'
import { topologyFeedbackMessage } from '../../src/topology-feedback.ts'

function sized(n: number, ceiling?: number) {
  const record = makeChain(Array.from({ length: n }, (_, i) => `node-${i}`))
  if (ceiling !== undefined) record.limits = { ...record.limits, maxCollaborationPeers: ceiling }
  return record
}

test('DYNAMIC-01: exact logarithmic table and pure deterministic default limits', () => {
  for (let n = 1; n <= 64; n++) {
    const record = sized(n)
    const before = structuredClone(record)
    const expected = Math.min(8, Math.ceil(Math.log2(n)) + 1)
    assert.equal(collaborationPeerLimit(record), expected, `N=${n}`)
    assert.equal(collaborationPeerLimit(record), expected)
    assert.deepEqual(record, before)
    if (n < 64) assert.ok(collaborationPeerLimit(sized(n + 1)) >= collaborationPeerLimit(record))
  }
  assert.equal(collaborationPeerLimit(sized(8)), 4)
  assert.equal(collaborationPeerLimit(sized(32)), 6)
  assert.ok(32 * collaborationPeerLimit(sized(32)) < 32 * 32 / 2)
})

test('DYNAMIC-02: deployment ceiling eight, frozen two/four and omitted legacy ceiling four', () => {
  assert.equal(MAX_COLLABORATION_PEERS, 8)
  assert.equal(limitsFromConfig(testConfig()).maxCollaborationPeers, 8)
  assert.throws(() => assertConfigRelations(testConfig({ maxCollaborationPeers: 9 })), /8/)
  for (const n of [8, 32]) {
    assert.equal(collaborationPeerLimit(sized(n, 2)), 2)
    const old = sized(n, 4)
    assert.equal(collaborationPeerLimit(old), 4)
    delete old.limits.maxCollaborationPeers
    assert.equal(collaborationPeerLimit(networkRecordSchema.parse(old)), 4)
    assert.equal(old.limits.maxCollaborationPeers, undefined)
  }
  assert.equal(collaborationPeerLimit(sized(32, 8)), 6)
})

test('DYNAMIC-03: growth and retirement preserve every established legal edge', () => {
  let record = sized(1)
  record.nodes['node-0'].peerIds = []
  for (let n = 2; n <= 32; n++) {
    const prior = structuredClone(record)
    record.nodes[`node-${n - 1}`] = makeNode(`node-${n - 1}`, { peerIds: [] })
    record = reconcileTopology(record)
    for (const node of Object.values(prior.nodes)) assert.deepEqual(record.nodes[node.id].peerIds, node.peerIds)
    const peers = Object.keys(record.nodes).slice(1, 1 + collaborationPeerLimit(record))
    record = rewireNode(record, 'node-0', peers)
    assert.deepEqual(collaborationPeers(record.nodes, 'node-0', collaborationPeerLimit(record)), peers)
  }
  const limit = collaborationPeerLimit(record)
  record.nodes['node-31'].lifecycle = 'retired'
  record.nodes['node-30'].lifecycle = 'failed'
  assert.equal(collaborationPeerLimit(record), limit, 'terminal nodes still count')
  assert.deepEqual(reconcileTopology(record).nodes['node-0'].peerIds, record.nodes['node-0'].peerIds)
})

test('DYNAMIC-04: a six-peer logged feedback snapshot remains acknowledged', () => {
  const record = sized(32)
  record.nodes['node-0'].peerIds = Object.keys(record.nodes).slice(1, 7)
  const first = topologyFeedbackMessage(record, 'node-0', [], 0)!
  assert.ok(first)
  record.nodes['node-0'].stepsUsed = 3
  assert.equal(topologyFeedbackMessage(record, 'node-0', [{ type: 'user/message', data: first }], 0), undefined)
})

test('DYNAMIC-05: degree literals are removed from config and both durable/observer codecs', () => {
  for (const path of ['config.ts', 'schema.ts', 'observer-schema.ts']) {
    assert.doesNotMatch(readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8'), /\.max\(4\)|> 4|1–4/)
  }
})
