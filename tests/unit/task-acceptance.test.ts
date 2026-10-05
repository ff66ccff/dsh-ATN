/** Host acceptance, immutable task dependencies and retry provenance. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { taskRecordSchema, type NetworkRecord, type TaskRecord } from '../../src/schema.ts'
import {
  acceptedTasks, assertTaskReferences, createExactJsonValidator, createTask, isTaskAccepted,
  settleTask, TaskAcceptanceError, TaskReferenceError, taskResultDigest, validateTaskResult,
  type TaskResultInput, type TaskValidator,
} from '../../src/tasks.ts'
import { makeChain } from '../fixtures/network.ts'

function submitted(summary = '{"answer":42}', id = 'upstream', source = makeChain(['A', 'B', 'C'])) {
  const created = createTask(source, { id, holderId: 'B', requesterId: 'A', description: 'Return the answer as JSON', context: '', now: 1 })
  return settleTask(created.record, id, 'B', { summary, evidence: ['artifact:answer'] }, 3)
}

function accepted(source = submitted()) {
  return validateTaskResult(source.record, source.task.id, createExactJsonValidator('answer-contract-v1', { [source.task.id]: { answer: 42 } }), 4)
}

function dependent(record: NetworkRecord, dependsOn: string[], id = 'downstream') {
  return createTask(record, { id, holderId: 'C', requesterId: 'A', description: 'Use verified facts', context: '', dependsOn, now: 5 })
}

test('legacy completed tasks load as unverified; submission and self-reported passed do not grant acceptance', () => {
  const { acceptance: _acceptance, dependsOn: _dependsOn, retryOf: _retryOf, ...legacy } = submitted('{"passed":true}').task
  const task = taskRecordSchema.parse(legacy)
  assert.equal(task.status, 'completed')
  assert.equal(task.acceptance, undefined)
  assert.equal(isTaskAccepted(task), false)
  const { record } = submitted('{"passed":true}')
  assert.deepEqual(acceptedTasks(record), [])
  assert.deepEqual(dependent(record, ['upstream']).record.tasks.downstream?.dependsOn, ['upstream'])
})

test('holder result cannot smuggle an acceptance verdict through extra fields', () => {
  const created = createTask(makeChain(['A', 'B']), { holderId: 'B', requesterId: 'A', description: 'task', context: '', now: 1 })
  const forged = { summary: 'done', evidence: [], acceptance: { status: 'passed' }, passed: true } as TaskResultInput
  const settled = settleTask(created.record, created.taskId, 'B', forged, 2)
  assert.equal(settled.task.acceptance, null)
  assert.deepEqual(settled.task.result, { summary: 'done', evidence: [] })
  assert.equal(isTaskAccepted(settled.task), false)
})

test('host exact JSON acceptance records an immutable bound verdict and permits downstream facts', () => {
  const source = submitted()
  const verified = accepted(source)
  assert.equal(verified.task.acceptance?.status, 'passed')
  assert.equal(verified.task.acceptance?.resultDigest, taskResultDigest(source.task))
  assert.equal(isTaskAccepted(verified.task), true)
  assert.equal(source.task.acceptance, null, 'pure validation never mutates its input')
  const next = dependent(verified.record, ['upstream'])
  assert.deepEqual(next.record.tasks['downstream']?.dependsOn, ['upstream'])
  assert.deepEqual(acceptedTasks(next.record).map((task) => task.id), ['upstream'])
})

test('JSON oracle ignores object key order but rejects extra fields, wrong types, array order and invalid JSON', () => {
  const validator = createExactJsonValidator('json-v1', { upstream: { answer: 42, entries: [1, 2] } })
  const cases = [
    ['{"entries":[1,2],"answer":42}', true],
    ['{"entries":[1,2],"answer":"42"}', false],
    ['{"entries":[1,2],"answer":42,"passed":true}', false],
    ['{"entries":[2,1],"answer":42}', false],
    ['The answer is 42', false],
  ] as const
  for (const [summary, passed] of cases) {
    const source = submitted(summary)
    const result = validateTaskResult(source.record, source.task.id, validator, 4)
    assert.equal(isTaskAccepted(result.task), passed, summary)
    assert.equal(result.task.acceptance?.status, passed ? 'passed' : 'failed')
  }
})

test('oracle snapshots expected JSON and has no effect on tasks without a host contract', () => {
  const expected = { upstream: { answer: 42 } }
  const validator = createExactJsonValidator('json-v1', expected)
  expected.upstream.answer = 0
  const source = submitted()
  assert.equal(isTaskAccepted(validateTaskResult(source.record, 'upstream', validator, 4).task), true)
  const other = submitted('{"answer":42}', 'other')
  assert.equal(validateTaskResult(other.record, 'other', validator, 4).record, other.record)
  assert.equal(other.task.acceptance, null)
  assert.throws(() => createExactJsonValidator('json-v1', { upstream: { bad: undefined } }))
})

test('host validator gets a deeply frozen snapshot and exceptions cannot settle acceptance', () => {
  const source = submitted()
  const validator: TaskValidator = {
    id: 'mutation-test-v1',
    validate(task) {
      assert.notEqual(task, source.task)
      assert.equal(Object.isFrozen(task), true)
      assert.equal(Object.isFrozen(task.result?.evidence), true)
      task.result!.evidence.push('forged')
      return { passed: true, summary: 'unreachable', evidence: ['check:1'] }
    },
  }
  assert.throws(() => validateTaskResult(source.record, 'upstream', validator, 4), TypeError)
  assert.equal(source.task.acceptance, null)
  assert.deepEqual(source.task.result?.evidence, ['artifact:answer'])
})

test('acceptance requires independent evidence, a real boolean and a valid host timestamp', () => {
  const source = submitted()
  const emptyEvidence: TaskValidator = { id: 'test-v1', validate: () => ({ passed: true, summary: 'unchecked', evidence: [] }) }
  assert.throws(() => validateTaskResult(source.record, 'upstream', emptyEvidence, 4))
  const blankEvidence: TaskValidator = { id: 'test-v1', validate: () => ({ passed: true, summary: 'unchecked', evidence: ['   '] }) }
  assert.throws(() => validateTaskResult(source.record, 'upstream', blankEvidence, 4))
  const truthy = { id: 'test-v1', validate: () => ({ passed: 'true', summary: 'wrong type', evidence: ['check:1'] }) } as unknown as TaskValidator
  assert.throws(() => validateTaskResult(source.record, 'upstream', truthy, 4), (error: unknown) => error instanceof TaskAcceptanceError && error.code === 'invalid-verdict')
  const verifier = createExactJsonValidator('json-v1', { upstream: { answer: 42 } })
  assert.throws(() => validateTaskResult(source.record, 'upstream', verifier, 2), (error: unknown) => error instanceof TaskAcceptanceError && error.code === 'invalid-time')
  assert.equal(source.task.acceptance, null)
})

test('open, self-reported failed and missing tasks cannot acquire acceptance', () => {
  const created = createTask(makeChain(['A', 'B']), { id: 'upstream', holderId: 'B', requesterId: 'A', description: 'task', context: '', now: 1 })
  const validator = createExactJsonValidator('json-v1', { upstream: { answer: 42 } })
  const noSubmission = (error: unknown) => error instanceof TaskAcceptanceError && error.code === 'not-submitted'
  assert.throws(() => validateTaskResult(created.record, 'upstream', validator, 3), noSubmission)
  const failed = settleTask(created.record, 'upstream', 'B', { summary: '{"answer":42}', evidence: [] }, 2, true)
  assert.throws(() => validateTaskResult(failed.record, 'upstream', validator, 3), noSubmission)
  assert.throws(() => validateTaskResult(created.record, 'missing', validator, 3), (error: unknown) => error instanceof TaskAcceptanceError && error.code === 'unknown-task')
})

test('verified verdict cannot be overwritten even after a downstream task exists', () => {
  const verified = accepted()
  const downstream = dependent(verified.record, ['upstream'])
  const reject = createExactJsonValidator('different-v2', { upstream: { answer: 0 } })
  assert.throws(() => validateTaskResult(downstream.record, 'upstream', reject, 6), (error: unknown) => error instanceof TaskAcceptanceError && error.code === 'already-validated')
  assert.equal(isTaskAccepted(downstream.record.tasks['upstream']!), true)
})

test('changed result or task contract invalidates a stale copied acceptance verdict', () => {
  const verified = accepted()
  for (const task of [
    { ...verified.task, result: { ...verified.task.result!, summary: '{"answer":0}' } },
    { ...verified.task, description: 'Different contract' },
    { ...verified.task, dependsOn: ['new-fact'] },
  ]) {
    assert.equal(isTaskAccepted(task), false)
    const tampered = { ...verified.record, tasks: { ...verified.record.tasks, upstream: task } }
    assert.throws(() => dependent(tampered, ['upstream']), (error: unknown) => error instanceof TaskReferenceError && error.code === 'unaccepted-dependency')
  }
})

test('dependencies reject unknown/future/self references, duplicates and bounds; accepted ids cannot be replaced', () => {
  const verified = accepted()
  assert.throws(() => dependent(verified.record, ['downstream']), (error: unknown) => error instanceof TaskReferenceError && error.code === 'unknown-dependency')
  assert.throws(() => dependent(verified.record, ['upstream', 'upstream']), (error: unknown) => error instanceof TaskReferenceError && error.code === 'duplicate-dependency')
  assert.throws(() => dependent(verified.record, Array.from({ length: 17 }, (_, n) => String(n))), (error: unknown) => error instanceof TaskReferenceError && error.code === 'too-many-dependencies')
  assert.throws(() => dependent(verified.record, [], 'upstream'), (error: unknown) => error instanceof TaskReferenceError && error.code === 'duplicate-id')
})

test('host-rejected attempts can be retried without altering history; retries remain unverified until checked', () => {
  const rejected = accepted(submitted('{"answer":0}'))
  assert.equal(rejected.task.acceptance?.status, 'failed')
  assert.throws(() => dependent(rejected.record, ['upstream']), (error: unknown) => error instanceof TaskReferenceError && error.code === 'unaccepted-dependency')
  const retry = createTask(rejected.record, { id: 'retry', holderId: 'C', requesterId: 'A', description: 'Try again', context: '', retryOf: 'upstream', now: 5 })
  assert.equal(retry.record.tasks['retry']?.retryOf, 'upstream')
  assert.equal(retry.record.tasks['upstream'], rejected.task)
  const resubmitted = settleTask(retry.record, 'retry', 'C', { summary: '{"answer":42}', evidence: ['artifact:retry'] }, 6)
  assert.equal(isTaskAccepted(resubmitted.task), false)
  const passed = validateTaskResult(resubmitted.record, 'retry', createExactJsonValidator('answer-contract-v1', { retry: { answer: 42 } }), 7)
  assert.equal(isTaskAccepted(passed.task), true)
  assert.equal(passed.record.tasks['upstream']?.acceptance?.status, 'failed')
})

test('retries preserve upstream dependencies and cannot be hijacked by another requester', () => {
  const verified = accepted()
  const child = dependent(verified.record, ['upstream'])
  const failed = settleTask(child.record, 'downstream', 'C', { summary: 'could not finish', evidence: [] }, 6, true)
  assert.deepEqual(assertTaskReferences(failed.record, { retryOf: 'downstream', requesterId: 'A' }), { dependsOn: ['upstream'], retryOf: 'downstream' })
  assert.throws(() => assertTaskReferences(failed.record, { retryOf: 'downstream', dependsOn: [], requesterId: 'A' }), (error: unknown) => error instanceof TaskReferenceError && error.code === 'retry-dependencies')
  assert.throws(() => assertTaskReferences(failed.record, { retryOf: 'downstream', requesterId: 'B' }), (error: unknown) => error instanceof TaskReferenceError && error.code === 'retry-requester')
  assert.throws(() => assertTaskReferences(failed.record, { retryOf: 'missing' }), (error: unknown) => error instanceof TaskReferenceError && error.code === 'unknown-retry')
})

test('successful or merely submitted attempts are not failures eligible for retry', () => {
  for (const source of [submitted(), accepted()]) {
    assert.throws(() => assertTaskReferences(source.record, { retryOf: 'upstream', requesterId: 'A' }), (error: unknown) => error instanceof TaskReferenceError && error.code === 'invalid-retry')
  }
})

test('host metrics preserve incomplete coverage and only attach after verification', () => {
  const source = submitted()
  const metrics = { comparisonKey: 'same-workload-and-budget-v1', cost: null, costUnit: 'USD', informationKeys: ['fact:answer'] }
  const verdict = validateTaskResult(source.record, 'upstream', {
    id: 'measured-json-v1',
    validate(task) {
      return { passed: task.result?.summary === '{"answer":42}', summary: 'Checked answer against fixture.', evidence: ['fixture:answer-v1'], metrics }
    },
  }, 4)
  assert.deepEqual(verdict.task.acceptance?.metrics, metrics)
  metrics.informationKeys.push('late-mutation')
  assert.deepEqual(verdict.task.acceptance?.metrics?.informationKeys, ['fact:answer'])
  assert.equal(verdict.task.acceptance?.metrics?.cost, null)
  assert.equal(source.task.acceptance, null)
})

test('unreachable failure remains retryable and a nonmember requester is rejected', () => {
  const source = submitted()
  const unreachable: TaskRecord = { ...source.task, status: 'unreachable', result: null }
  const record = { ...source.record, tasks: { upstream: unreachable } }
  assert.equal(assertTaskReferences(record, { retryOf: 'upstream', requesterId: 'A' }).retryOf, 'upstream')
  assert.throws(() => createTask(record, { holderId: 'B', requesterId: 'ghost', description: 'task', context: '', now: 5 }), /requester ghost/)
})
