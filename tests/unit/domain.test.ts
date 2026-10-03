/**
 * Durable-state behaviour that does not depend on a live kernel: bounded
 * accounting and the "no success is published before the write commits" rule.
 * @module dsh-atn/tests/unit/domain
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { currentGoal, LimitExceededError, MemoryNetworkStore, NetworkStoreError, pendingMailFor, usageOf } from '../../src/domain.ts'
import { limitsFromConfig, assertConfigRelations } from '../../src/config.ts'
import { makeChain, makeNode, makeTask, testConfig } from '../fixtures/network.ts'

test('STATE-02: a rejected durable write leaves the stored record unchanged', async () => {
  const store = new MemoryNetworkStore()
  const original = makeChain(['A'])
  await store.create(original)

  store.failNextUpdate = new Error('disk full')

  await assert.rejects(
    () => store.update('net-1', (current) => ({ ...current, status: 'completed' })),
    /disk full/,
  )

  const stored = await store.load('net-1')
  assert.equal(stored?.status, 'open', 'the record still holds the old value after a failed write')
  assert.equal(store.writes, 1, 'the failed update must not count as a committed write')
})

test('STATE-02: a rejected create leaves no network record behind', async () => {
  const store = new MemoryNetworkStore()
  store.failNextCreate = new Error('medium unavailable')
  await assert.rejects(() => store.create(makeChain(['A'])), /medium unavailable/)
  assert.deepEqual(await store.list(), [])
})

test('STATE-01: an unknown network is missing rather than silently created', async () => {
  const store = new MemoryNetworkStore()
  assert.equal(await store.load('nope'), undefined)
  await assert.rejects(
    () => store.update('nope', (current) => current),
    (error: unknown) => error instanceof NetworkStoreError && error.code === 'missing',
  )
})

test('STATE-01: a second create for one id is refused instead of overwriting', async () => {
  const store = new MemoryNetworkStore()
  await store.create(makeChain(['A']))
  await assert.rejects(
    () => store.create(makeChain(['A'])),
    (error: unknown) => error instanceof NetworkStoreError && error.code === 'exists',
  )
})

test('LIMIT-01: draining nodes still consume a resident slot while release does not reset the cumulative count', () => {
  const network = makeChain(['A', 'B'])
  network.nodes['B'] = { ...network.nodes['B']!, lifecycle: 'draining' }
  const usage = usageOf(network)
  assert.equal(usage.residentNodes, 2, 'a draining node still holds capacity')
  assert.equal(usage.totalNodes, 2)

  network.nodes['B'] = { ...network.nodes['B']!, lifecycle: 'retired' }
  const released = usageOf(network)
  assert.equal(released.residentNodes, 1, 'retirement releases the slot')
  assert.equal(released.totalNodes, 2, 'the cumulative count is not reset by releasing a slot')
})

test('LIMIT-02: pending outbound mail is counted per sender, and undelivered mail keeps counting', () => {
  const network = makeChain(['A', 'B'])
  network.mails['m1'] = {
    id: 'm1',
    fromId: 'A',
    toId: 'B',
    kind: 'note',
    taskId: null,
    proposalId: null,
    body: 'first',
    status: 'queued',
    enqueuedAt: 0,
    settledAt: null,
    note: null,
  }
  assert.equal(pendingMailFor(network, 'A'), 1)
  network.mails['m1'] = { ...network.mails['m1']!, status: 'delivered', settledAt: 1 }
  assert.equal(pendingMailFor(network, 'A'), 0)
})

test('currentGoal returns the newest committed revision', () => {
  const network = makeChain(['A'])
  const extended = {
    ...network,
    goalHistory: [
      ...network.goalHistory,
      { version: 2, document: { objective: 'x', successCriteria: 'y', constraints: 'z' }, proposedBy: 'B', approvedBy: ['C'], committedAt: 5 },
    ],
  }
  assert.equal(currentGoal(extended).version, 2)
})

test('configuration relations are rejected at load rather than at the first write', () => {
  const base = testConfig()
  assert.throws(() => assertConfigRelations({ ...base, maxTotalNodes: base.maxResidentNodes - 1 }), /maxTotalNodes/)
  assert.throws(() => assertConfigRelations({ ...base, proposalDeadlineMs: base.networkDeadlineMs + 1 }), /proposalDeadlineMs/)
  assert.throws(() => assertConfigRelations({ ...base, maxLeaseExtensionMs: base.defaultLeaseMs - 1 }), /maxLeaseExtensionMs/)
  assert.doesNotThrow(() => assertConfigRelations(base))
})

test('bounds come from configuration instead of constants', () => {
  const limits = limitsFromConfig(testConfig({ maxResidentNodes: 3, stepBudget: 17 }))
  assert.equal(limits.maxResidentNodes, 3)
  assert.equal(limits.stepBudget, 17)
})

test('a limit breach names the bound it hit', () => {
  const network = makeChain(['A'])
  const tight = { ...network, limits: { ...network.limits, maxTasks: 1 }, tasks: { 'task-1': makeTask('task-1') } }
  const error = new LimitExceededError('maxTasks', `network ${tight.id} already recorded 1 tasks`)
  assert.equal(error.bound, 'maxTasks')
})

test('a node record keeps its declared lifecycle and creation state', () => {
  const node = makeNode('N1', { lifecycle: 'draining', creationState: 'published' })
  assert.equal(node.lifecycle, 'draining')
  assert.equal(node.creationState, 'published')
})
