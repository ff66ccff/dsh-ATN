/** Real status and observer calls report the currently effective quota. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { bootKernel, createHostAgent } from '../fixtures/kernel.ts'
import { makeNode, testGoal } from '../fixtures/network.ts'

test('DYNAMIC-STATUS: N=2 and N=32 status reads report two and six without mutation or model calls', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-dynamic-status-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 100 })
  try {
    const host = await createHostAgent(kernel, 'dynamic-degree-entry')
    const start = await kernel.atn.start(host, testGoal)
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
    }
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
