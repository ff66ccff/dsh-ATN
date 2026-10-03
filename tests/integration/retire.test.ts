/**
 * LIFE/RELEASE: normal retirement must release the ATN-owned handle at a safe
 * step boundary, and a terminal node must never run another model step.
 * @module dsh-atn/tests/integration/retire
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

const goal = {
  objective: 'Release retiring nodes.',
  successCriteria: 'A retired node holds no handle and runs no step.',
  constraints: 'Deterministic clock only.',
}

interface Bench {
  kernel: Kernel
  store: MemoryNetworkStore
  scratch: string
  now: () => number
  advance: (ms: number) => void
}

async function benchWithClock(): Promise<Bench> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-retire-'))
  const store = new MemoryNetworkStore()
  let now = 1_000_000
  const kernel = await bootKernel(scratch, { store, clock: () => now, cleanupTimeoutMs: 3000 })
  return { kernel, store, scratch, now: () => now, advance: (ms: number) => { now += ms } }
}

async function startAndSpawn(kernel: Kernel, taskText: string): Promise<{ host: Agent; networkId: string; childSession: string; childNodeId: string }> {
  const host = await createHostAgent(kernel, 'session-host')
  kernel.model.enqueue('session-host', [
    { tool: 'atn_start', args: goal },
    { tool: 'atn_spawn', args: { task: taskText, context: '', leaseMs: 60_000 } },
  ])
  await drive(host, 'start and spawn')
  await settle(kernel)
  const live = kernel.ctx.agents.get(SessionId('session-host'))!
  const networkId = (await kernel.ctx.atn.networkIds())[0]!
  const record = await kernel.ctx.atn.network(networkId)
  const child = Object.values(record.nodes).find((node) => !node.isEntry)!
  return { host: live, networkId, childSession: child.sessionId, childNodeId: child.id }
}

test('RELEASE-01: a settled draining node retires on the next tick and its handle is released', async () => {
  const bench = await benchWithClock()
  try {
    const { host, networkId, childSession, childNodeId } = await startAndSpawn(bench.kernel, 'Local work.')
    const child = bench.kernel.ctx.agents.get(SessionId(childSession))!
    const record = await bench.kernel.ctx.atn.network(networkId)
    const task = Object.values(record.tasks).find((entry) => entry.holderId === childNodeId && entry.status === 'open')!

    // Settle the only task, then ask to retire: the node becomes draining with
    // nothing left to owe.
    bench.kernel.model.enqueue(childSession, [
      { tool: 'atn_send', args: { to: record.entryNodeId, kind: 'result', taskId: task.id, body: 'done', summary: 'done', evidence: [] } },
      { tool: 'atn_finish', args: { reason: 'nothing left' } },
    ])
    await drive(child, 'settle and retire')
    await settle(bench.kernel)

    let after = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(after.tasks[task.id]!.status, 'completed')
    assert.equal(after.nodes[childNodeId]!.lifecycle, 'draining', 'the request only drains the node')
    assert.ok(bench.kernel.ctx.atn.ownsHandle(childNodeId), 'the handle survives until the node is released')

    // The scheduler pass retires the settled node and releases its handle.
    await bench.kernel.ctx.atn.tick()
    after = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(after.nodes[childNodeId]!.lifecycle, 'retired', 'the settled draining node retired')
    assert.equal(bench.kernel.ctx.atn.ownsHandle(childNodeId), false, 'a retired node holds no live handle')
    assert.equal(bench.kernel.ctx.agents.get(SessionId(childSession)), undefined, 'the released agent left the registry')
    assert.equal(bench.kernel.ctx.agents.get(SessionId('session-host')), host, 'the host entry agent is untouched')
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('RELEASE-02: a retired node cannot produce a model step or use the runtime', async () => {
  const bench = await benchWithClock()
  try {
    const { networkId, childSession, childNodeId } = await startAndSpawn(bench.kernel, 'Local work.')
    const child = bench.kernel.ctx.agents.get(SessionId(childSession))!
    const record = await bench.kernel.ctx.atn.network(networkId)
    const task = Object.values(record.tasks).find((entry) => entry.holderId === childNodeId && entry.status === 'open')!

    bench.kernel.model.enqueue(childSession, [
      { tool: 'atn_send', args: { to: record.entryNodeId, kind: 'result', taskId: task.id, body: 'done', summary: 'done', evidence: [] } },
      { tool: 'atn_finish', args: {} },
    ])
    await drive(child, 'settle and retire')
    await settle(bench.kernel)
    await bench.kernel.ctx.atn.tick()

    const after = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(after.nodes[childNodeId]!.lifecycle, 'retired')

    // No model step is admitted for a terminal node.
    assert.equal(await bench.kernel.ctx.atn.admitStep(networkId, childSession), false, 'a retired node cannot run a step')
    // Its released Agent is no longer the live caller of any ATN operation.
    await assert.rejects(
      () => bench.kernel.ctx.atn.renew(child, { extendMs: 1000, taskId: task.id }),
      (error: unknown) => /not the live agent|not-live-agent|terminal|retired|unknown-node/i.test(String((error as Error).message)),
      'a retired node cannot renew its lease',
    )
    await assert.rejects(
      () => bench.kernel.ctx.atn.spawn(child, { task: 'child of a retired node', context: '' }),
      (error: unknown) => /not the live agent|not-live-agent|not-active|retired/i.test(String((error as Error).message)),
      'a retired node cannot create children',
    )
    await assert.rejects(
      () => bench.kernel.ctx.atn.send(child, { to: after.entryNodeId, kind: 'note', body: 'still here' }),
      (error: unknown) => /not the live agent|not-live-agent|not-active|retired/i.test(String((error as Error).message)),
      'a retired node cannot send mail',
    )
    const unchanged = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(unchanged.status, 'open', 'the network itself stays open for its remaining nodes')
    assert.equal(Object.keys(unchanged.mails).length, Object.keys(after.mails).length, 'no mail was enqueued by a retired node')
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('RELEASE-03: a draining node may settle its old task and vote, but takes no new work', async () => {
  const bench = await benchWithClock()
  try {
    const { host, networkId, childSession, childNodeId } = await startAndSpawn(bench.kernel, 'Old work.')
    const child = bench.kernel.ctx.agents.get(SessionId(childSession))!
    const opening = await bench.kernel.ctx.atn.network(networkId)
    const oldTask = Object.values(opening.tasks).find((entry) => entry.holderId === childNodeId && entry.status === 'open')!

    // Expire the lease: the node drains, keeping its existing obligation.
    bench.advance(61_000)
    await bench.kernel.ctx.atn.tick()
    let record = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(record.nodes[childNodeId]!.lifecycle, 'draining')

    // A new task assignment from a draining sender is refused and leaves no row.
    const tasksBefore = Object.keys(record.tasks).length
    await assert.rejects(
      () => bench.kernel.ctx.atn.send(child, { to: opening.entryNodeId, kind: 'task', body: 'New work from a draining node.' }),
      (error: unknown) => /sender-draining|draining/i.test(String((error as Error).message)),
      'a draining node may not assign new work',
    )
    record = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(Object.keys(record.tasks).length, tasksBefore, 'the refused assignment created no task record')

    // Settling the already-held task still works, and the result is durable.
    const result = await bench.kernel.ctx.atn.send(child, {
      to: opening.entryNodeId,
      kind: 'result',
      taskId: oldTask.id,
      body: 'old work done',
      summary: 'old work done',
      evidence: [],
    })
    assert.equal(result.settledTaskId, oldTask.id)
    record = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(record.tasks[oldTask.id]!.status, 'completed', 'a draining node settles its old task')
    assert.equal(record.nodes[childNodeId]!.lifecycle, 'draining', 'the node is still draining')
    assert.equal(host.id, SessionId('session-host'))
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('RELEASE-04: the host entry node is never released', async () => {
  const bench = await benchWithClock()
  try {
    const { host, networkId } = await startAndSpawn(bench.kernel, 'Local work.')
    await bench.kernel.ctx.atn.tick()
    const record = await bench.kernel.ctx.atn.network(networkId)
    assert.ok(record.nodes[record.entryNodeId]!.isEntry)
    assert.equal(bench.kernel.ctx.agents.get(SessionId('session-host')), host, 'the entry agent is still live after a scheduler pass')
    assert.equal(record.nodes[record.entryNodeId]!.lifecycle, 'active')
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})
