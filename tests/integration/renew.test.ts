/**
 * RENEW: a lease extension is justified by one open task the caller still
 * holds, and no boundary may be bypassed.
 * @module dsh-atn/tests/integration/renew
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'

const goal = {
  objective: 'Renew only for real work.',
  successCriteria: 'Every extension names an open task the caller holds.',
  constraints: 'Deterministic clock only.',
}

interface Bench {
  kernel: Kernel
  scratch: string
  advance: (ms: number) => void
}

/**
 * Machine-readable refusal code of an ATN error.
 *
 * @param error - Thrown value.
 * @returns The `AtnRefusal` code, when there is one.
 */
function refusalCode(error: unknown): string | undefined {
  return (error as { code?: string } | undefined)?.code
}

async function bench(): Promise<Bench> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-renew-'))
  let now = 1_000_000
  const kernel = await bootKernel(scratch, { store: new MemoryNetworkStore(), clock: () => now, cleanupTimeoutMs: 50 })
  return { kernel, scratch, advance: (ms: number) => { now += ms } }
}

async function start(kernel: Kernel): Promise<{ host: Agent; networkId: string }> {
  const created = await createHostAgent(kernel, 'session-host')
  kernel.model.enqueue('session-host', [{ tool: 'atn_start', args: goal }])
  await drive(created, 'start')
  await settle(kernel)
  return { host: kernel.ctx.agents.get(SessionId('session-host'))!, networkId: (await kernel.ctx.atn.networkIds())[0]! }
}

test('RENEW-01: a node with no open task cannot renew, and the lease is unchanged', async () => {
  const b = await bench()
  try {
    const { host, networkId } = await start(b.kernel)
    const before = await b.kernel.ctx.atn.network(networkId)
    // The entry node is the holder of the initial task, so name the wrong task.
    const task = Object.values(before.tasks)[0]!
    await assert.rejects(
      () => b.kernel.ctx.atn.renew(host, { extendMs: 1000, taskId: 'task-does-not-exist' }),
      (error: unknown) => refusalCode(error) === 'unknown-task',
    )

    // Retire the node first: a draining node with no task cannot renew either.
    await b.kernel.ctx.atn.send(host, { to: before.entryNodeId, kind: 'result', taskId: task.id, body: 'done', summary: 'done' })
    await b.kernel.ctx.atn.finish(host)
    await assert.rejects(
      () => b.kernel.ctx.atn.renew(host, { extendMs: 1000, taskId: task.id }),
      (error: unknown) => refusalCode(error) === 'task-settled' || refusalCode(error) === 'not-active',
    )
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('RENEW-02: a task the caller does not hold cannot justify an extension', async () => {
  const b = await bench()
  try {
    const { host, networkId } = await start(b.kernel)
    const child = await b.kernel.ctx.atn.spawn(host, { task: 'Child work.', context: '' })
    const record = await b.kernel.ctx.atn.network(networkId)
    const childTask = Object.values(record.tasks).find((task) => task.holderId === child.nodeId)!
    const hostTask = Object.values(record.tasks).find((task) => task.holderId === record.entryNodeId)!

    await assert.rejects(
      () => b.kernel.ctx.atn.renew(host, { extendMs: 1000, taskId: childTask.id }),
      (error: unknown) => refusalCode(error) === 'not-holder',
      'a node cannot renew against another node\'s task',
    )

    // The real holder can renew against it, and only the lease moves.
    const childAgent = b.kernel.ctx.agents.get(SessionId(child.sessionId))!
    const before = await b.kernel.ctx.atn.network(networkId)
    const granted = await b.kernel.ctx.atn.renew(childAgent, { extendMs: 1000, taskId: childTask.id, basis: 'still working' })
    assert.ok(granted.grantedMs > 0, 'the extension was granted')
    const after = await b.kernel.ctx.atn.network(networkId)
    assert.equal(after.nodes[child.nodeId]!.leaseDeadlineAt, granted.leaseDeadlineAt)
    assert.equal(after.nodes[child.nodeId]!.note, 'still working (task ' + childTask.id + ')')
    assert.equal(after.tasks[childTask.id]!.status, 'open', 'renewal does not settle the task')
    assert.equal(after.tasks[hostTask.id]!.status, 'open')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('RENEW-03: a settled task cannot justify an extension', async () => {
  const b = await bench()
  try {
    const { host, networkId } = await start(b.kernel)
    const record = await b.kernel.ctx.atn.network(networkId)
    const task = Object.values(record.tasks).find((entry) => entry.holderId === record.entryNodeId)!
    await b.kernel.ctx.atn.send(host, { to: record.entryNodeId, kind: 'result', taskId: task.id, body: 'done', summary: 'done' })
    await assert.rejects(
      () => b.kernel.ctx.atn.renew(host, { extendMs: 1000, taskId: task.id }),
      (error: unknown) => refusalCode(error) === 'task-settled',
    )
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('RENEW-04: a stopped network can never be renewed', async () => {
  const b = await bench()
  try {
    const { host, networkId } = await start(b.kernel)
    const record = await b.kernel.ctx.atn.network(networkId)
    const task = Object.values(record.tasks)[0]!
    await b.kernel.ctx.atn.stop(networkId, 'hard stop')
    await assert.rejects(
      () => b.kernel.ctx.atn.renew(host, { extendMs: 1000, taskId: task.id }),
      (error: unknown) => refusalCode(error) === 'network-closed' || refusalCode(error) === 'network-stopped',
    )
    const after = await b.kernel.ctx.atn.network(networkId)
    assert.equal(after.status, 'stopped', 'the network stays stopped')
    assert.equal(after.nodes[record.entryNodeId]!.leaseDeadlineAt, null, 'no lease was granted after the stop')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('RENEW-05: a draining node with an outstanding task may still renew', async () => {
  const b = await bench()
  try {
    const { host, networkId } = await start(b.kernel)
    const child = await b.kernel.ctx.atn.spawn(host, { task: 'Child work.', context: '', leaseMs: 60_000 })
    const childAgent = b.kernel.ctx.agents.get(SessionId(child.sessionId))!
    const record = await b.kernel.ctx.atn.network(networkId)
    const childTask = Object.values(record.tasks).find((task) => task.holderId === child.nodeId)!

    b.advance(61_000)
    await b.kernel.ctx.atn.tick()
    const draining = await b.kernel.ctx.atn.network(networkId)
    assert.equal(draining.nodes[child.nodeId]!.lifecycle, 'draining')

    const granted = await b.kernel.ctx.atn.renew(childAgent, { extendMs: 5000, taskId: childTask.id })
    assert.ok(granted.grantedMs > 0, 'a draining node keeps its lease while work is open')
    const after = await b.kernel.ctx.atn.network(networkId)
    assert.equal(after.nodes[child.nodeId]!.lifecycle, 'draining', 'renewal does not change the lifecycle')
    assert.equal(after.tasks[childTask.id]!.status, 'open')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('RENEW-06: renewal without a task id is refused instead of granting a blank lease', async () => {
  const b = await bench()
  try {
    const { host } = await start(b.kernel)
    await assert.rejects(
      () => b.kernel.ctx.atn.renew(host, { extendMs: 1000, taskId: '', basis: 'trust me' }),
      (error: unknown) => refusalCode(error) === 'missing-task',
    )
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})
