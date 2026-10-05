/** Acceptance remains separate from retry delivery and mechanical completion. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootKernel, createHostAgent, settle, type Kernel } from '../fixtures/kernel.ts'
import { testGoal } from '../fixtures/network.ts'
import { createExactJsonValidator, isTaskAccepted } from '../../src/tasks.ts'

async function fixture(run: (kernel: Kernel) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-acceptance-boundaries-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try { await run(kernel) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

test('VERIFIED-BOUNDARY-01: stable result/task retries retain host verdicts and inherited dependencies; oversize assignment commits no task', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'acceptance-boundary-host')
    const started = await kernel.atn.start(host, testGoal)
    const submission = {
      to: started.nodeId, kind: 'result' as const, taskId: started.taskId,
      body: 'Answer.', summary: '42', evidence: ['fixture:answer'], messageId: 'root-answer',
    }
    await kernel.atn.send(host, submission)
    await settle(kernel)
    const verified = await kernel.atn.verifyTask(started.networkId, started.taskId, createExactJsonValidator('numeric-v1', { [started.taskId]: 42 }))
    const repeatedResult = await kernel.atn.send(host, submission)
    assert.equal(repeatedResult.duplicate, true)
    assert.deepEqual((await kernel.atn.network(started.networkId)).tasks[started.taskId], verified)

    const work = await kernel.atn.send(host, {
      to: started.nodeId, kind: 'task', body: 'Compute downstream.', dependsOn: [started.taskId], messageId: 'downstream',
    })
    const workId = work.settledTaskId!
    await kernel.atn.send(host, {
      to: started.nodeId, kind: 'result', taskId: workId, body: 'Failed.', summary: 'No output.', outcome: 'failed',
    })
    const retryInput = { to: started.nodeId, kind: 'task' as const, body: 'Retry downstream.', retryOf: workId, messageId: 'retry-downstream' }
    const retry = await kernel.atn.send(host, retryInput)
    const repeatedTask = await kernel.atn.send(host, retryInput)
    assert.equal(repeatedTask.duplicate, true)
    assert.equal(repeatedTask.settledTaskId, retry.settledTaskId)
    const before = await kernel.atn.network(started.networkId)
    assert.deepEqual(before.tasks[retry.settledTaskId!]!.dependsOn, [started.taskId])
    await assert.rejects(kernel.atn.send(host, {
      to: started.nodeId, kind: 'task', body: 'x'.repeat(before.limits.maxMessageBytes), dependsOn: [started.taskId],
    }), /byte bound/)
    const after = await kernel.atn.network(started.networkId)
    assert.deepEqual(after.tasks, before.tasks)
    assert.equal(after.sequence, before.sequence)
  })
})

test('VERIFIED-BOUNDARY-02: mechanical completion remains unverified until host acceptance and task snapshots cannot mutate storage', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'acceptance-terminal-host')
    const started = await kernel.atn.start(host, testGoal)
    await settle(kernel)
    const delivered = await kernel.atn.deliver(host, { summary: '42', evidence: ['fixture:answer'], goalVersion: 1 })
    assert.equal(delivered.accepted, true)
    const completed = await kernel.atn.network(started.networkId)
    assert.equal(completed.status, 'completed')
    assert.equal(isTaskAccepted(completed.tasks[started.taskId]!), false)
    const verified = await kernel.atn.verifyTask(started.networkId, started.taskId, createExactJsonValidator('numeric-v1', { [started.taskId]: 42 }))
    assert.equal(isTaskAccepted(verified), true)
    const snapshot = await kernel.atn.tasks(host, [started.taskId])
    snapshot[0]!.result!.summary = 'forged'
    snapshot[0]!.acceptance!.status = 'failed'
    const stored = (await kernel.atn.network(started.networkId)).tasks[started.taskId]!
    assert.equal(stored.result?.summary, '42')
    assert.equal(isTaskAccepted(stored), true)
  })
})
