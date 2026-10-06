/** Model-visible compaction leaves durable mail identities and peer-authored deltas intact. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { bootKernel, createHostAgent, settle } from '../fixtures/kernel.ts'
import { mailMessage, taskMessage } from '../../src/messages.ts'

test('CONTEXT-THREAD: later task mail omits repeated assignment boilerplate and preserves all new text', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-task-context-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try {
    const host = await createHostAgent(kernel, 'task-context-host')
    const started = await kernel.atn.start(host, {
      objective: 'Check bounded context.', successCriteria: 'Task context appears once.', constraints: 'Scripted fixture.',
    })
    const born = await kernel.atn.spawn(host, { task: 'Inspect one local fact.', context: 'Return the evidence.' })
    await settle(kernel)
    const worker = kernel.ctx.agents.get(SessionId(born.sessionId))!
    const record = await kernel.atn.network(started.networkId)
    const firstMail = Object.values(record.mails).find(mail => mail.taskId === born.taskId && mail.toId === born.nodeId)!
    assert.ok(firstMail.body.includes('Settle it with atn_send'))
    const delta = '\nNew evidence: amber changed to violet. Preserve this exact sentence.'
    const assignment = taskMessage(record.tasks[born.taskId], started.networkId, 1).content[0]
    assert.ok(assignment.type === 'text')
    assert.equal(firstMail.body, assignment.text)
    const standalone = mailMessage({ ...firstMail, body: firstMail.body + delta }, started.networkId, undefined, undefined, record.tasks[born.taskId], true).content[0]
    assert.ok(standalone.type === 'text' && !standalone.text.includes('Settle it with atn_send'))
    const sent = await kernel.atn.send(host, { to: born.nodeId, kind: 'note', taskId: born.taskId, body: firstMail.body + delta })
    await settle(kernel)
    const logged = worker.session.snapshotEvents().filter(event => event.type === 'user/message')
      .map(event => event.data as UserMessage).flatMap(message => message.content)
      .filter(content => content.type === 'text').map(content => content.text)
    const first = logged.find(text => text.includes(`mail=${firstMail.id} `))!
    const later = logged.find(text => text.includes(`mail=${sent.mailId} `))!
    assert.ok(first)
    assert.ok(later)
    assert.ok(Buffer.byteLength(later) < Buffer.byteLength(first) / 2, JSON.stringify({ first, later }))
    assert.ok(later.includes(`task=${born.taskId}`))
    assert.ok(later.includes(delta.trimStart()))
    assert.ok(!later.includes('Inspect one local fact.'))
    assert.ok(!later.includes('Context: Return the evidence.'))
    assert.ok(!later.includes('Settle it with atn_send'))
    assert.ok(!later.includes('completed records your submission'))
    assert.equal((await kernel.atn.network(started.networkId)).mails[sent.mailId].body, firstMail.body + delta)
    await kernel.atn.tick()
    assert.equal((await kernel.atn.network(started.networkId)).mails[sent.mailId].status, 'delivered')
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
