/**
 * M4: real deadlines on an injected clock, the host-facing stop entry, and
 * recovery from a durable store after the whole kernel is rebuilt.
 * @module dsh-atn/tests/integration/lifecycle
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'

const goal = {
  objective: 'Exercise the scheduler.',
  successCriteria: 'Deadlines, stop and recovery are observable.',
  constraints: 'Deterministic clock only.',
}

async function scratchDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-atn-life-'))
}

test('LIFE-05/STOP-01/STOP-02: an expired lease drains the node, and stop is a persistent terminal state', async () => {
  const scratch = await scratchDir()
  const store = new MemoryNetworkStore()
  let now = 1_000_000
  const clock = (): number => now
  let kernel: Kernel | undefined
  try {
    kernel = await bootKernel(scratch, { store, clock })
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Short lease work.', context: '', leaseMs: 60_000 } },
    ])
    await drive(host, 'start and spawn')
    await settle(kernel)

    const networkId = (await kernel.ctx.atn.networkIds())[0]!
    let record = await kernel.ctx.atn.network(networkId)
    const nodeB = Object.values(record.nodes).find((node) => !node.isEntry)!
    assert.equal(nodeB.leaseDeadlineAt, now + 60_000, 'the lease uses the injected clock')

    // Advance past the lease: the node leaves the current topology but keeps its work.
    now += 61_000
    await kernel.ctx.atn.tick()
    record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.nodes[nodeB.id]!.lifecycle, 'draining', 'an expired lease drains rather than kills')
    const openForB = Object.values(record.tasks).filter((task) => task.holderId === nodeB.id && task.status === 'open')
    assert.equal(openForB.length, 1, 'its existing work is preserved')
    void openForB

    // Delivery to a draining node for old work is still allowed; new work is not.
    kernel.model.enqueue('session-host', [
      { tool: 'atn_send', args: { to: nodeB.id, kind: 'task', body: 'New work for a draining node.' } },
    ])
    await drive(host, 'try to assign new work to a draining node')
    await settle(kernel)
    record = await kernel.ctx.atn.network(networkId)
    assert.ok(
      !Object.values(record.tasks).some((task) => task.description === 'New work for a draining node.'),
      'a draining node cannot take new tasks',
    )

    // The host stops the network without any model participation.
    const report = await kernel.ctx.atn.stop(networkId, 'user stopped the network from the host')
    assert.equal(report.status, 'stopped')
    assert.ok(report.released.includes(nodeB.id), 'the ATN-owned node was released')

    record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.status, 'stopped')
    assert.ok(Object.values(record.tasks).every((task) => task.status !== 'open'), 'open tasks are settled on stop')

    // Nothing may reopen or extend a stopped network.
    await assert.rejects(kernel.ctx.atn.renew(host, { extendMs: 60_000, taskId: openForB[0]!.id, basis: 'still working' }))
    kernel.model.enqueue('session-host', [
      { tool: 'atn_spawn', args: { task: 'Too late.', context: '' } },
    ])
    await drive(host, 'try to spawn after the stop')
    await settle(kernel)

    record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.status, 'stopped', 'the network stays stopped')
    assert.equal(Object.values(record.nodes).filter((node) => node.creatorId !== null).length, 1, 'no node was created after the stop')
  } finally {
    await kernel?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('RECOVER-01: rebuilding the kernel over the same store keeps durable state and never revives a retired node', async () => {
  const scratch = await scratchDir()
  const store = new MemoryNetworkStore()
  let first: Kernel | undefined
  let second: Kernel | undefined
  try {
    first = await bootKernel(scratch, { store })
    const host = await createHostAgent(first, 'session-host')
    first.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Node B local work.', context: '' } },
      { tool: 'atn_spawn', args: { task: 'Node X local work.', context: '' } },
    ])
    await drive(host, 'start and spawn two children')
    await settle(first)

    const networkId = (await first.ctx.atn.networkIds())[0]!
    let record = await first.ctx.atn.network(networkId)
    const nodes = Object.values(record.nodes).filter((node) => !node.isEntry)
    assert.equal(nodes.length, 2)

    // Retire one node in the store, then destroy the whole kernel.
    const retired = nodes[0]!
    await store.update(networkId, (current) => ({
      ...current,
      nodes: { ...current.nodes, [retired.id]: { ...current.nodes[retired.id]!, lifecycle: 'retired', creationState: 'published' } },
    }))
    const before = await first.ctx.atn.network(networkId)
    const stepsBefore = before.stepsUsed
    await first.ctx.fiber.dispose()
    first = undefined

    second = await bootKernel(scratch, { store })
    const report = await second.ctx.atn.recover()
    const after = await second.ctx.atn.network(networkId)

    assert.equal(after.status, 'open', 'an open network is recovered, not recreated')
    assert.equal(after.stepsUsed, stepsBefore, 'consumed budget is not reset by a restart')
    assert.equal(after.nodes[retired.id]!.lifecycle, 'retired', 'a retired node is never revived')
    assert.ok(!report.some((entry) => entry.nodeId === retired.id && entry.action === 'resume'))

    const survivor = nodes.find((node) => node.id !== retired.id)!
    assert.equal(after.nodes[survivor.id]!.lifecycle, 'active', 'the other node stays active')
    const decisions = report.filter((entry) => entry.nodeId === survivor.id)
    assert.equal(decisions[0]?.action, 'resume', 'the surviving node is resumed from its session')
    assert.equal(after.nodes[survivor.id]!.creationState, 'published')
  } finally {
    await first?.ctx.fiber.dispose()
    await second?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('RECOVER-02: a creation that never finished is rebuilt or failed, never silently republished', async () => {
  const scratch = await scratchDir()
  const store = new MemoryNetworkStore()
  let kernel: Kernel | undefined
  let second: Kernel | undefined
  try {
    kernel = await bootKernel(scratch, { store })
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Node B local work.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(kernel)

    const networkId = (await kernel.ctx.atn.networkIds())[0]!
    let record = await kernel.ctx.atn.network(networkId)
    const nodeB = Object.values(record.nodes).find((node) => !node.isEntry)!

    // Simulate a crash that left a provisioning intent with no session behind it.
    await store.update(networkId, (current) => ({
      ...current,
      nodes: {
        ...current.nodes,
        [nodeB.id]: { ...current.nodes[nodeB.id]!, creationState: 'pending', lifecycle: 'provisioning' },
        'node-crash': {
          id: 'node-crash',
          sessionId: 'never-persisted-session',
          creatorId: record.entryNodeId,
          selectedChildId: null,
          lifecycle: 'provisioning',
          leaseDeadlineAt: null,
          modelRoute: { provider: 'atn-script', model: 'deterministic', effort: null },
          presetId: null,
          permissionSeed: null,
          isEntry: false,
          creationState: 'pending',
          note: null,
          createdAt: 0,
        },
      },
    }))

    await kernel.ctx.fiber.dispose()
    kernel = undefined

    second = await bootKernel(scratch, { store })
    const report = await second.ctx.atn.recover()
    const after = await second.ctx.atn.network(networkId)

    const crashed = report.find((entry) => entry.nodeId === 'node-crash')
    assert.equal(crashed?.action, 'fail', 'a provisioning intent with no session is failed explicitly')
    assert.equal(after.nodes['node-crash']!.creationState, 'failed')
    assert.equal(after.nodes['node-crash']!.lifecycle, 'failed')
    assert.ok(!report.some((entry) => entry.nodeId === 'node-crash' && entry.action === 'rebuild'), 'no pseudo-rebuild')
    assert.equal(after.nodes[nodeB.id]!.creationState, 'published', 'the published node is unaffected')
  } finally {
    await kernel?.ctx.fiber.dispose()
    await second?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('RECOVER-03: recovery activates each session at most once', async () => {
  const scratch = await scratchDir()
  const store = new MemoryNetworkStore()
  let first: Kernel | undefined
  let second: Kernel | undefined
  try {
    first = await bootKernel(scratch, { store })
    const host = await createHostAgent(first, 'session-host')
    first.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Node B local work.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(first)
    const networkId = (await first.ctx.atn.networkIds())[0]!
    await first.ctx.fiber.dispose()
    first = undefined

    second = await bootKernel(scratch, { store })
    // Concurrent recovery passes must not create two live handles for one session.
    const [a, b] = await Promise.all([second.ctx.atn.recover(), second.ctx.atn.recover()])
    assert.ok(a.length > 0 && b.length > 0)
    const record = await second.ctx.atn.network(networkId)
    const nodes = Object.values(record.nodes).filter((node) => !node.isEntry)
    for (const node of nodes) {
      const live = second.ctx.agents.list().filter((agent) => String(agent.id) === node.sessionId)
      assert.ok(live.length <= 1, `${node.sessionId} has at most one live agent`)
    }
  } finally {
    await first?.ctx.fiber.dispose()
    await second?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('LIFE-03: a real atn_finish call returns without waiting for its own disposal', async () => {
  const scratch = await scratchDir()
  let kernel: Kernel | undefined
  try {
    kernel = await bootKernel(scratch)
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Node B local work.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(kernel)

    const networkId = (await kernel.ctx.atn.networkIds())[0]!
    const before = await kernel.ctx.atn.network(networkId)
    const nodeB = Object.values(before.nodes).find((node) => !node.isEntry)!
    const b = kernel.ctx.agents.get(SessionId(nodeB.sessionId))!

    kernel.model.enqueue(nodeB.sessionId, [{ tool: 'atn_finish', args: { reason: 'local work is handed back' } }])
    // If the tool waited for its own Agent to be disposed, this await would hang.
    await drive(b, 'request retirement')
    await settle(kernel)

    const after = await kernel.ctx.atn.network(networkId)
    assert.equal(after.nodes[nodeB.id]!.lifecycle, 'draining', 'the node left the current topology')
    assert.equal(after.nodes[nodeB.id]!.creationState, 'published')
    assert.ok(kernel.ctx.atn.ownsHandle(nodeB.id), 'the runtime still holds the handle for its outstanding work')
    assert.equal(
      Object.values(after.tasks).filter((task) => task.holderId === nodeB.id && task.status === 'open').length,
      1,
      'the tool reported the outstanding task instead of pretending the node was finished',
    )
    assert.equal(kernel.ctx.agents.get(SessionId('session-host')), host, 'the host entry agent is untouched')
  } finally {
    await kernel?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('LIFE-01: a node that finished one local task stays available for the next', async () => {
  const scratch = await scratchDir()
  let kernel: Kernel | undefined
  try {
    kernel = await bootKernel(scratch)
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'First local task.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(kernel)

    const networkId = (await kernel.ctx.atn.networkIds())[0]!
    const opening = await kernel.ctx.atn.network(networkId)
    const nodeB = Object.values(opening.nodes).find((node) => !node.isEntry)!
    const b = kernel.ctx.agents.get(SessionId(nodeB.sessionId))!

    const firstTask = Object.values(opening.tasks).find((task) => task.holderId === nodeB.id)!
    kernel.model.enqueue(nodeB.sessionId, [
      { tool: 'atn_send', args: { to: opening.entryNodeId, kind: 'result', taskId: firstTask.id, body: 'done', summary: 'first task done', evidence: [] } },
    ])
    await drive(b, 'finish the first task')
    await settle(kernel)

    let record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.tasks[firstTask.id]!.status, 'completed')
    assert.equal(record.nodes[nodeB.id]!.lifecycle, 'active', 'the node stays available after finishing a task')

    // A second task reaches the same node and it can finish that one too.
    const secondTask = { tool: 'atn_send', args: { to: nodeB.id, kind: 'task', body: 'Second local task.' } }
    kernel.model.enqueue('session-host', [secondTask])
    await drive(host, 'assign a second task')
    await settle(kernel)
    record = await kernel.ctx.atn.network(networkId)
    const task2 = Object.values(record.tasks).find((task) => task.description === 'Second local task.')!
    assert.equal(task2.holderId, nodeB.id)

    kernel.model.enqueue(nodeB.sessionId, [
      { tool: 'atn_send', args: { to: record.entryNodeId, kind: 'result', taskId: task2.id, body: 'done again', summary: 'second task done', evidence: [] } },
    ])
    await drive(b, 'finish the second task')
    await settle(kernel)

    record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.tasks[task2.id]!.status, 'completed', 'the same node completed a second task')
    assert.equal(record.nodes[nodeB.id]!.lifecycle, 'active')
  } finally {
    await kernel?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
