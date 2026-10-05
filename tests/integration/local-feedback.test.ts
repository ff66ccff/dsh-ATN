/** Deferred local topology feedback through the real agent input and session log. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { atnMessages, bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import type { SpawnResult } from '../../src/runtime.ts'

const goal = {
  objective: 'Keep useful local collaborators after peers leave.',
  successCriteria: 'The next ordinary input carries coalesced, durable local feedback.',
  constraints: 'Scripted model only; topology changes must not wake idle agents.',
}

async function withKernel(run: (kernel: Kernel) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-feedback-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try { await run(kernel) }
  finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

async function spawn(kernel: Kernel, creator: Agent, task: string): Promise<SpawnResult & { agent: Agent }> {
  const born = await kernel.atn.spawn(creator, { task, context: '' })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(born.sessionId))
  assert.ok(agent)
  return { ...born, agent }
}

function feedback(agent: Agent): string[] {
  return atnMessages(agent).filter(text => text.startsWith('[ATN local changes]'))
}

/** Advance real admission counters without additional scripted model requests. */
async function expireFeedbackWindow(kernel: Kernel, agent: Agent): Promise<void> {
  const networkId = kernel.atn.networkForSession(agent.id)!
  for (let step = 0; step < 3; step++) assert.equal(await kernel.atn.admitStep(networkId, agent.id), true)
}

async function settleInitialTask(kernel: Kernel, networkId: string, worker: SpawnResult & { agent: Agent }): Promise<void> {
  const record = await kernel.atn.network(networkId)
  const task = Object.values(record.tasks).find(row => row.holderId === worker.nodeId)!
  await kernel.atn.send(worker.agent, {
    to: task.requesterId, kind: 'result', taskId: task.id,
    body: 'Initial assignment complete.', summary: 'Initial assignment complete.',
  })
  await settle(kernel)
}

test('LOCAL-FEEDBACK-01: departures and replacements coalesce without idle requests or mail', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'feedback-host')
    const started = await kernel.atn.start(host, goal)
    const first = await spawn(kernel, host, 'First temporary collaborator.')
    const second = await spawn(kernel, host, 'Second temporary collaborator.')
    const nextFirst = await spawn(kernel, host, 'First replacement.')
    const nextSecond = await spawn(kernel, host, 'Second replacement.')
    await kernel.atn.rewire(first.agent, { peers: [nextFirst.nodeId] })
    await kernel.atn.rewire(second.agent, { peers: [nextSecond.nodeId] })
    await kernel.atn.rewire(host, { peers: [first.nodeId, second.nodeId] })
    await settleInitialTask(kernel, started.networkId, first)
    await settleInitialTask(kernel, started.networkId, second)
    await expireFeedbackWindow(kernel, host)
    await drive(host, 'Continue with the current collaborators.')
    await settle(kernel)
    const beforeNotices = feedback(host).length
    assert.ok(beforeNotices > 0, 'a logged baseline exists before either peer leaves')
    const beforeRequests = kernel.model.requests.length
    const beforeMail = Object.keys((await kernel.atn.network(started.networkId)).mails)

    await kernel.atn.finish(first.agent, 'First collaborator finished.')
    await kernel.atn.finish(second.agent, 'Second collaborator finished.')
    await kernel.atn.tick()
    await settle(kernel)
    assert.equal(host.status, 'idle')
    assert.equal(kernel.model.requests.length, beforeRequests, 'local changes never start a model request')
    assert.deepEqual(Object.keys((await kernel.atn.network(started.networkId)).mails), beforeMail, 'feedback creates no standalone mail')
    assert.equal(feedback(host).length, beforeNotices, 'changes wait for ordinary input')

    await expireFeedbackWindow(kernel, host)
    await drive(host, 'Continue after the collaborators finished.')
    await settle(kernel)
    const notices = feedback(host).slice(beforeNotices)
    assert.equal(notices.length, 1, 'one input receives one combined notice')
    for (const id of [first.nodeId, second.nodeId, nextFirst.nodeId, nextSecond.nodeId]) assert.ok(notices[0]!.includes(id))
    assert.match(notices[0]!, /Removed:/)
    assert.match(notices[0]!, /retired/)
    assert.match(notices[0]!, /Added:/)
    assert.match(notices[0]!, /Current neighbours:/)
    assert.equal(kernel.model.requests.length, beforeRequests + 1, 'feedback does not prolong the completed turn')

    await drive(host, 'Continue once more without topology changes.')
    await settle(kernel)
    assert.equal(feedback(host).length, beforeNotices + 1, 'an unchanged graph is not announced twice')
  })
})

for (const interrupted of ['rejected', 'cancelled'] as const) {
  test(`LOCAL-FEEDBACK-02-${interrupted}: a ${interrupted} input does not consume the logged cursor`, async () => {
    await withKernel(async kernel => {
      const host = await createHostAgent(kernel, `feedback-${interrupted}`)
      await kernel.atn.start(host, goal)
      const worker = await spawn(kernel, host, 'Available collaborator.')
      await kernel.atn.rewire(host, { peers: [worker.nodeId] })
      await expireFeedbackWindow(kernel, host)
      await drive(host, 'Observe the current collaborator.')
      await settle(kernel)
      const beforeNotices = feedback(host).length
      assert.ok(beforeNotices > 0)
      await kernel.atn.rewire(host, { peers: [] })
      await expireFeedbackWindow(kernel, host)
      const beforeRequests = kernel.model.requests.length
      let intercepted = false
      const release = interrupted === 'rejected'
        ? kernel.ctx.on('agent/pre-step', async (payload, next) => {
          const decision = await next()
          if (payload.agent !== host || intercepted) return decision
          intercepted = true
          return { kind: 'reject' }
        })
        : kernel.ctx.on('agent/request', async (payload, next) => {
          const config = await next()
          if (payload.agent === host && !intercepted) {
            intercepted = true
            host.cancel({ kind: 'user' })
            payload.signal.throwIfAborted()
          }
          return config
        })
      try { await drive(host, 'This input is interrupted before it is logged.') }
      finally { release() }
      await settle(kernel)
      assert.equal(intercepted, true)
      assert.equal(kernel.model.requests.length, beforeRequests)
      assert.equal(feedback(host).length, beforeNotices, 'unaccepted feedback is absent from the session log')

      await drive(host, 'Retry with an ordinary accepted input.')
      await settle(kernel)
      const notices = feedback(host).slice(beforeNotices)
      assert.equal(notices.length, 1)
      assert.match(notices[0]!, /Removed:/)
      assert.ok(notices[0]!.includes(worker.nodeId), 'the deferred change survives interruption')
      await drive(host, 'No further local change.')
      assert.equal(feedback(host).length, beforeNotices + 1)
    })
  })
}

test('LOCAL-FEEDBACK-03: cold recovery preserves an unread change and its previous session baseline', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-feedback-recover-'))
  let kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try {
    const host = await createHostAgent(kernel, 'feedback-recovery-host')
    const started = await kernel.atn.start(host, goal)
    const observer = await spawn(kernel, host, 'Long-lived collaborator.')
    const departing = await spawn(kernel, host, 'Temporary collaborator.')
    const replacement = await spawn(kernel, host, 'Replacement collaborator.')
    await kernel.atn.rewire(departing.agent, { peers: [replacement.nodeId] })
    await kernel.atn.rewire(observer.agent, { peers: [departing.nodeId] })
    await settleInitialTask(kernel, started.networkId, departing)
    await expireFeedbackWindow(kernel, observer.agent)
    await drive(observer.agent, 'Observe the temporary collaborator.')
    await settle(kernel)
    const beforeNotices = feedback(observer.agent).length
    assert.ok(beforeNotices > 0)
    await kernel.atn.finish(departing.agent, 'Finished before shutdown.')
    await kernel.atn.tick()
    await settle(kernel)
    assert.equal(feedback(observer.agent).length, beforeNotices, 'unread change has not entered the old session')

    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
    const report = await kernel.atn.recover()
    assert.equal(report.find(row => row.nodeId === observer.nodeId)?.action, 'resume')
    await settle(kernel)
    const resumed = kernel.ctx.agents.get(SessionId(observer.sessionId))
    assert.ok(resumed)
    await expireFeedbackWindow(kernel, resumed)
    await drive(resumed, 'Continue after recovery.')
    await settle(kernel)
    const notices = feedback(resumed).slice(beforeNotices)
    assert.equal(notices.length, 1)
    assert.match(notices[0]!, /Removed:/)
    assert.ok(notices[0]!.includes(departing.nodeId))
    assert.match(notices[0]!, /Added:/)
    assert.ok(notices[0]!.includes(replacement.nodeId))
    assert.doesNotMatch(notices[0]!, /Initial neighbours:/, 'recovery uses the durable baseline instead of resetting it')

    await kernel.atn.recover()
    await drive(resumed, 'Continue again with the recovered graph.')
    await settle(kernel)
    assert.equal(feedback(resumed).length, beforeNotices + 1)
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('LOCAL-FEEDBACK-04: peer steps stay queryable without injecting snapshots; retirement is material', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'intrinsic-feedback-host')
    const started = await kernel.atn.start(host, goal)
    const worker = await spawn(kernel, host, 'Observe local work without host acceptance.')
    await kernel.atn.rewire(host, { peers: [worker.nodeId] })
    await expireFeedbackWindow(kernel, host)
    await drive(host, 'Observe the current work and collaborator.')
    await settle(kernel)
    const beforeNotices = feedback(host).length
    const beforeRequests = kernel.model.requests.length
    const beforeMail = Object.keys((await kernel.atn.network(started.networkId)).mails)
    const before = await kernel.atn.network(started.networkId)
    const workerBefore = before.nodes[worker.nodeId].stepsUsed!
    const baseline = before.rewireHistory!.at(-1)!.observations!.before

    assert.equal(await kernel.atn.admitStep(started.networkId, worker.sessionId), true)
    await settle(kernel)
    assert.equal(kernel.model.requests.length, beforeRequests, 'recording telemetry cannot start a model request')
    assert.equal(feedback(host).length, beforeNotices)
    const after = await kernel.atn.network(started.networkId)
    assert.deepEqual(Object.keys(after.mails), beforeMail)
    assert.deepEqual(after.rewireHistory!.at(-1)!.observations!.before, baseline)
    assert.equal(after.rewireHistory!.at(-1)!.observations!.after.peers[0].stepsUsed, workerBefore + 1,
      'the same atomic step mutation refreshes the rewire observations without a verifier')

    await drive(host, 'Continue with the latest local observations.')
    await settle(kernel)
    const notices = feedback(host).slice(beforeNotices)
    assert.equal(notices.length, 0, 'peer admission must not replay feedback')
    const status = await kernel.atn.status(host, {})
    const peer = status.nodes.find(node => node.id === worker.nodeId)!
    assert.equal(peer.telemetry.stepsUsed, workerBefore + 1)
    assert.equal(peer.telemetry.stepsRemaining, after.limits.stepBudget - workerBefore - 1)
    assert.doesNotMatch(feedback(host).join('\n'), /steps=|remaining=/)
    assert.equal(kernel.model.requests.length, beforeRequests + 1)
    await drive(host, 'Continue with no further peer work.')
    await settle(kernel)
    assert.equal(feedback(host).length, beforeNotices, 'own step consumption must not replay peer telemetry')
    await settleInitialTask(kernel, started.networkId, worker)
    await kernel.atn.finish(worker.agent, 'Work finished.')
    await kernel.atn.tick()
    await expireFeedbackWindow(kernel, host)
    const beforeRetirement = feedback(host).length
    await drive(host, 'Inspect the retired collaborator.')
    await settle(kernel)
    const retirement = feedback(host).slice(beforeRetirement)
    assert.equal(retirement.length, 1)
    assert.match(retirement[0]!, /retired/)
  })
})
