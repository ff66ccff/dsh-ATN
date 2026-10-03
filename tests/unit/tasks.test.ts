/**
 * Local tasks: stable identifiers, holder-only settlement, single settlement,
 * and the separation between "idle" and "finished".
 * @module dsh-atn/tests/unit/tasks
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { createTask, markTaskUnreachable, openTasks, openTasksOf, settleTask, TaskSettlementError } from '../../src/tasks.ts'
import { LimitExceededError } from '../../src/domain.ts'
import { makeChain } from '../fixtures/network.ts'

test('TASK-01: a task records its holder, requester and a stable id', () => {
  const network = makeChain(['A', 'B'])
  const { record, taskId } = createTask(network, {
    holderId: 'B',
    requesterId: 'A',
    description: 'Do the thing',
    context: 'because',
    now: 7,
  })
  const task = record.tasks[taskId]!
  assert.equal(task.holderId, 'B')
  assert.equal(task.requesterId, 'A')
  assert.equal(task.status, 'open')
  assert.equal(task.id, taskId)
})

test('TASK-01: a non-holder cannot settle a task', () => {
  const network = makeChain(['A', 'B'])
  const created = createTask(network, { holderId: 'B', requesterId: 'A', description: 'x', context: '', now: 0 })
  assert.throws(
    () => settleTask(created.record, created.taskId, 'A', { summary: 'sneaky', evidence: [] }, 1),
    (error: unknown) => error instanceof TaskSettlementError && error.code === 'not-holder',
  )
})

test('TASK-01: a repeated result does not settle the task twice', () => {
  const network = makeChain(['A', 'B'])
  const created = createTask(network, { holderId: 'B', requesterId: 'A', description: 'x', context: '', now: 0 })
  const first = settleTask(created.record, created.taskId, 'B', { summary: 'done', evidence: ['session:1'] }, 1)
  assert.equal(first.task.status, 'completed')
  assert.equal(first.task.settledAt, 1)

  assert.throws(
    () => settleTask(first.record, created.taskId, 'B', { summary: 'again', evidence: [] }, 2),
    (error: unknown) => error instanceof TaskSettlementError && error.code === 'already-settled',
  )
  assert.equal(first.record.tasks[created.taskId]!.result!.summary, 'done', 'the first result stands')
})

test('TASK-02: an idle network with an open task is not complete', () => {
  const network = makeChain(['A', 'B'])
  const created = createTask(network, { holderId: 'B', requesterId: 'A', description: 'x', context: '', now: 0 })
  // Every agent may be idle; the task is still open and blocks settlement.
  assert.equal(openTasks(created.record).length, 1)
  assert.equal(openTasksOf(created.record, 'B').length, 1)
})

test('TASK-03: a result survives its requester retiring, and the delivery is recorded separately', () => {
  const network = makeChain(['A', 'B'])
  const created = createTask(network, { holderId: 'B', requesterId: 'A', description: 'x', context: '', now: 0 })
  // The requester retires while B still holds the task.
  const requesterRetired = {
    ...created.record,
    nodes: { ...created.record.nodes, A: { ...created.record.nodes['A']!, lifecycle: 'retired' as const } },
  }
  const settled = settleTask(requesterRetired, created.taskId, 'B', { summary: 'done', evidence: ['artifact:1'] }, 5)
  assert.equal(settled.task.status, 'completed', 'the independent descendant is not blocked by the retired requester')
  assert.equal(settled.task.result!.summary, 'done')
  assert.deepEqual(settled.task.result!.evidence, ['artifact:1'])
  assert.equal(settled.task.requesterId, 'A', 'the task origin is not rewritten')
  assert.equal(settled.record.nodes['A']!.lifecycle, 'retired', 'the requester is not revived')

  // Only the *delivery* to the retired requester is marked undeliverable; see the mailbox tests.
  const unreachable = markTaskUnreachable(settled.record, created.taskId, 'requester A is retired', 6)
  assert.equal(unreachable.tasks[created.taskId]!.status, 'completed', 'a delivered result is not downgraded')
})

test('LIMIT-02: the cumulative task bound rejects further tasks explicitly', () => {
  const network = makeChain(['A', 'B'])
  const tight = { ...network, limits: { ...network.limits, maxTasks: 1 } }
  const created = createTask(tight, { holderId: 'B', requesterId: 'A', description: 'x', context: '', now: 0 })
  assert.throws(
    () => createTask(created.record, { holderId: 'B', requesterId: 'A', description: 'y', context: '', now: 1 }),
    (error: unknown) => error instanceof LimitExceededError && error.bound === 'maxTasks',
  )
})

test('a task cannot be created for a node outside the network', () => {
  const network = makeChain(['A'])
  assert.throws(() => createTask(network, { holderId: 'ghost', requesterId: 'A', description: 'x', context: '', now: 0 }), /ghost/)
})

test('TASK-01: a failed settlement is recorded as failed, not as a success', () => {
  const network = makeChain(['A', 'B'])
  const created = createTask(network, { holderId: 'B', requesterId: 'A', description: 'x', context: '', now: 0 })
  const failed = settleTask(created.record, created.taskId, 'B', { summary: 'could not reach the service', evidence: [] }, 3, true)
  assert.equal(failed.task.status, 'failed')
})
