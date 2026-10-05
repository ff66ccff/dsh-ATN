/** Final-text recovery against actual Harness Session ordering, without an external provider. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionId } from '@deepseek-ai/dsh-session'
import { extractFinalTextSubmission, installAtnSubmissionBridge } from '../../experiments/submission.ts'
import { bootKernel, createHostAgent, drive, settle } from '../fixtures/kernel.ts'
import { testGoal } from '../fixtures/network.ts'

test('SUBMISSION-KERNEL: accept visible JSON from a completed real turn, then reject a later failed attempt', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-submission-kernel-'))
  const kernel = await bootKernel(scratch)
  try {
    const host = await createHostAgent(kernel, 'submission-entry')
    const afterSeq = host.session.snapshotEvents().at(-1)?.seq ?? -1
    kernel.model.stream = async function* () {
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: 'Draft reasoning is not the artifact.' }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Draft reasoning is not the artifact.' } }
      yield { type: 'block-start', index: 1, blockType: 'text' }
      yield { type: 'text-delta', index: 1, text: '{"answer":"visible final"}' }
      yield { type: 'block-end', index: 1, block: { type: 'text', text: '{"answer":"visible final"}' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    await drive(host, 'Respond with the final artifact.')
    const submitted = extractFinalTextSubmission(host.session.snapshotEvents(), { afterSeq })
    assert.ok(submitted.accepted)
    assert.equal(submitted.answer, '{"answer":"visible final"}')
    kernel.model.stream = async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TEST_FAILURE', message: 'Failed new attempt.' } } }
    }
    await drive(host, 'Attempt another turn.')
    assert.deepEqual(extractFinalTextSubmission(host.session.snapshotEvents(), { afterSeq }), { accepted: false, reason: 'turn-not-completed' })
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('SUBMISSION-DELIVERY: accepted failover delivery captures its artifact exactly once without another submit tool', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-submission-delivery-'))
  const kernel = await bootKernel(scratch)
  try {
    const host = await createHostAgent(kernel, 'submission-failover-entry')
    const started = await kernel.atn.start(host, testGoal)
    const child = await kernel.atn.spawn(host, { task: 'Produce the final aggregate.', context: 'Return a JSON artifact.' })
    await settle(kernel)
    const worker = kernel.ctx.agents.get(SessionId(child.sessionId))!
    const submissions: string[] = []
    installAtnSubmissionBridge(kernel.atn, input => { JSON.parse(input.summary) }, answer => { submissions.push(answer) })
    const early = await kernel.atn.deliver(host, { summary: '{"answer":"premature"}', evidence: [], goalVersion: 1 })
    assert.equal(early.accepted, false)
    assert.match(early.reason!, /open task/)
    assert.deepEqual(submissions, [], 'a refused delivery never becomes a harness submission')

    await kernel.atn.failNode(started.networkId, started.nodeId, 'Entry retired before submitting.')
    await kernel.atn.send(worker, { to: started.nodeId, kind: 'result', taskId: child.taskId,
      body: 'Aggregate complete.', summary: 'Aggregate complete.', evidence: ['fixture:aggregate'] })
    await settle(kernel)
    const obligation = (await kernel.atn.status(worker)).orphanTasks.find(task => task.kind === 'delivery')!
    await kernel.atn.claim(worker, obligation.id)
    await settle(kernel)
    assert.equal(await kernel.atn.deliveryHolder(started.networkId), child.nodeId)
    const artifact = '{"answer":"recovered final aggregate"}'
    kernel.model.enqueue(worker.id, [{ tool: 'atn_finish', args: {
      scope: 'network', summary: artifact, evidence: ['fixture:aggregate'], goalVersion: 1,
    } }])
    await drive(worker, 'Deliver the final artifact now.')
    assert.deepEqual(submissions, [artifact])
    assert.equal((await kernel.atn.network(started.networkId)).status, 'completed')
    assert.equal(await kernel.atn.deliveryHolder(started.networkId), null)
    const repeat = await kernel.atn.deliver(host, { summary: artifact, evidence: [], goalVersion: 1 })
    assert.equal(repeat.accepted, false)
    assert.deepEqual(submissions, [artifact], 'a repeated delivery cannot submit twice')
    const toolCalls = worker.session.snapshotEvents().filter(event => event.type === 'tool/call')
    assert.ok(toolCalls.length > 0)
    assert.ok(!toolCalls.some(event => JSON.stringify(event.data).includes('submit_answer')))
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
