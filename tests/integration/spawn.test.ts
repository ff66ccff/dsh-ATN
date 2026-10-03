/**
 * SPAWN compensation: the creation intent, the publish and the initial task are
 * one unit, and every failure path leaves an explicit failed node with no live
 * handle and no active node without work.
 * @module dsh-atn/tests/integration/spawn
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, atnMessages, type Kernel } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'

const goal = {
  objective: 'Compensate every failed creation.',
  successCriteria: 'No half-created node survives.',
  constraints: 'Deterministic clock only.',
}

test('SPAWN-01: with the task quota already used, a spawn is refused before any Agent exists', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-spawn-'))
  const store = new MemoryNetworkStore()
  let cleanupKernel: Kernel | undefined
  try {
    const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000, cleanupTimeoutMs: 50 })
    cleanupKernel = kernel
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [{ tool: 'atn_start', args: goal }])
    await drive(host, 'start')
    await settle(kernel)
    const networkId = (await kernel.ctx.atn.networkIds())[0]!
    const live = kernel.ctx.agents.get(SessionId('session-host'))!

    // `maxTasks` is 1 and the entry task already used it.
    await store.update(networkId, (current) => ({ ...current, limits: { ...current.limits, maxTasks: 1 } }))
    await assert.rejects(
      () => kernel.ctx.atn.spawn(live, { task: 'cannot fit', context: '' }),
      (error: unknown) => /maxTasks/.test(String((error as Error).message)) || String((error as { bound?: string }).bound) === 'maxTasks',
    )

    const record = await kernel.ctx.atn.network(networkId)
    assert.equal(Object.keys(record.nodes).length, 1, 'no node record was added')
    assert.equal(Object.keys(record.tasks).length, 1, 'no task record was added')
    assert.equal(
      kernel.ctx.agents.list().filter((agent) => String(agent.id) !== 'session-host').length,
      0,
      'no extra Agent was created',
    )
  } finally {
    await cleanupKernel?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('SPAWN-02: a failed publish records a failed node and releases the created Agent', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-spawn-'))
  const store = new MemoryNetworkStore()
  let cleanupKernel: Kernel | undefined
  try {
    const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000, cleanupTimeoutMs: 1000 })
    cleanupKernel = kernel
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [{ tool: 'atn_start', args: goal }])
    await drive(host, 'start')
    await settle(kernel)
    const networkId = (await kernel.ctx.atn.networkIds())[0]!
    const live = kernel.ctx.agents.get(SessionId('session-host'))!

    // Fail exactly the publish write. The intent write only reserves the node;
    // the publish is the write that makes it visible and gives it its task, so
    // that is the one whose failure has to be compensated.
    let failedOnce = false
    store.updateHook = (next) => {
      if (!failedOnce && Object.values(next.nodes).some((node) => !node.isEntry && node.creationState === 'published')) {
        failedOnce = true
        throw new Error('simulated medium failure during publish')
      }
    }
    await assert.rejects(() => kernel.ctx.atn.spawn(live, { task: 'never lands', context: '' }))
    assert.ok(failedOnce, 'the injected publish failure really fired')
    await settle(kernel)

    const record = await kernel.ctx.atn.network(networkId)
    const child = Object.values(record.nodes).find((node) => !node.isEntry)!
    assert.ok(child !== undefined, 'the creation intent is still on record')
    assert.equal(child.creationState, 'failed', 'the node is explicitly failed, never silently active')
    assert.equal(child.lifecycle, 'failed')
    assert.match(child.note ?? '', /simulated medium failure/)
    assert.ok(!Object.values(record.tasks).some((task) => task.holderId === child.id), 'a failed node holds no task')
    assert.equal(record.nodes[record.entryNodeId]!.selectedChildId, null, 'a failed node never claims the selected slot')
    assert.equal(kernel.ctx.atn.ownsHandle(child.id), false, 'no live handle survives the failed spawn')
    assert.ok(
      !kernel.ctx.agents.list().some((agent) => String(agent.id) === child.sessionId),
      'the created Agent was released instead of being left running',
    )
  } finally {
    await cleanupKernel?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('SPAWN-03: a successful spawn still commits its task, goal snapshot and assignment', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-spawn-'))
  const store = new MemoryNetworkStore()
  let cleanupKernel: Kernel | undefined
  try {
    const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000, cleanupTimeoutMs: 50 })
    cleanupKernel = kernel
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Local work for the child.', context: 'context text' } },
    ])
    await drive(host, 'start and spawn')
    await settle(kernel)
    const networkId = (await kernel.ctx.atn.networkIds())[0]!
    const record = await kernel.ctx.atn.network(networkId)
    const child = Object.values(record.nodes).find((node) => !node.isEntry)!
    assert.equal(child.creationState, 'published')
    assert.equal(child.lifecycle, 'active')
    assert.equal(record.nodes[record.entryNodeId]!.selectedChildId, child.id)
    assert.equal(child.lastGoalVersionSent, 1, 'the child really read the committed revision')

    const task = Object.values(record.tasks).find((entry) => entry.holderId === child.id)!
    assert.equal(task.description, 'Local work for the child.')
    assert.equal(task.context, 'context text')
    assert.equal(task.status, 'open')

    const childAgent = kernel.ctx.agents.get(SessionId(child.sessionId))!
    const texts = atnMessages(childAgent)
    assert.ok(texts.some((text) => text.includes('version=1')), 'the child received the goal snapshot')
    assert.ok(texts.some((text) => text.includes(`task=${task.id}`)), 'the child received its assignment')
    assert.ok(kernel.ctx.atn.ownsHandle(child.id), 'a published node keeps its live handle')
  } finally {
    await cleanupKernel?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
