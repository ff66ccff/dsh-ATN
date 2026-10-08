/** Outbox recovery, Session durability barriers and bounded task completion. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { enqueueMail } from '../../src/mailbox.ts'
import { mailMessage } from '../../src/messages.ts'
import { settleTask } from '../../src/tasks.ts'
import { atnMessages, bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'

const goal = { objective: 'Keep accepted work recoverable.', successCriteria: 'Every result reaches its requester with evidence.', constraints: 'Scripted model only.' }

function deferred() {
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function hasMail(message: UserMessage, mailId: string): boolean {
  return message.content.some(block => block.type === 'text' && block.text.split('\n', 1)[0]?.includes(`mail=${mailId}`))
}

/** Fail an actual Harness request after another node injects mail into it. */
async function timeoutWithPendingMail(kernel: Kernel, agent: Agent, enqueue: () => Promise<unknown>): Promise<void> {
  const entered = deferred(), release = deferred()
  let fail = true
  const remove = kernel.ctx.on('llm/stream', (request, next) => (async function* () {
    if (request.sessionId === agent.id && fail) {
      fail = false
      entered.resolve()
      await release.promise
      yield { type: 'finish' as const, reason: { kind: 'error' as const, failure: { code: 'TIMEOUT', message: 'Scripted provider timeout.' } } }
      return
    }
    yield* next()
  })(), { global: true, prepend: true })
  const driving = drive(agent, 'Wait for the in-flight request to fail.')
  try {
    await entered.promise
    await enqueue()
    release.resolve()
    await driving
    assert.equal(agent.status, 'idle')
    const lastTurn = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
    assert.equal(lastTurn?.type === 'turn/end' ? lastTurn.data.reason.kind : undefined, 'error')
  } finally { release.resolve(); await driving; remove() }
}

async function fixture(run: (kernel: Kernel, store: MemoryNetworkStore) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-durable-assignment-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  try { await run(kernel, store) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

async function start(kernel: Kernel) {
  const host = await createHostAgent(kernel, 'host')
  const network = await kernel.atn.start(host, goal)
  const child = await kernel.atn.spawn(host, { task: 'Produce a verifiable result.', context: 'Include the concrete artifact path.' })
  await settle(kernel)
  const worker = kernel.ctx.agents.get(SessionId(child.sessionId))!
  return { host, network, child, worker }
}

test('OUTBOX-01: initial assignment is atomic with publication and recovers after delivery fails before input append', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-initial-recovery-'))
  const store = new MemoryNetworkStore()
  let kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  try {
    const host = await createHostAgent(kernel, 'host')
    const network = await kernel.atn.start(host, goal)
    let observedPublication = false
    store.updateHook = candidate => {
      const child = Object.values(candidate.nodes).find(node => !node.isEntry && node.creationState === 'published')
      if (child === undefined) return
      observedPublication = true
      const task = Object.values(candidate.tasks).find(task => task.holderId === child.id)
      assert.ok(task, 'the first published record already contains its task')
      assert.ok(Object.values(candidate.mails).some(mail => mail.kind === 'task' && mail.toId === child.id && mail.taskId === task.id), 'the same record contains the task outbox')
    }
    const original = kernel.atn.deliverMail.bind(kernel.atn)
    kernel.atn.deliverMail = async () => { throw new Error('injected interruption before initial input append') }
    const child = await kernel.atn.spawn(host, { task: 'Recover this initial assignment.', context: 'Retain this exact context.' })
    kernel.atn.deliverMail = original
    assert.equal(observedPublication, true)
    const before = await kernel.atn.network(network.networkId)
    const mail = Object.values(before.mails).find(mail => mail.taskId === child.taskId)!
    assert.equal(mail.status, 'queued')
    assert.equal(before.tasks[child.taskId]!.status, 'open')
    assert.equal(before.nodes[child.nodeId]!.lifecycle, 'active')
    assert.ok(!atnMessages(kernel.ctx.agents.get(SessionId(child.sessionId))!).some(text => text.includes(`task=${child.taskId}`)))
    await kernel.ctx.fiber.dispose()
    store.updateHook = null
    kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
    await kernel.atn.recover()
    await settle(kernel)
    const resumed = kernel.ctx.agents.get(SessionId(child.sessionId))!
    const assignments = atnMessages(resumed).filter(text => text.includes(`mail=${mail.id}`))
    assert.equal(assignments.length, 1)
    assert.match(assignments[0]!, /Recover this initial assignment\./)
    assert.match(assignments[0]!, /Retain this exact context\./)
    assert.match(assignments[0]!, new RegExp(`holder=${child.nodeId} requester=${network.nodeId}`))
    assert.equal((await kernel.atn.network(network.networkId)).mails[mail.id]!.status, 'delivered')
    await kernel.atn.recover()
    await settle(kernel)
    assert.equal(atnMessages(resumed).filter(text => text.includes(`mail=${mail.id}`)).length, 1)
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('OUTBOX-02: delivery remains queued until Session flush succeeds, and a failed checkpoint retries once', async () => {
  await fixture(async kernel => {
    const { host, network, child, worker } = await start(kernel)
    const entered = deferred()
    const checkpoint = deferred()
    const remove = kernel.ctx.on('session/flush', async session => {
      if (session.id !== worker.id) return
      entered.resolve()
      await checkpoint.promise
    })
    const input = { to: child.nodeId, kind: 'note' as const, body: 'Durable checkpoint message.', messageId: 'checkpoint-mail' }
    const sending = kernel.atn.send(host, input)
    const refused = assert.rejects(sending, /injected checkpoint failure/)
    try {
      await entered.promise
      assert.equal((await kernel.atn.network(network.networkId)).mails[input.messageId]!.status, 'queued', 'inbox acceptance alone is not delivery')
      checkpoint.reject(new Error('injected checkpoint failure'))
      await refused
      assert.equal((await kernel.atn.network(network.networkId)).mails[input.messageId]!.status, 'queued')
    } finally { remove(); checkpoint.resolve() }
    const retry = await kernel.atn.send(host, input)
    assert.equal(retry.duplicate, true)
    assert.equal(retry.delivery, 'delivered')
    await settle(kernel)
    assert.equal(atnMessages(worker).filter(text => text.includes(`mail=${input.messageId}`)).length, 1)
  })
})

test('OUTBOX-03: absent durability participation never claims a delivered receipt', async () => {
  await fixture(async kernel => {
    const { host, network, child, worker } = await start(kernel)
    const original = kernel.ctx.sessions.flush.bind(kernel.ctx.sessions)
    kernel.ctx.sessions.flush = async () => false
    const input = { to: child.nodeId, kind: 'note' as const, body: 'Wait for durable storage.', messageId: 'no-checkpoint-mail' }
    try {
      assert.equal((await kernel.atn.send(host, input)).delivery, 'queued')
      assert.equal((await kernel.atn.network(network.networkId)).mails[input.messageId]!.status, 'queued')
    } finally { kernel.ctx.sessions.flush = original }
    assert.equal((await kernel.atn.send(host, input)).delivery, 'delivered')
    await settle(kernel)
    assert.equal(atnMessages(worker).filter(text => text.includes(`mail=${input.messageId}`)).length, 1)
  })
})

test('OUTBOX-04: full ordinary retention still permits accepted work to settle, retry and complete the network', async () => {
  await fixture(async (kernel, store) => {
    const { host, network, child, worker } = await start(kernel)
    const before = await kernel.atn.network(network.networkId)
    const ordinaryCap = Object.keys(before.mails).length
    await store.update(network.networkId, current => ({ ...current, limits: { ...current.limits, maxRetainedMail: ordinaryCap, maxPendingMailPerNode: ordinaryCap } }))
    await assert.rejects(kernel.atn.send(host, { to: child.nodeId, kind: 'note', body: 'Cannot add ordinary work.' }), /retains/)
    const input = { to: network.nodeId, kind: 'result' as const, taskId: child.taskId, body: 'Done.', summary: 'All checks passed.', evidence: ['checks.json'], messageId: 'completion-reserve-result' }
    const first = await kernel.atn.send(worker, input)
    const retry = await kernel.atn.send(worker, input)
    assert.equal(first.delivery, 'delivered')
    assert.equal(retry.duplicate, true)
    const after = await kernel.atn.network(network.networkId)
    assert.equal(after.tasks[child.taskId]!.status, 'completed')
    assert.equal(Object.keys(after.mails).length, ordinaryCap + 1)
    assert.ok(Object.keys(after.mails).length <= after.limits.maxRetainedMail + after.limits.maxTasks)
    const delivered = await kernel.atn.deliver(host, { summary: 'Verified completion.', evidence: ['checks.json'], goalVersion: 1 })
    assert.equal(delivered.accepted, true)
  })
})

test('OUTBOX-05: a pre-upgrade result already in Session history retains its marker and is not replayed twice', async () => {
  await fixture(async (kernel, store) => {
    const { host, network, child } = await start(kernel)
    let mailId = ''
    const record = await store.update(network.networkId, current => {
      const completed = settleTask(current, child.taskId, child.nodeId, { summary: 'Structured conclusion.', evidence: ['existing-proof.txt'] }, 1_000_000)
      const queued = enqueueMail(completed.record, { fromId: child.nodeId, toId: network.nodeId, kind: 'result', taskId: child.taskId, proposalId: null, body: 'Legacy body.', now: 1_000_000 })
      mailId = queued.mailId
      return queued.record
    })
    const legacy = mailMessage(record.mails[mailId]!, network.networkId, 'completed')
    const modern = mailMessage(record.mails[mailId]!, network.networkId, 'completed', record.tasks[child.taskId]!.result)
    const text = (message: typeof legacy) => message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    assert.equal(text(legacy).split('\n')[0], text(modern).split('\n')[0])
    assert.match(text(modern), /Summary: Structured conclusion\./)
    assert.match(text(modern), /existing-proof\.txt/)
    host.followup(legacy)
    await settle(kernel)
    await kernel.ctx.sessions.flush(host.session)
    assert.equal(await kernel.atn.deliverMail(network.networkId, mailId), 'delivered')
    await settle(kernel)
    assert.equal(atnMessages(host).filter(text => text.includes(`mail=${mailId}`)).length, 1)
  })
})

test('OUTBOX-06: claimed input without a persisted user-message receipt stays replayable until admission', async () => {
  await fixture(async kernel => {
    const { host, network, child, worker } = await start(kernel)
    const entered = deferred(), release = deferred()
    const remove = kernel.ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent.id === worker.id && payload.messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('mail=claimed-gap')))) {
        entered.resolve()
        await release.promise
      }
      return next()
    })
    try {
      const sent = await kernel.atn.send(host, { to: child.nodeId, kind: 'task', body: 'Survive the claim-to-history gap.', messageId: 'claimed-gap' })
      await entered.promise
      assert.equal(sent.delivery, 'queued')
      assert.equal((await kernel.atn.network(network.networkId)).mails['claimed-gap']!.status, 'queued')
      const handle = await kernel.ctx.sessionPersistence.open(worker.id, 'read')
      const stored = await handle.read()
      await handle.close()
      assert.ok(!stored.events.some(event => event.type === 'user/message' && event.data.content.some(block => block.type === 'text' && block.text.includes('mail=claimed-gap'))), 'the persisted history proves the receipt is still missing')
      assert.ok(![...worker.inbox.nextStep, ...worker.inbox.nextTurn].some(message => message.content.some(block => block.type === 'text' && block.text.includes('mail=claimed-gap'))), 'the live inbox has already been claimed')
      await kernel.atn.tick()
      assert.equal((await kernel.atn.network(network.networkId)).mails['claimed-gap']!.status, 'queued', 'another flush must not acknowledge the intermediate state')
      release.resolve()
      await settle(kernel)
      await kernel.atn.tick()
      assert.equal((await kernel.atn.network(network.networkId)).mails['claimed-gap']!.status, 'delivered')
      assert.equal(atnMessages(worker).filter(text => text.includes('mail=claimed-gap')).length, 1)
    } finally { remove(); release.resolve() }
  })
})

test('OUTBOX-07: a result sent to the current driver can complete on its next step without waiting for a scheduler tick', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'host')
    const network = await kernel.atn.start(host, goal)
    await settle(kernel)
    kernel.model.enqueue('host', [
      { tool: 'atn_send', args: { to: network.nodeId, kind: 'result', taskId: network.taskId, body: 'Self-result.', summary: 'Verified.', evidence: ['self-proof.txt'], messageId: 'self-result' } },
      { tool: 'atn_finish', args: { scope: 'network', summary: 'Delivered.', evidence: ['self-proof.txt'], goalVersion: 1 } },
    ])
    await drive(host, 'Settle and deliver your own work.')
    const record = await kernel.atn.network(network.networkId)
    assert.equal(record.mails['self-result']!.status, 'delivered', 'completion refreshed the receipt from the newly admitted input')
    assert.equal(record.status, 'completed')
    assert.equal(atnMessages(host).filter(text => text.includes('mail=self-result')).length, 1)
  })
})

test('OUTBOX-08: restarting after a claimed turn is interrupted replays the queued assignment', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-claimed-recovery-'))
  const store = new MemoryNetworkStore()
  let kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  const entered = deferred(), release = deferred(), aborted = deferred()
  try {
    const { host, network, child, worker } = await start(kernel)
    kernel.ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent.id === worker.id && payload.messages.some(message => message.content.some(block => block.type === 'text' && block.text.includes('mail=interrupted-claim')))) {
        payload.signal.addEventListener('abort', () => aborted.resolve(), { once: true })
        entered.resolve()
        await release.promise
      }
      return next()
    })
    const sent = await kernel.atn.send(host, { to: child.nodeId, kind: 'task', body: 'Recover work interrupted after claim.', messageId: 'interrupted-claim' })
    await entered.promise
    assert.equal(sent.delivery, 'queued')
    const disposing = kernel.ctx.fiber.dispose()
    await aborted.promise
    release.resolve()
    await disposing
    assert.equal(await kernel.atn.deliverMail(network.networkId, 'interrupted-claim'), 'queued', 'delivery during teardown must remain replayable')
    assert.equal((await store.load(network.networkId))!.mails['interrupted-claim']!.status, 'queued')
    kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
    await kernel.atn.recover()
    await settle(kernel)
    await kernel.atn.tick()
    const resumed = kernel.ctx.agents.get(SessionId(child.sessionId))!
    assert.equal(atnMessages(resumed).filter(text => text.includes('mail=interrupted-claim')).length, 1)
    assert.equal((await kernel.atn.network(network.networkId)).mails['interrupted-claim']!.status, 'delivered')
  } finally {
    release.resolve()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('OUTBOX-09: a result injected during a provider timeout wakes the idle requester exactly once', async () => {
  await fixture(async kernel => {
    const { host, network, child, worker } = await start(kernel)
    const mailId = 'timeout-result'
    let pendingId: UserMessage['id'] | undefined
    await timeoutWithPendingMail(kernel, host, async () => {
      const sent = await kernel.atn.send(worker, { to: network.nodeId, kind: 'result', taskId: child.taskId,
        body: 'The worker finished during the failing request.', summary: 'Verified result.', evidence: ['timeout-proof.json'], messageId: mailId })
      assert.equal(sent.delivery, 'queued')
      pendingId = host.inbox.nextStep.find(message => hasMail(message, mailId))?.id
      assert.ok(pendingId)
    })
    assert.ok(host.inbox.nextStep.some(message => message.id === pendingId))
    assert.equal(atnMessages(host).filter(text => text.includes(`mail=${mailId}`)).length, 0)
    await kernel.atn.tick()
    await settle(kernel)
    await kernel.atn.tick()
    assert.equal((await kernel.atn.network(network.networkId)).mails[mailId]!.status, 'delivered')
    const receipt = host.session.snapshotEvents().filter(event => event.type === 'user/message' && hasMail(event.data, mailId))
    assert.equal(receipt.length, 1)
    assert.equal(receipt[0]!.type === 'user/message' ? receipt[0]!.data.id : undefined, pendingId, 're-waking retains the already queued input identity')
    const calls = kernel.model.requests.length
    await kernel.atn.tick()
    await settle(kernel)
    assert.equal(kernel.model.requests.length, calls, 'a durable receipt must never wake another request')
  })
})

test('OUTBOX-10: a same-process cancelled claim is replayed once after the agent becomes idle', async () => {
  await fixture(async kernel => {
    const { host, network, child, worker } = await start(kernel)
    const mailId = 'cancelled-live-claim'
    const entered = deferred(), release = deferred()
    const remove = kernel.ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent === worker && payload.messages.some(message => hasMail(message, mailId))) {
        entered.resolve()
        await release.promise
      }
      return next()
    })
    try {
      assert.equal((await kernel.atn.send(host, { to: child.nodeId, kind: 'note', body: 'Replay after interrupted admission.', messageId: mailId })).delivery, 'queued')
      await entered.promise
      worker.cancel({ kind: 'user' })
      release.resolve()
      await worker.whenIdle()
      assert.equal(worker.status, 'idle')
      assert.ok(![...worker.inbox.nextStep, ...worker.inbox.nextTurn].some(message => hasMail(message, mailId)))
      assert.equal(atnMessages(worker).filter(text => text.includes(`mail=${mailId}`)).length, 0)
    } finally { release.resolve(); remove() }
    await kernel.atn.tick()
    await settle(kernel)
    await kernel.atn.tick()
    assert.equal((await kernel.atn.network(network.networkId)).mails[mailId]!.status, 'delivered')
    assert.equal(atnMessages(worker).filter(text => text.includes(`mail=${mailId}`)).length, 1)
  })
})

test('OUTBOX-11: exhausted step budget never re-wakes pending input after a failed request', async () => {
  await fixture(async (kernel, store) => {
    const { host, network, child, worker } = await start(kernel)
    const mailId = 'budget-parked-mail'
    await timeoutWithPendingMail(kernel, worker, async () => {
      await kernel.atn.send(host, { to: child.nodeId, kind: 'note', body: 'Wait within the remaining budget.', messageId: mailId })
    })
    await store.update(network.networkId, record => ({
      ...record,
      nodes: { ...record.nodes, [child.nodeId]: { ...record.nodes[child.nodeId]!, stepsUsed: record.limits.stepBudget } },
    }))
    const events = worker.session.snapshotEvents().length
    const calls = kernel.model.requests.length
    await kernel.atn.deliverMail(network.networkId, mailId)
    await kernel.atn.tick()
    await settle(kernel)
    assert.equal(worker.status, 'idle')
    assert.equal(kernel.model.requests.length, calls)
    assert.ok(!worker.session.snapshotEvents().slice(events).some(event => event.type === 'turn/start'), 'retirement may record cleanup, but must not open another driver')
    const retired = await kernel.atn.network(network.networkId)
    assert.equal(retired.nodes[child.nodeId]!.lifecycle, 'retired')
    assert.equal(retired.mails[mailId]!.status, 'undeliverable')
  })
})

test('OUTBOX-12: stopping a network prevents re-waking its host entry after a failed request', async () => {
  await fixture(async kernel => {
    const { host, network, child, worker } = await start(kernel)
    const mailId = 'stopped-pending-result'
    await timeoutWithPendingMail(kernel, host, async () => {
      await kernel.atn.send(worker, { to: network.nodeId, kind: 'result', taskId: child.taskId, body: 'Done.', summary: 'Done.', messageId: mailId })
    })
    await kernel.atn.stop(network.networkId, 'Explicit host stop.')
    const calls = kernel.model.requests.length
    const events = host.session.snapshotEvents().length
    await kernel.atn.deliverMail(network.networkId, mailId)
    await kernel.atn.tick()
    await settle(kernel)
    assert.equal(host.status, 'idle')
    assert.equal(kernel.model.requests.length, calls)
    assert.equal(host.session.snapshotEvents().length, events)
    assert.equal((await kernel.atn.network(network.networkId)).status, 'stopped')
    assert.equal(atnMessages(host).filter(text => text.includes(`mail=${mailId}`)).length, 0)
  })
})

test('OUTBOX-13: replaying a cancelled initial claim also restores its lost shared-goal snapshot', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'host')
    const network = await kernel.atn.start(host, goal)
    const entered = deferred(), release = deferred()
    const remove = kernel.ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent !== host && payload.messages.some(message => message.content.some(block => block.type === 'text' && block.text.startsWith('[ATN task]')))) {
        entered.resolve()
        await release.promise
      }
      return next()
    })
    let worker!: Agent
    let taskId = ''
    try {
      const child = await kernel.atn.spawn(host, { task: 'Recover both work and its governing goal.', context: '' })
      worker = kernel.ctx.agents.get(SessionId(child.sessionId))!
      taskId = child.taskId
      await entered.promise
      worker.cancel({ kind: 'user' })
      release.resolve()
      await worker.whenIdle()
      assert.equal(atnMessages(worker).length, 0, 'the first claim lost both task input and the preceding goal snapshot')
      assert.equal(worker.inbox.nextStep.length + worker.inbox.nextTurn.length, 0)
    } finally { release.resolve(); remove() }
    await kernel.atn.tick()
    await settle(kernel)
    await kernel.atn.tick()
    const messages = atnMessages(worker)
    assert.equal(messages.filter(text => text.startsWith('[ATN shared goal]')).length, 1)
    assert.equal(messages.filter(text => text.startsWith('[ATN task]') && text.includes(`task=${taskId}`)).length, 1)
    const record = await kernel.atn.network(network.networkId)
    assert.equal(Object.values(record.mails).find(mail => mail.taskId === taskId)!.status, 'delivered')
  })
})

for (const boundary of ['next-step', 'next-turn'] as const) {
  test(`OUTBOX-14/${boundary}: re-waking preserves two queued messages in their original order and identities`, async () => {
    await fixture(async kernel => {
      const { host, network, child, worker } = await start(kernel)
      const mailIds = ['ordered-first', 'ordered-second']
      await timeoutWithPendingMail(kernel, worker, async () => {
        for (const messageId of mailIds) await kernel.atn.send(host, { to: child.nodeId, kind: 'note', body: messageId, messageId })
      })
      const pending = worker.inbox.nextStep.filter(message => mailIds.some(id => hasMail(message, id)))
      assert.equal(pending.length, 2)
      if (boundary === 'next-turn') {
        // Simulate a public host/session recovery that parks ordinary turns.
        for (const message of pending) {
          worker.inbox.remove(message.id)
          worker.inbox.append(boundary, message)
        }
      }
      const originalIds = pending.map(message => message.id)
      const claimed = deferred(), release = deferred()
      const remove = kernel.ctx.on('agent/pre-step', async (payload, next) => {
        if (payload.agent === worker && payload.messages.some(message => hasMail(message, mailIds[0]!))) {
          claimed.resolve()
          await release.promise
        }
        return next()
      })
      try {
        await kernel.atn.deliverMail(network.networkId, mailIds[0]!)
        await claimed.promise
        await kernel.atn.deliverMail(network.networkId, mailIds[1]!)
        const pendingSecond = [...worker.inbox.nextStep, ...worker.inbox.nextTurn].filter(message => hasMail(message, mailIds[1]!))
        assert.equal(pendingSecond.length, boundary === 'next-step' ? 0 : 1, 'the newly claimed batch stays protected against concurrent replay')
      } finally { release.resolve(); await settle(kernel); remove() }
      await kernel.atn.tick()
      const receivedIds = worker.session.snapshotEvents().flatMap(event =>
        event.type === 'user/message' && mailIds.some(id => hasMail(event.data, id)) ? [event.data.id] : [])
      assert.deepEqual(receivedIds, originalIds, 'the wake must not move the first queued message behind the second')
      assert.ok(mailIds.every(id => (worker.inbox.nextStep.concat(worker.inbox.nextTurn)).every(message => !hasMail(message, id))))
      const record = await kernel.atn.network(network.networkId)
      assert.ok(mailIds.every(id => record.mails[id]!.status === 'delivered'))
    })
  })
}

test('OUTBOX-15: a new running driver never inherits a cancelled predecessor\'s claimed-input deduplication', async () => {
  await fixture(async kernel => {
    const { host, network, child, worker } = await start(kernel)
    const mailId = 'prior-driver-claim'
    const claimed = deferred(), releaseClaim = deferred()
    const removeClaim = kernel.ctx.on('agent/pre-step', async (payload, next) => {
      if (payload.agent === worker && payload.messages.some(message => hasMail(message, mailId))) {
        claimed.resolve()
        await releaseClaim.promise
      }
      return next()
    })
    try {
      await kernel.atn.send(host, { to: child.nodeId, kind: 'note', body: 'Must survive across drivers.', messageId: mailId })
      await claimed.promise
      worker.cancel({ kind: 'user' })
      releaseClaim.resolve()
      await worker.whenIdle()
    } finally { releaseClaim.resolve(); removeClaim() }
    const streaming = deferred(), releaseStream = deferred()
    let hold = true
    const removeStream = kernel.ctx.on('llm/stream', (request, next) => (async function* () {
      if (request.sessionId === worker.id && hold) {
        hold = false
        streaming.resolve()
        await releaseStream.promise
      }
      yield* next()
    })(), { global: true, prepend: true })
    const running = drive(worker, 'An unrelated caller starts a new driver before mailbox replay.')
    try {
      await streaming.promise
      assert.equal(worker.status, 'running')
      await kernel.atn.tick()
      assert.ok(worker.inbox.nextStep.some(message => hasMail(message, mailId)), 'the new driver must receive the old unlogged mail while still running')
    } finally { releaseStream.resolve(); await running; removeStream() }
    await kernel.atn.tick()
    assert.equal((await kernel.atn.network(network.networkId)).mails[mailId]!.status, 'delivered')
    assert.equal(atnMessages(worker).filter(text => text.includes(`mail=${mailId}`)).length, 1)
  })
})
