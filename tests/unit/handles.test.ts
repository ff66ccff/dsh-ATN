import { strict as assert } from 'node:assert'
import test from 'node:test'
import { HandleReleaser } from '../../src/handles.ts'

test('release identity is session-scoped and outcomes are network-filterable', async () => {
  const releases = new HandleReleaser(100)
  let calls = 0
  releases.begin('node-3', 'session-A', async () => { calls++ })
  releases.begin('node-3', 'session-B', async () => { calls++ })
  const result = await releases.settle(new Set(['session-B']))
  assert.equal(calls, 2)
  assert.deepEqual(result.map(r => [r.sessionId, r.status]), [['session-B', 'released']])
})

test('timeout retains a single disposal and acknowledges its late success', async () => {
  const releases = new HandleReleaser(10)
  let finish!: () => void
  let calls = 0
  const first = releases.begin('node-3', 'session-A', () => { calls++; return new Promise<void>(r => { finish = r }) })
  const snapshot = await releases.settle()
  assert.equal(snapshot[0]!.status, 'timed-out')
  assert.equal(releases.begin('node-3', 'session-A', async () => { calls++ }), releases.recordFor('session-A'))
  assert.equal(calls, 1)
  finish()
  await first.settled
  assert.equal(releases.isReleased('session-A'), true)
  assert.equal(snapshot[0]!.status, 'timed-out', 'returned reports remain snapshots')
})

test('late disposal failure is retained without a second dispose call', async () => {
  const releases = new HandleReleaser(10)
  let fail!: (e: Error) => void
  const first = releases.begin('node-3', 'session-A', () => new Promise<void>((_, reject) => { fail = reject }))
  await releases.settle()
  fail(new Error('late failure'))
  await first.settled
  assert.equal(releases.outcomes()[0]!.status, 'failed')
  assert.match(releases.outcomes()[0]!.reason!, /late failure/)
  releases.begin('node-3', 'session-A', async () => assert.fail('must not reenter dispose'))
})
