/** Local selection remains atomic and recoverable under finite node budgets. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MemoryNetworkStore } from '../../src/domain.ts'
import type { TaskRecord } from '../../src/schema.ts'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { testGoal } from '../fixtures/network.ts'

async function fixture(run: (kernel: Kernel, store: MemoryNetworkStore) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-local-coordination-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  try { await run(kernel, store) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

async function spawn(kernel: Kernel, host: Agent, task: string, idle = false) {
  const child = await kernel.atn.spawn(host, { task, context: 'Keep the original evidence and requester.' })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(child.sessionId))!
  if (idle) {
    const record = await kernel.atn.network(kernel.atn.networkForSession(host.id)!)
    await kernel.atn.send(agent, { to: record.tasks[child.taskId]!.requesterId, kind: 'result', taskId: child.taskId,
      body: 'Ready for another task.', summary: 'Initial work submitted.', evidence: ['fixture:initial-work'] })
    await settle(kernel)
  }
  return { ...child, agent }
}

test('LOCAL-01: racing idle claimants preserve one original attempt and create exactly one recovery task', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'claim-race-host')
    const started = await kernel.atn.start(host, testGoal)
    const abandoned = await spawn(kernel, host, 'Recover the routing evidence.')
    const first = await spawn(kernel, host, 'First independent worker.', true)
    const second = await spawn(kernel, host, 'Second independent worker.', true)
    await kernel.atn.failNode(started.networkId, abandoned.nodeId, 'Injected worker loss.')
    const original = structuredClone((await kernel.atn.network(started.networkId)).tasks[abandoned.taskId]!)
    const results = await Promise.allSettled([
      kernel.atn.claim(first.agent, abandoned.taskId), kernel.atn.claim(second.agent, abandoned.taskId),
    ])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected').length, 1)
    await settle(kernel)
    const record = await kernel.atn.network(started.networkId)
    const retries = Object.values(record.tasks).filter(task => task.retryOf === abandoned.taskId)
    assert.equal(retries.length, 1)
    assert.equal(retries[0]!.requesterId, started.nodeId)
    assert.equal(retries[0]!.description, original.description)
    assert.equal(retries[0]!.context, original.context)
    assert.equal(retries[0]!.status, 'open')
    assert.deepEqual(record.tasks[abandoned.taskId], original, 'the dead holder and failure evidence remain immutable')
    assert.equal(Object.values(record.mails).filter(mail => mail.kind === 'task' && mail.taskId === retries[0]!.id).length, 1)
    assert.ok(!(await kernel.atn.status(second.agent)).orphanTasks.some(task => task.id === abandoned.taskId))
  })
})

test('LOCAL-02: an orphan survives reboot and is claimed through the merged model status tool', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-claim-reboot-'))
  const store = new MemoryNetworkStore()
  let kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  try {
    const host = await createHostAgent(kernel, 'claim-reboot-host')
    const started = await kernel.atn.start(host, testGoal)
    const abandoned = await spawn(kernel, host, 'Recover evidence after restart.')
    const survivor = await spawn(kernel, host, 'Available after restart.', true)
    await kernel.atn.failNode(started.networkId, abandoned.nodeId, 'Lost before restart.')
    const before = await kernel.atn.network(started.networkId)
    const original = structuredClone(before.tasks[abandoned.taskId])
    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
    await kernel.atn.recover()
    const resumed = kernel.ctx.agents.get(SessionId(survivor.sessionId))!
    assert.ok(resumed)
    assert.ok((await kernel.atn.status(resumed)).orphanTasks.some(task => task.id === abandoned.taskId))
    kernel.model.enqueue(resumed.id, [{ tool: 'atn_status', args: { query: 'evidence', claimTaskId: abandoned.taskId } }])
    await drive(resumed, 'Choose the matching orphan task.')
    await settle(kernel)
    const event = resumed.session.snapshotEvents().filter(row => row.type === 'tool/result').at(-1)!
    const message = (event.data as { message: { isError?: boolean; content: readonly { text?: string }[] } }).message
    assert.notEqual(message.isError, true, JSON.stringify(message.content))
    const status = JSON.parse(message.content.map(block => block.text ?? '').join('')) as {
      self: string; tasks: TaskRecord[]; claimedTask: TaskRecord; orphanTasks: TaskRecord[];
      budget: { stepsUsed: number; stepsRemaining: number; stepBudget: number }
    }
    assert.equal(status.self, survivor.nodeId)
    assert.equal(status.claimedTask.holderId, survivor.nodeId)
    assert.equal(status.claimedTask.retryOf, abandoned.taskId)
    assert.ok(status.tasks.some(task => task.id === status.claimedTask.id))
    assert.ok(!status.orphanTasks.some(task => task.id === abandoned.taskId))
    assert.ok(status.budget.stepsUsed > (before.nodes[survivor.nodeId]!.stepsUsed ?? 0), 'recovery preserves consumed node budget')
    assert.equal(status.budget.stepsRemaining, status.budget.stepBudget - status.budget.stepsUsed)
    assert.deepEqual((await kernel.atn.network(started.networkId)).tasks[abandoned.taskId], original)
  } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})

test('LOCAL-03: every model call from network start counts against the host entry budget', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'budget-entry-host')
    kernel.model.enqueue(host.id, [{ tool: 'atn_start', args: testGoal }, { tool: 'atn_status', args: {} }])
    await drive(host, 'Start and inspect the network.')
    await settle(kernel)
    const record = await kernel.atn.network((await kernel.atn.networkIds())[0]!)
    const observed = kernel.model.requests.filter(request => request.sessionId === host.id).length
    assert.ok(observed >= 2)
    assert.equal(record.nodes[record.entryNodeId]!.stepsUsed, observed)
    assert.equal(record.stepsUsed, observed)
  })
})

test('LOCAL-04: the last admitted step can submit before retirement, while peers keep their budget', async () => {
  await fixture(async (kernel, store) => {
    const host = await createHostAgent(kernel, 'last-step-host')
    const started = await kernel.atn.start(host, testGoal)
    const child = await spawn(kernel, host, 'Submit with the last available step.')
    await store.update(started.networkId, record => ({ ...record, limits: { ...record.limits, stepBudget: 4 },
      nodes: { ...record.nodes, [child.nodeId]: { ...record.nodes[child.nodeId]!, stepsUsed: 3 } } }))
    let entered!: () => void, release!: () => void
    const entering = new Promise<void>(resolve => { entered = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    const remove = kernel.ctx.on('tools/execute', async (exec, next) => {
      if (exec.name === 'atn_send' && exec.agent?.id === child.sessionId) { entered(); await released }
      return next()
    })
    kernel.model.enqueue(child.sessionId, [{ tool: 'atn_send', args: {
      to: started.nodeId, kind: 'result', taskId: child.taskId, body: 'Last step result.', summary: 'Submitted before retirement.',
    } }])
    const callsBefore = kernel.model.requests.filter(request => request.sessionId === child.sessionId).length
    const driving = drive(child.agent, 'Report your final evidence now.')
    try {
      await entering
      await kernel.atn.tick()
      const during = await kernel.atn.network(started.networkId)
      assert.equal(during.nodes[child.nodeId]!.stepsUsed, 4)
      assert.equal(during.nodes[child.nodeId]!.lifecycle, 'active', 'a running last step may still execute its result tool')
    } finally { release(); await driving; remove() }
    await settle(kernel)
    await kernel.atn.tick()
    const after = await kernel.atn.network(started.networkId)
    assert.equal(after.nodes[child.nodeId]!.lifecycle, 'retired')
    assert.equal(after.tasks[child.taskId]!.status, 'completed')
    assert.equal(after.nodes[started.nodeId]!.lifecycle, 'active')
    assert.ok((after.nodes[started.nodeId]!.stepsUsed ?? 0) < after.limits.stepBudget)
    assert.equal(kernel.model.requests.filter(request => request.sessionId === child.sessionId).length, callsBefore + 1)
    assert.equal(kernel.ctx.agents.get(SessionId(child.sessionId)), undefined)
  })
})

test('LOCAL-05: exhausting a worker exposes its unfinished task without waking or draining a healthy peer', async () => {
  await fixture(async (kernel, store) => {
    const host = await createHostAgent(kernel, 'orphan-budget-host')
    const started = await kernel.atn.start(host, testGoal)
    const child = await spawn(kernel, host, 'Unfinished work after budget exhaustion.')
    await store.update(started.networkId, record => ({ ...record, limits: { ...record.limits, stepBudget: 4 },
      nodes: { ...record.nodes, [child.nodeId]: { ...record.nodes[child.nodeId]!, stepsUsed: 3 } } }))
    kernel.model.enqueue(child.sessionId, [{ tool: 'atn_status', args: {} }])
    const hostCalls = kernel.model.requests.filter(request => request.sessionId === host.id).length
    await drive(child.agent, 'Use the last remaining step.')
    await kernel.atn.tick()
    const status = await kernel.atn.status(host)
    const orphan = status.orphanTasks.find(task => task.id === child.taskId)
    assert.equal(orphan?.status, 'unreachable')
    assert.equal(orphan?.holderId, child.nodeId)
    const record = await kernel.atn.network(started.networkId)
    assert.equal(record.nodes[child.nodeId]!.lifecycle, 'retired')
    assert.equal(record.nodes[started.nodeId]!.lifecycle, 'active')
    assert.equal(kernel.model.requests.filter(request => request.sessionId === host.id).length, hostCalls)
    await assert.rejects(kernel.atn.claim(host, child.taskId), /settle your current tasks/)
  })
})

test('LOCAL-06: a completed network leaves ordinary host turns runnable outside its accounting', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'completed-host-continuity')
    const started = await kernel.atn.start(host, testGoal)
    await kernel.atn.send(host, { to: started.nodeId, kind: 'result', taskId: started.taskId,
      body: 'Complete.', summary: 'Task completed.', evidence: ['fixture:completed'] })
    await settle(kernel)
    await kernel.atn.tick()
    const result = await kernel.atn.deliver(host, { summary: 'Delivered.', evidence: [], goalVersion: 1 })
    assert.equal(result.accepted, true, result.reason ?? undefined)
    const before = await kernel.atn.network(started.networkId)
    const calls = kernel.model.requests.length
    await drive(host, 'An ordinary follow-up after the completed network.')
    const after = await kernel.atn.network(started.networkId)
    assert.equal(kernel.model.requests.length, calls + 1)
    assert.equal(after.stepsUsed, before.stepsUsed)
    assert.equal(after.nodes[started.nodeId]!.stepsUsed, before.nodes[started.nodeId]!.stepsUsed)
    assert.equal(kernel.ctx.agents.get(SessionId(host.id)), host)
  })
})
