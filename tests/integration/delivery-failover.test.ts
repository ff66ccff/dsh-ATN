/** Delivery ownership follows durable orphan claims without bypassing completion gates. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MemoryNetworkStore } from '../../src/domain.ts'
import type { TaskClaimedEvent } from '../../src/runtime.ts'
import { networkRecordSchema } from '../../src/schema.ts'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { testGoal } from '../fixtures/network.ts'

async function fixture(run: (kernel: Kernel, store: MemoryNetworkStore) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-delivery-failover-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  try { await run(kernel, store) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

async function readyWorker(kernel: Kernel, host: Agent, description = 'Compute the local subtotal.') {
  const spawned = await kernel.atn.spawn(host, { task: description, context: 'Report the aggregate.' })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(spawned.sessionId))!
  const record = await kernel.atn.network(kernel.atn.networkForSession(host.id)!)
  await kernel.atn.send(agent, { to: record.tasks[spawned.taskId]!.requesterId, kind: 'result', taskId: spawned.taskId,
    body: 'Subtotal complete.', summary: 'Subtotal complete.', evidence: ['fixture:subtotal'] })
  await settle(kernel)
  return { ...spawned, agent }
}

for (const terminal of ['budget', 'normal', 'failed'] as const) {
  test(`DELIVERY-01 ${terminal}: retired entry exposes one claimable obligation and a worker delivers`, async () => {
    await fixture(async (kernel, store) => {
      const host = await createHostAgent(kernel, `delivery-${terminal}-host`)
      const started = await kernel.atn.start(host, testGoal)
      const worker = await readyWorker(kernel, host)
      assert.equal(await kernel.atn.deliveryHolder(started.networkId), started.nodeId)
      assert.ok(!Object.values((await kernel.atn.network(started.networkId)).tasks).some(task => task.kind === 'delivery'))
      await assert.rejects(kernel.atn.deliver(worker.agent, { summary: 'Too early.', evidence: [], goalVersion: 1 }), /delivery obligation/)
      await assert.rejects(kernel.atn.claim(worker.agent, 'implicit-delivery'), /not available for claim/)

      if (terminal === 'budget') {
        await store.update(started.networkId, current => ({ ...current, nodes: { ...current.nodes,
          [started.nodeId]: { ...current.nodes[started.nodeId]!, stepsUsed: current.limits.stepBudget } } }))
        assert.equal(await kernel.atn.admitStep(started.networkId, host.id), false)
      } else if (terminal === 'normal') {
        await kernel.atn.send(host, { to: started.nodeId, kind: 'result', taskId: started.taskId,
          body: 'Local work done.', summary: 'Local work done.', evidence: [] })
        await settle(kernel)
        await kernel.atn.finish(host)
        await kernel.atn.tick()
      } else {
        await kernel.atn.failNode(started.networkId, started.nodeId, 'Entry failed before delivery.')
      }
      await kernel.atn.tick()
      await kernel.atn.tick()
      const status = await kernel.atn.status(worker.agent)
      const obligation = status.orphanTasks.find(task => task.kind === 'delivery')!
      assert.ok(obligation)
      assert.equal(obligation.status, 'unreachable')
      assert.equal(obligation.holderId, started.nodeId)
      assert.match(obligation.description, /smallest verifiable/)
      assert.match(obligation.context, /evidence can be re-run/)
      assert.equal(await kernel.atn.deliveryHolder(started.networkId), null)
      assert.equal(Object.values((await kernel.atn.network(started.networkId)).tasks).filter(task => task.kind === 'delivery').length, 1)
      const claimed = (await kernel.atn.status(worker.agent, { claimTaskId: obligation.id })).claimedTask!
      await settle(kernel)
      assert.equal(claimed.kind, 'delivery')
      assert.equal(claimed.retryOf, obligation.id)
      assert.equal(await kernel.atn.deliveryHolder(started.networkId), worker.nodeId)
      await assert.rejects(kernel.atn.send(worker.agent, { to: started.nodeId, kind: 'result', taskId: claimed.id,
        body: 'Not a network delivery.', summary: 'Not a network delivery.', evidence: [] }), /only by atn_finish/)
      await assert.rejects(kernel.atn.deliver(host, { summary: 'Stale entry.', evidence: [], goalVersion: 1 }), /delivery obligation/)
      const delivered = await kernel.atn.deliver(worker.agent, { summary: 'Final aggregate.', evidence: ['fixture:subtotal'], goalVersion: 1 })
      assert.equal(delivered.accepted, true, delivered.reason ?? undefined)
      const final = networkRecordSchema.parse(await kernel.atn.network(started.networkId))
      assert.equal(final.status, 'completed')
      assert.equal(final.tasks[claimed.id]!.status, 'completed')
      assert.equal(final.tasks[claimed.id]!.settledBy, worker.nodeId)
      assert.equal(await kernel.atn.deliveryHolder(started.networkId), null)
      await kernel.atn.tick()
      assert.equal(kernel.ctx.agents.get(SessionId(worker.sessionId)), undefined)
      assert.equal(kernel.ctx.agents.get(SessionId(host.id)), host)
    })
  })
}

test('DELIVERY-02: racing claims and a second holder failure preserve one immutable retry chain', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'delivery-race-host')
    const started = await kernel.atn.start(host, testGoal)
    const workers = [await readyWorker(kernel, host), await readyWorker(kernel, host)]
    await kernel.atn.failNode(started.networkId, started.nodeId, 'Entry unavailable.')
    const source = (await kernel.atn.status(workers[0]!.agent)).orphanTasks.find(task => task.kind === 'delivery')!
    const original = structuredClone(source)
    const results = await Promise.allSettled(workers.map(worker => kernel.atn.claim(worker.agent, source.id)))
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    await settle(kernel)
    const winnerIndex = results.findIndex(result => result.status === 'fulfilled')
    const winner = workers[winnerIndex]!, survivor = workers[1 - winnerIndex]!
    const first = Object.values((await kernel.atn.network(started.networkId)).tasks).find(task => task.retryOf === source.id)!
    assert.equal(first.holderId, winner.nodeId)
    await kernel.atn.failNode(started.networkId, winner.nodeId, 'Replacement delivery holder failed.')
    assert.equal(await kernel.atn.deliveryHolder(started.networkId), null)
    const second = await kernel.atn.claim(survivor.agent, first.id)
    await settle(kernel)
    assert.equal(second.kind, 'delivery')
    assert.equal(await kernel.atn.deliveryHolder(started.networkId), survivor.nodeId)
    assert.deepEqual((await kernel.atn.network(started.networkId)).tasks[source.id], original)
    assert.equal((await kernel.atn.deliver(survivor.agent, { summary: 'Recovered twice.', evidence: [], goalVersion: 1 })).accepted, true)
  })
})

test('DELIVERY-03: a full work-task pool does not prevent retirement, claim or delivery', async () => {
  await fixture(async (kernel, store) => {
    const host = await createHostAgent(kernel, 'delivery-capacity-host')
    const started = await kernel.atn.start(host, testGoal)
    const worker = await readyWorker(kernel, host)
    await store.update(started.networkId, current => ({ ...current, limits: { ...current.limits, maxTasks: Object.keys(current.tasks).length } }))
    await kernel.atn.failNode(started.networkId, started.nodeId, 'No ordinary task capacity remains.')
    const source = (await kernel.atn.status(worker.agent)).orphanTasks.find(task => task.kind === 'delivery')!
    const claim = await kernel.atn.claim(worker.agent, source.id)
    await settle(kernel)
    await assert.rejects(kernel.atn.send(worker.agent, { to: worker.nodeId, kind: 'task', body: 'One extra ordinary task.' }), /already recorded/)
    assert.equal(claim.kind, 'delivery')
    assert.equal((await kernel.atn.deliver(worker.agent, { summary: 'Delivered at capacity.', evidence: [], goalVersion: 1 })).accepted, true)
  })
})

test('DELIVERY-04: replacement delivery keeps the goal, task, proposal and durable-mail gates', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'delivery-gates-host')
    const started = await kernel.atn.start(host, testGoal)
    const holder = await readyWorker(kernel, host), peer = await readyWorker(kernel, host)
    await kernel.atn.failNode(started.networkId, started.nodeId, 'Entry unavailable.')
    const source = (await kernel.atn.status(holder.agent)).orphanTasks.find(task => task.kind === 'delivery')!
    await kernel.atn.claim(holder.agent, source.id)
    await settle(kernel)
    const input = { summary: 'Delivery subject to all gates.', evidence: [], goalVersion: 1 }
    assert.match((await kernel.atn.deliver(holder.agent, { ...input, goalVersion: 0 })).reason!, /goal version/)
    const task = await kernel.atn.send(peer.agent, { to: peer.nodeId, kind: 'task', body: 'One outstanding work item.' })
    await settle(kernel)
    assert.match((await kernel.atn.deliver(holder.agent, input)).reason!, /open task/)
    await kernel.atn.send(peer.agent, { to: peer.nodeId, kind: 'result', taskId: task.settledTaskId!,
      body: 'Done.', summary: 'Done.', evidence: [] })
    await settle(kernel)
    const proposal = await kernel.atn.propose(holder.agent, { document: { ...testGoal, plan: 'Proposed revision.' }, rationale: 'Check the review gate.' })
    await settle(kernel)
    assert.match((await kernel.atn.deliver(holder.agent, input)).reason!, /pending proposal/)
    await kernel.atn.vote(peer.agent, { proposalId: proposal.proposalId, approve: false, reason: 'Keep the current goal.' })
    await settle(kernel)
    const flush = kernel.ctx.sessions.flush.bind(kernel.ctx.sessions)
    kernel.ctx.sessions.flush = async () => false
    try {
      await kernel.atn.send(peer.agent, { to: peer.nodeId, kind: 'note', body: 'Await durable confirmation.' })
      await settle(kernel)
      assert.match((await kernel.atn.deliver(holder.agent, input)).reason!, /undelivered mail/)
    } finally { kernel.ctx.sessions.flush = flush }
    await kernel.atn.tick()
    assert.equal((await kernel.atn.deliver(holder.agent, input)).accepted, true)
  })
})

test('DELIVERY-05: a worker delivering through the real tool returns before its own handle is released', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'delivery-tool-host')
    const started = await kernel.atn.start(host, testGoal)
    const worker = await readyWorker(kernel, host)
    await kernel.atn.failNode(started.networkId, started.nodeId, 'Entry unavailable.')
    const source = (await kernel.atn.status(worker.agent)).orphanTasks.find(task => task.kind === 'delivery')!
    await kernel.atn.claim(worker.agent, source.id)
    await settle(kernel)
    const original = kernel.atn.deliver.bind(kernel.atn)
    kernel.atn.deliver = async (agent, input) => {
      const result = await original(agent, input)
      await kernel.atn.tick()
      assert.equal(kernel.ctx.agents.get(agent.id), agent, 'scheduler must not dispose a delivering tool stack')
      return result
    }
    kernel.model.enqueue(worker.sessionId, [{ tool: 'atn_finish', args: { scope: 'network', summary: 'Delivered by worker.', evidence: [], goalVersion: 1 } }])
    await drive(worker.agent, 'Deliver the final result.')
    const result = worker.agent.session.snapshotEvents().filter(event => event.type === 'tool/result').at(-1)!
    const message = (result.data as { message: { isError?: boolean; content: readonly { text?: string }[] } }).message
    assert.notEqual(message.isError, true)
    assert.equal(JSON.parse(message.content.map(block => block.text ?? '').join('')).accepted, true)
    await kernel.atn.tick()
    assert.equal(kernel.ctx.agents.get(SessionId(worker.sessionId)), undefined)
  })
})

test('DELIVERY-06: recovery provisioning and claim event are durable, ordered before wake, and observer failures do not roll back', async () => {
  await fixture(async (kernel, store) => {
    const host = await createHostAgent(kernel, 'claim-event-host')
    const started = await kernel.atn.start(host, testGoal)
    const victim = await readyWorker(kernel, host), claimant = await readyWorker(kernel, host)
    const recovery = await kernel.atn.provisionRecoveryTask(started.networkId, victim.nodeId,
      'Recover slot 7: read initial-7 and correction-7, then use atn_send(kind=result).', 'Recovery after the phase-2 update.')
    assert.equal(recovery.status, 'open')
    await kernel.atn.failNode(started.networkId, victim.nodeId, 'Phase-2 failure.')
    await assert.rejects(kernel.atn.provisionRecoveryTask(started.networkId, victim.nodeId, 'Too late.'), /active holder/)
    const events: TaskClaimedEvent[] = []
    kernel.ctx.on('atn/task-claimed', () => { throw new Error('An unrelated observer failed.') })
    kernel.ctx.on('atn/task-claimed', event => { events.push(event) })
    store.failNextUpdate = new Error('Claim commit refused.')
    await assert.rejects(kernel.atn.claim(claimant.agent, recovery.id), /Claim commit refused/)
    assert.equal(events.length, 0)
    const original = kernel.atn.deliverMail.bind(kernel.atn)
    kernel.atn.deliverMail = async (networkId, mailId) => {
      const record = await kernel.atn.network(networkId)
      const task = record.tasks[record.mails[mailId]!.taskId ?? '']
      if (task?.retryOf === recovery.id) {
        assert.equal(events.length, 1, 'authorization notification precedes recipient wake')
        assert.equal(events[0]!.task.id, task.id)
        assert.equal(events[0]!.sessionId, claimant.sessionId)
        assert.equal(events[0]!.sourceTask.id, recovery.id)
      }
      return original(networkId, mailId)
    }
    const claimed = await kernel.atn.claim(claimant.agent, recovery.id)
    assert.equal(claimed.description, recovery.description)
    assert.equal((await kernel.atn.network(started.networkId)).tasks[claimed.id]!.holderId, claimant.nodeId)
  })
})
