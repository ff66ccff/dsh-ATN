/** Real status and observer calls report the currently effective quota. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryNetworkStore } from '../../src/domain.ts'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { AtnObserver as Observer } from '../../src/observer.ts'
import { observerSnapshotSchema } from '../../src/observer-schema.ts'
import { bootKernel, createHostAgent, settle } from '../fixtures/kernel.ts'
import { makeNode, testGoal } from '../fixtures/network.ts'

test('DYNAMIC-STATUS: N=2 and N=32 status reads report two and six without mutation or model calls', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-dynamic-status-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 100 })
  try {
    const host = await createHostAgent(kernel, 'dynamic-degree-entry')
    await kernel.ctx.plugin(TypertRegistry)
    await kernel.ctx.plugin(Observer)
    const start = await kernel.atn.start(host, testGoal)
    await settle(kernel)
    for (const [n, expected] of [[2, 2], [32, 6]]) {
      await store.update(start.networkId, record => {
        const nodes = { ...record.nodes }
        for (let i = 1; i < n; i++) nodes[`extra-${i}`] ??= makeNode(`extra-${i}`, { peerIds: [] })
        return { ...record, nodes }
      })
      const before = await store.load(start.networkId)
      const requests = kernel.model.requests.length
      assert.equal((await kernel.atn.status(host)).budget.maxCollaborationPeers, expected)
      assert.deepEqual(await store.load(start.networkId), before)
      assert.equal(kernel.model.requests.length, requests)
      const snapshot = observerSnapshotSchema.parse(await kernel.ctx.atnObserver.snapshot(host.id, new AbortController().signal))
      assert.equal(snapshot.network!.maxCollaborationPeers, expected)
      assert.deepEqual(await store.load(start.networkId), before)
      if (n === 32) {
        const peers = Object.keys(before!.nodes).filter(id => id !== start.nodeId).slice(0, expected)
        await kernel.atn.rewire(host, { peers })
        const committed = await store.load(start.networkId)
        assert.deepEqual(committed!.nodes[start.nodeId].peerIds, peers)
        const observed = observerSnapshotSchema.parse(await kernel.ctx.atnObserver.snapshot(host.id, new AbortController().signal))
        assert.deepEqual(observed.network!.nodes.find(node => node.id === start.nodeId)!.peers, peers)
      }
    }
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
