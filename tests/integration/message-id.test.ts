/**
 * MAIL-IDEMPOTENCY: a caller-supplied stable message id makes a retry of the
 * same business message safe, and refuses an id reused for different content.
 * @module dsh-atn/tests/integration/message-id
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
  objective: 'Make retries idempotent.',
  successCriteria: 'One business message never creates two rows or two settlements.',
  constraints: 'Deterministic clock only.',
}

interface Bench {
  kernel: Kernel
  scratch: string
  host: Agent
  networkId: string
  entryNodeId: string
}

async function bench(): Promise<Bench> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-mailid-'))
  const kernel = await bootKernel(scratch, { store: new MemoryNetworkStore(), clock: () => 1_000_000, cleanupTimeoutMs: 50 })
  const created = await createHostAgent(kernel, 'session-host')
  kernel.model.enqueue('session-host', [{ tool: 'atn_start', args: goal }])
  await drive(created, 'start')
  await settle(kernel)
  const networkId = (await kernel.ctx.atn.networkIds())[0]!
  const record = await kernel.ctx.atn.network(networkId)
  return { kernel, scratch, host: kernel.ctx.agents.get(SessionId('session-host'))!, networkId, entryNodeId: record.entryNodeId }
}

test('MESSAGE-ID-01: retrying a task with the same id creates one mail and one task', async () => {
  const b = await bench()
  try {
    const child = await b.kernel.ctx.atn.spawn(b.host, { task: 'Child work.', context: '' })
    const before = await b.kernel.ctx.atn.network(b.networkId)
    const mailBefore = Object.keys(before.mails).length
    const taskBefore = Object.keys(before.tasks).length

    const request = { to: child.nodeId, kind: 'task' as const, body: 'Retried assignment.', messageId: 'msg-stable-1' }
    const first = await b.kernel.ctx.atn.send(b.host, request)
    const second = await b.kernel.ctx.atn.send(b.host, request)
    assert.equal(first.duplicate, false)
    assert.equal(second.duplicate, true, 'the retry is reported as a duplicate')
    assert.equal(second.mailId, first.mailId, 'the retry answers with the existing mail')

    const after = await b.kernel.ctx.atn.network(b.networkId)
    assert.equal(Object.keys(after.mails).length, mailBefore + 1, 'exactly one mail row was added')
    assert.equal(Object.keys(after.tasks).length, taskBefore + 1, 'exactly one task was added')
    assert.equal(after.mails[first.mailId]!.body, 'Retried assignment.')
    assert.equal(second.settledTaskId, first.settledTaskId, 'both calls name the same task')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('MESSAGE-ID-02: retrying a result settles the task once and reports the duplicate', async () => {
  const b = await bench()
  try {
    const child = await b.kernel.ctx.atn.spawn(b.host, { task: 'Child work.', context: '' })
    const childAgent = b.kernel.ctx.agents.get(SessionId(child.sessionId))!
    const record = await b.kernel.ctx.atn.network(b.networkId)
    const task = Object.values(record.tasks).find((entry) => entry.holderId === child.nodeId && entry.status === 'open')!
    const mailBefore = Object.keys(record.mails).length

    const request = {
      to: b.entryNodeId,
      kind: 'result' as const,
      taskId: task.id,
      body: 'done',
      summary: 'child finished',
      evidence: ['evidence-1'],
      messageId: 'msg-result-1',
    }
    const first = await b.kernel.ctx.atn.send(childAgent, request)
    assert.equal(first.duplicate, false)
    assert.equal(first.settledTaskId, task.id)
    const settledAt = (await b.kernel.ctx.atn.network(b.networkId)).tasks[task.id]!.settledAt

    const second = await b.kernel.ctx.atn.send(childAgent, request)
    assert.equal(second.duplicate, true, 'the retried result is a duplicate')
    assert.equal(second.mailId, first.mailId)

    const after = await b.kernel.ctx.atn.network(b.networkId)
    assert.equal(after.tasks[task.id]!.status, 'completed')
    assert.equal(after.tasks[task.id]!.settledAt, settledAt, 'the settlement time was not rewritten')
    assert.deepEqual(after.tasks[task.id]!.result!.evidence, ['evidence-1'])
    assert.equal(Object.keys(after.mails).length, mailBefore + 1, 'the retry created no second mail')

    // A rejected retry must not disturb the recorded settlement either.
    await assert.rejects(
      () => b.kernel.ctx.atn.send(childAgent, { ...request, summary: 'a different claim' }),
      (error: unknown) => /stable id cannot be reused|cannot be reused/i.test(String((error as Error).message)),
    )
    const unchanged = await b.kernel.ctx.atn.network(b.networkId)
    assert.equal(unchanged.tasks[task.id]!.settledAt, settledAt)
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('MESSAGE-ID-03: reusing an id for different content, sender or target is refused', async () => {
  const b = await bench()
  try {
    const first = await b.kernel.ctx.atn.spawn(b.host, { task: 'First child.', context: '' })
    const second = await b.kernel.ctx.atn.spawn(b.host, { task: 'Second child.', context: '' })
    const base = { to: first.nodeId, kind: 'note' as const, body: 'the one true message', messageId: 'msg-stable-2' }
    await b.kernel.ctx.atn.send(b.host, base)

    const reused = async (overrides: Record<string, unknown>): Promise<void> => {
      await assert.rejects(
        () => b.kernel.ctx.atn.send(b.host, { ...base, ...overrides } as typeof base),
        (error: unknown) => /cannot be reused/i.test(String((error as Error).message)),
      )
    }
    await reused({ body: 'a different body' })
    await reused({ to: second.nodeId })
    await reused({ kind: 'task' })

    // The first message and every record around it are untouched.
    const record = await b.kernel.ctx.atn.network(b.networkId)
    const mail = record.mails['msg-stable-2']!
    assert.equal(mail.body, 'the one true message')
    assert.equal(mail.toId, first.nodeId)
    assert.equal(mail.kind, 'note')
    assert.equal(Object.keys(record.mails).filter((id) => id === 'msg-stable-2').length, 1)
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('MESSAGE-ID-04: a note retry keeps the sender, target and first settlement time', async () => {
  const b = await bench()
  try {
    const child = await b.kernel.ctx.atn.spawn(b.host, { task: 'Child work.', context: '' })
    const request = { to: child.nodeId, kind: 'note' as const, body: 'stable note', messageId: 'msg-stable-3' }
    const first = await b.kernel.ctx.atn.send(b.host, request)
    const firstRecord = await b.kernel.ctx.atn.network(b.networkId)
    const enqueuedAt = firstRecord.mails[first.mailId]!.enqueuedAt
    const second = await b.kernel.ctx.atn.send(b.host, request)
    assert.equal(second.duplicate, true)
    const after = await b.kernel.ctx.atn.network(b.networkId)
    const mail = after.mails[first.mailId]!
    assert.equal(mail.fromId, b.entryNodeId, 'the sender is still the real caller')
    assert.equal(mail.toId, child.nodeId)
    assert.equal(mail.enqueuedAt, enqueuedAt, 'the first enqueue time is preserved')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})
