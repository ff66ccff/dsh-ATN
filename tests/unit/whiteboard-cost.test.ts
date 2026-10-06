/** Shared-medium accounting remains cumulative across snapshot replay and retention. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { createAtnCostMeter } from '../../experiments/atn-cost.ts'
import { accessWhiteboard } from '../../src/whiteboard.ts'
import { makeChain } from '../fixtures/network.ts'

test('BOARD-COST-01: repeated and stale snapshots cannot reset or double-count cumulative usage', () => {
  const meter = createAtnCostMeter()
  const initial = makeChain(['A'])
  const emptyRead = accessWhiteboard(initial, 'A', { action: 'read' }, 1).record
  const published = accessWhiteboard(emptyRead, 'A', { action: 'publish', key: 'evidence', body: 'fact', expectedRevision: 0 }, 2).record
  const read = accessWhiteboard(published, 'A', { action: 'read' }, 3).record
  const removed = accessWhiteboard(read, 'A', { action: 'remove', key: 'evidence', expectedRevision: published.whiteboard!.generation }, 4).record
  for (const record of [initial, emptyRead, published, read, removed]) meter.observe(record)
  const final = meter.snapshot()
  assert.deepEqual(final.board, removed.whiteboard!.usage)
  assert.equal(final.board.reads, 2)
  assert.equal(final.board.writes, 2)
  assert.equal(final.totalInteractions, 4)
  assert.equal(final.totalTransferBytes, final.board.readBytes + final.board.writeBytes)
  for (const record of [removed, read, published, emptyRead, initial, removed]) {
    meter.observe(record)
    assert.deepEqual(meter.snapshot(), final, 'replayed or retained snapshots are observations, not new operations')
  }
})

test('BOARD-COST-02: independent networks add once and empty reads charge their array payload', () => {
  const meter = createAtnCostMeter()
  const first = accessWhiteboard(makeChain(['A']), 'A', { action: 'read' }, 1).record
  const second = accessWhiteboard({ ...makeChain(['A']), id: 'net-2' }, 'A', { action: 'read' }, 1).record
  meter.observe(first)
  meter.observe(second)
  meter.observe(first)
  assert.deepEqual(meter.snapshot().board, { reads: 2, writes: 0, readBytes: 4, writeBytes: 0 })
  assert.equal(meter.snapshot().messages, 0)
  assert.equal(meter.snapshot().totalInteractions, 2)
  assert.equal(meter.snapshot().totalTransferBytes, 4)
})
