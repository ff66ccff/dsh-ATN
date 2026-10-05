/**
 * Mailbox behaviour: durable enqueue before delivery, per-sender ordering,
 * back pressure, and replay of the queued-minus-confirmed set.
 * @module dsh-atn/tests/unit/mailbox
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { enqueueMail, inboxOf, mailBytes, markDelivered, markUndeliverable, pendingMails } from '../../src/mailbox.ts'
import { LimitExceededError } from '../../src/domain.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'

test('MAIL-01: a mail exists durably before any delivery is attempted', () => {
  const network = makeChain(['A', 'B'])
  const { record, mailId } = enqueueMail(network, {
    fromId: 'A',
    toId: 'B',
    kind: 'task',
    taskId: 'task-1',
    proposalId: null,
    body: 'do the thing',
    now: 10,
  })
  const mail = record.mails[mailId]!
  assert.equal(mail.status, 'queued')
  assert.equal(mail.settledAt, null)
  assert.equal(pendingMails(record).length, 1, 'the queued mail survives with no delivery step')
})

test('MAIL-02: confirming delivery moves the row once and does not duplicate it', () => {
  const network = makeChain(['A', 'B'])
  const first = enqueueMail(network, { fromId: 'A', toId: 'B', kind: 'note', taskId: null, proposalId: null, body: 'hi', now: 1 })
  const delivered = markDelivered(first.record, first.mailId, 2)
  const again = markDelivered(delivered, first.mailId, 3)
  assert.equal(Object.keys(again.mails).length, 1, 'the target history keeps exactly one row')
  assert.equal(again.mails[first.mailId]!.status, 'delivered')
  assert.equal(again.mails[first.mailId]!.settledAt, 2, 'a repeated confirmation does not rewrite the first one')
})

test('MAIL-03: concurrent sends keep a deterministic enqueue order and per-sender back pressure', () => {
  const network = makeChain(['A', 'B'])
  const tight = { ...network, limits: { ...network.limits, maxPendingMailPerNode: 2 } }
  let record = tight
  const ids: string[] = []
  for (const body of ['first', 'second']) {
    const result = enqueueMail(record, { fromId: 'A', toId: 'B', kind: 'note', taskId: null, proposalId: null, body, now: ids.length })
    record = result.record
    ids.push(result.mailId)
  }
  assert.deepEqual(inboxOf(record, 'B').map((mail) => mail.body), ['first', 'second'])

  assert.throws(
    () => enqueueMail(record, { fromId: 'A', toId: 'B', kind: 'note', taskId: null, proposalId: null, body: 'third', now: 3 }),
    (error: unknown) => error instanceof LimitExceededError && error.bound === 'maxPendingMailPerNode',
  )
  assert.equal(Object.keys(record.mails).length, 2, 'a refused send does not swallow an accepted one')
})

test('MAIL-03: a message above the byte bound is refused with the envelope counted', () => {
  const network = makeChain(['A', 'B'])
  const tiny = { ...network, limits: { ...network.limits, maxMessageBytes: 16 } }
  assert.throws(
    () => enqueueMail(tiny, { fromId: 'A', toId: 'B', kind: 'note', taskId: null, proposalId: null, body: 'x'.repeat(64), now: 0 }),
    (error: unknown) => error instanceof LimitExceededError && error.bound === 'maxMessageBytes',
  )
})

test('MAIL-03: a repeated stable id is deduplicated instead of inserted twice', () => {
  const network = makeChain(['A', 'B'])
  const first = enqueueMail(network, { fromId: 'A', toId: 'B', kind: 'note', taskId: null, proposalId: null, body: 'hi', now: 0, id: 'mail-fixed' })
  const second = enqueueMail(first.record, { fromId: 'A', toId: 'B', kind: 'note', taskId: null, proposalId: null, body: 'hi', now: 1, id: 'mail-fixed' })
  assert.equal(second.duplicate, true)
  assert.equal(Object.keys(second.record.mails).length, 1)
})

test('MAIL-04: queued, delivered and task completion are three separate facts', () => {
  const network = makeChain(['A', 'B'])
  const enqueued = enqueueMail(network, { fromId: 'A', toId: 'B', kind: 'task', taskId: 'task-1', proposalId: null, body: 'work', now: 0 })
  // Queueing the request tells us nothing about task state.
  assert.equal(enqueued.record.tasks['task-1'], undefined)
  const delivered = markDelivered(enqueued.record, enqueued.mailId, 1)
  assert.equal(delivered.tasks['task-1'], undefined, 'delivery is not completion')
})

test('MAIL-06: a permanently undeliverable mail is recorded rather than left queued forever', () => {
  const network = makeChain(['A', 'B'])
  const enqueued = enqueueMail(network, { fromId: 'A', toId: 'B', kind: 'result', taskId: 'task-1', proposalId: null, body: 'done', now: 0 })
  const settled = markUndeliverable(enqueued.record, enqueued.mailId, 'recipient is retired', 5)
  const mail = settled.mails[enqueued.mailId]!
  assert.equal(mail.status, 'undeliverable')
  assert.equal(mail.fromId, 'A', 'the real producer is preserved')
  assert.equal(mail.toId, 'B', 'the original recipient is preserved')
  assert.equal(pendingMails(settled).length, 0, 'the row no longer blocks settlement')
})

test('MAIL-01: replay after a restart sees exactly the queued-minus-confirmed set', () => {
  const network = makeChain(['A', 'B', 'C'])
  const one = enqueueMail(network, { fromId: 'A', toId: 'B', kind: 'note', taskId: null, proposalId: null, body: 'one', now: 0 })
  const two = enqueueMail(one.record, { fromId: 'B', toId: 'C', kind: 'note', taskId: null, proposalId: null, body: 'two', now: 1 })
  const replayed = markDelivered(two.record, one.mailId, 2)
  assert.deepEqual(pendingMails(replayed).map((mail) => mail.body), ['two'])
})


test('MAIL-ID: automatic ids skip caller-reserved future counter values', () => {
  const input = { fromId: 'A', toId: 'B', kind: 'note' as const, taskId: null, proposalId: null, body: 'reserved', now: 0 }
  const first = enqueueMail(makeChain(['A', 'B']), { ...input, id: 'mail-3' })
  const second = enqueueMail(first.record, { ...input, body: 'automatic' })
  assert.notEqual(second.mailId, first.mailId)
  assert.equal(second.record.mails[first.mailId]!.body, 'reserved')
  assert.equal(Object.keys(second.record.mails).length, 2)
})

test('MAIL-RESERVE: accepted tasks can each return one result after ordinary retention and pending limits fill', () => {
  const base = makeChain(['A', 'B'])
  const tasks = Object.fromEntries(['task-one', 'task-two'].map(id => [id, makeTask(id, {
    holderId: 'B', requesterId: 'A', status: 'completed', settledBy: 'B', settledAt: 1,
    result: { summary: 'Done.', evidence: ['proof.txt'] },
  })]))
  let record = { ...base, tasks, limits: { ...base.limits, maxRetainedMail: 1, maxPendingMailPerNode: 1, maxTasks: 2 } }
  const ordinary = { fromId: 'B', toId: 'A', kind: 'note' as const, taskId: null, proposalId: null, body: 'queued context', now: 0 }
  record = enqueueMail(record, ordinary).record
  for (const taskId of Object.keys(tasks)) {
    const result = { ...ordinary, kind: 'result' as const, taskId, body: 'done', id: `result-${taskId}` }
    const accepted = enqueueMail(record, result)
    record = accepted.record
    assert.equal(enqueueMail(record, result).duplicate, true, 'stable retries also work at the bound')
    assert.throws(() => enqueueMail(record, { ...result, id: `forged-${taskId}` }), LimitExceededError, 'a second result cannot claim another reserved slot')
    assert.throws(() => enqueueMail(record, ordinary), LimitExceededError, 'new ordinary mail cannot consume the completion reserve')
  }
  assert.equal(Object.keys(record.mails).length, record.limits.maxRetainedMail + record.limits.maxTasks)
  assert.equal(pendingMails(record).length, 3, 'all three can remain pending without blocking accepted settlements')
})

test('MAIL-RESERVE: unrelated senders cannot consume result capacity and structured evidence stays byte bounded', () => {
  const base = makeChain(['A', 'B'])
  const task = makeTask('task-proof', { holderId: 'B', requesterId: 'A', status: 'completed', settledBy: 'B', result: { summary: 'Done.', evidence: ['proof'] } })
  let record = { ...base, tasks: { [task.id]: task }, limits: { ...base.limits, maxRetainedMail: 1, maxPendingMailPerNode: 1 } }
  const envelope = { fromId: 'A', toId: 'B', kind: 'note' as const, taskId: null, proposalId: null, body: 'context', now: 0 }
  record = markDelivered(enqueueMail(record, { ...envelope, id: 'context' }).record, 'context', 1)
  assert.throws(() => enqueueMail(record, { ...envelope, kind: 'result', taskId: task.id }), LimitExceededError)
  const oversized = { ...record, tasks: { [task.id]: { ...task, result: { summary: 'Done.', evidence: ['x'.repeat(base.limits.maxMessageBytes)] } } } }
  assert.throws(
    () => enqueueMail(oversized, { ...envelope, fromId: 'B', toId: 'A', kind: 'result', taskId: task.id, body: 'done' }),
    (error: unknown) => error instanceof LimitExceededError && error.bound === 'maxMessageBytes',
  )
})

test('MAIL-BYTES: caller and generated ids count toward the exact byte bound without breaking old retries', () => {
  const base = makeChain(['A', 'B'])
  const input = { fromId: 'A', toId: 'B', kind: 'note' as const, taskId: null, proposalId: null, body: 'ok', now: 0, id: '消息-🧪' }
  const exactBytes = mailBytes(input)
  const exact = enqueueMail({ ...base, limits: { ...base.limits, maxMessageBytes: exactBytes } }, input)
  assert.equal(exact.mailId, input.id)
  assert.throws(
    () => enqueueMail({ ...base, limits: { ...base.limits, maxMessageBytes: exactBytes - 1 } }, input),
    (error: unknown) => error instanceof LimitExceededError && error.bound === 'maxMessageBytes',
  )
  assert.throws(() => enqueueMail(base, { ...input, id: 'x'.repeat(base.limits.maxMessageBytes * 4) }), LimitExceededError)
  const { id: _id, ...automatic } = input
  const generatedBytes = mailBytes({ ...automatic, id: `mail-${base.sequence + 1}` })
  assert.throws(() => enqueueMail({ ...base, limits: { ...base.limits, maxMessageBytes: generatedBytes - 1 } }, automatic), LimitExceededError)
  assert.equal(enqueueMail({ ...exact.record, limits: { ...exact.record.limits, maxMessageBytes: 1 } }, input).duplicate, true, 'a previously accepted id remains retryable after a tighter bound')
})

test('MAIL-ID: new ids cannot collide through line breaks, while identical historical envelopes remain retryable', () => {
  const base = makeChain(['A', 'B'])
  const input = { fromId: 'A', toId: 'B', kind: 'note' as const, taskId: null, proposalId: null, body: 'legacy message', now: 0 }
  for (const id of ['same\none', 'same\ntwo', 'same\rone', 'same\r\none']) {
    assert.throws(() => enqueueMail(base, { ...input, id }), /single line/)
  }
  const legacyId = 'previously-accepted\nlegacy'
  const { now: _now, ...envelope } = input
  const legacy = { ...base, mails: { [legacyId]: { ...envelope, id: legacyId, status: 'queued' as const, enqueuedAt: 0, settledAt: null, note: null } } }
  assert.equal(enqueueMail(legacy, { ...input, id: legacyId }).duplicate, true)
  assert.throws(() => enqueueMail(legacy, { ...input, id: legacyId, body: 'different business message' }), /cannot be reused/)
})
