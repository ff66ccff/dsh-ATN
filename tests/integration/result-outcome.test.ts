/** Explicit result outcomes survive model tools, retries and mailbox recovery. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MemoryNetworkStore } from '../../src/domain.ts'
import type { SendInput } from '../../src/runtime.ts'
import { atnMessages, bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'

const goal = {
  objective: 'Use failed results as actionable feedback.',
  successCriteria: 'The requester receives the declared outcome exactly once.',
  constraints: 'Scripted model only.',
}

async function fixture(run: (kernel: Kernel) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-result-outcome-'))
  const kernel = await bootKernel(scratch, { store: new MemoryNetworkStore(), clock: () => 1_000_000 })
  try {
    await run(kernel)
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

async function workerFixture(kernel: Kernel) {
  const host = await createHostAgent(kernel, 'host')
  const started = await kernel.atn.start(host, goal)
  const child = await kernel.atn.spawn(host, { task: 'Investigate the failing build.', context: '' })
  await settle(kernel)
  const worker = kernel.ctx.agents.get(SessionId(child.sessionId))!
  return { host, worker, started, child }
}

test('RESULT-OUTCOME-01: a model can settle failed work and inform its disconnected requester', async () => {
  await fixture(async kernel => {
    const { host, worker, started, child } = await workerFixture(kernel)
    assert.ok(atnMessages(worker).some(text => text.includes('outcome=completed|failed')))
    await kernel.atn.rewire(worker, { peers: [] })
    kernel.model.enqueue(child.sessionId, [{
      tool: 'atn_send',
      args: {
        to: started.nodeId,
        kind: 'result',
        taskId: child.taskId,
        outcome: 'failed',
        body: 'Build could not finish because a dependency is unavailable.',
        summary: 'Dependency unavailable.',
        evidence: ['build.log'],
        messageId: 'model-failed-result',
      },
    }])
    await drive(worker, 'Report the failed attempt.')
    await settle(kernel)
    const record = await kernel.atn.network(started.networkId)
    assert.equal(record.tasks[child.taskId]!.status, 'failed')
    assert.deepEqual(record.tasks[child.taskId]!.result, { summary: 'Dependency unavailable.', evidence: ['build.log'] })
    assert.equal(record.tasks[child.taskId]!.settledBy, child.nodeId)
    assert.equal(record.nodes[child.nodeId]!.lifecycle, 'active', 'a failed task does not retire its holder')
    const discovered = await kernel.atn.peers(host)
    assert.deepEqual(discovered.nodes.find(node => node.id === child.nodeId)!.recentResults, ['[failed] Dependency unavailable.'])
    const received = atnMessages(host).filter(text => text.includes('mail=model-failed-result'))
    assert.equal(received.length, 1)
    assert.match(received[0]!, /\nOutcome: failed\n/)
    assert.match(received[0]!, /dependency is unavailable/)
    assert.match(received[0]!, /Summary: Dependency unavailable\./)
    assert.match(received[0]!, /Evidence:\n- build\.log/)
  })
})

test('RESULT-OUTCOME-02: omitted outcome keeps completed behavior and matches an explicit completed retry', async () => {
  await fixture(async kernel => {
    const { host, worker, started, child } = await workerFixture(kernel)
    const input: SendInput = {
      to: started.nodeId, kind: 'result', taskId: child.taskId,
      body: 'The text mentions failure; legacy callers still default to completed.',
      summary: 'Legacy report.', evidence: [], messageId: 'legacy-result',
    }
    const first = await kernel.atn.send(worker, input)
    const second = await kernel.atn.send(worker, { ...input, outcome: 'completed' })
    await settle(kernel)
    assert.equal(first.outcome, 'completed')
    assert.equal(second.outcome, 'completed')
    assert.equal(second.duplicate, true)
    assert.equal(second.mailId, first.mailId)
    assert.equal((await kernel.atn.network(started.networkId)).tasks[child.taskId]!.status, 'completed')
    const received = atnMessages(host).filter(text => text.includes('mail=legacy-result'))
    assert.equal(received.length, 1)
    assert.match(received[0]!, /\nOutcome: completed\n/)
  })
})

test('RESULT-OUTCOME-03: failed retries preserve their claim and refuse an outcome change under the same id', async () => {
  await fixture(async kernel => {
    const { worker, started, child } = await workerFixture(kernel)
    const input: SendInput = {
      to: started.nodeId, kind: 'result', taskId: child.taskId, outcome: 'failed',
      body: 'Attempt failed.', summary: 'Missing dependency.', evidence: ['build.log'], messageId: 'failed-retry',
    }
    const first = await kernel.atn.send(worker, input)
    const before = await kernel.atn.network(started.networkId)
    const second = await kernel.atn.send(worker, input)
    assert.equal(first.outcome, 'failed')
    assert.equal(second.outcome, 'failed')
    assert.equal(second.duplicate, true)
    assert.equal(second.mailId, first.mailId)
    for (const outcome of ['completed', undefined] as const) {
      await assert.rejects(kernel.atn.send(worker, { ...input, outcome }), /stable id cannot be reused/)
    }
    const after = await kernel.atn.network(started.networkId)
    assert.deepEqual(after.tasks[child.taskId], before.tasks[child.taskId])
    assert.deepEqual(Object.keys(after.mails), Object.keys(before.mails))
  })
})

test('RESULT-OUTCOME-04: invalid outcomes and outcomes on non-result mail are rejected before writing', async () => {
  await fixture(async kernel => {
    const { worker, started, child } = await workerFixture(kernel)
    const before = await kernel.atn.network(started.networkId)
    const input = { to: started.nodeId, body: 'Invalid outcome.', taskId: child.taskId, summary: 'Invalid.' }
    for (const extra of [
      { kind: 'result', outcome: 'unknown' },
      { kind: 'note', outcome: 'failed' },
      { kind: 'task', outcome: 'completed' },
    ]) {
      await assert.rejects(kernel.atn.send(worker, { ...input, ...extra } as SendInput), /outcome must be completed or failed/)
    }
    const after = await kernel.atn.network(started.networkId)
    assert.deepEqual(after.tasks, before.tasks)
    assert.deepEqual(after.mails, before.mails)
  })
})

test('RESULT-OUTCOME-05: a queued failed result replays with its outcome after full runtime recovery', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-result-recovery-'))
  const store = new MemoryNetworkStore()
  let kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  try {
    const { worker: requester, started, child: requesterNode } = await workerFixture(kernel)
    const child = await kernel.atn.spawn(requester, { task: 'Attempt nested work.', context: '' })
    await settle(kernel)
    const worker = kernel.ctx.agents.get(SessionId(child.sessionId))!
    const runtime = kernel.atn as unknown as { handles: Map<string, AgentHandle> }
    await runtime.handles.get(requesterNode.sessionId)!.dispose()
    runtime.handles.delete(requesterNode.sessionId)
    const input: SendInput = {
      to: requesterNode.nodeId, kind: 'result', taskId: child.taskId, outcome: 'failed',
      body: 'Nested attempt failed.', summary: 'Missing input.', evidence: ['attempt.log'], messageId: 'durable-failed-result',
    }
    const sent = await kernel.atn.send(worker, input)
    assert.equal(sent.delivery, 'queued')
    assert.equal(sent.outcome, 'failed')
    assert.equal((await kernel.atn.network(started.networkId)).tasks[child.taskId]!.status, 'failed')
    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
    await kernel.atn.recover()
    await settle(kernel)
    const resumedRequester = kernel.ctx.agents.get(SessionId(requesterNode.sessionId))!
    const resumedWorker = kernel.ctx.agents.get(SessionId(child.sessionId))!
    const retry = await kernel.atn.send(resumedWorker, input)
    assert.equal(retry.duplicate, true)
    assert.equal(retry.delivery, 'delivered')
    assert.equal(retry.outcome, 'failed')
    const received = atnMessages(resumedRequester).filter(text => text.includes('mail=durable-failed-result'))
    assert.equal(received.length, 1)
    assert.match(received[0]!, /\nOutcome: failed\n/)
    assert.match(received[0]!, /Nested attempt failed/)
    assert.match(received[0]!, /Summary: Missing input\./)
    assert.match(received[0]!, /Evidence:\n- attempt\.log/)
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
