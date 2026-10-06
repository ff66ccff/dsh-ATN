/** Ownership, bounded reads, optimistic writes and durable cheap-medium accounting. */
import { strict as assert } from 'node:assert'
import { Buffer } from 'node:buffer'
import test from 'node:test'
import { networkRecordSchema, type NetworkRecord } from '../../src/schema.ts'
import { accessWhiteboard, MAX_WHITEBOARD_ENTRIES, MAX_WHITEBOARD_READ_BYTES,
  MAX_WHITEBOARD_TOTAL_BYTES, type WhiteboardInput } from '../../src/whiteboard.ts'
import { makeChain } from '../fixtures/network.ts'

function publish(record: NetworkRecord, key: string, body = `Useful fact ${key}`, author = 'A', expectedRevision = 0) {
  return accessWhiteboard(record, author, { action: 'publish', key, body, topics: ['lookup'], expectedRevision }, 100)
}

test('legacy empty boards read as metered durable state without changing nodes, mail, tasks or steps', () => {
  const original = makeChain(['A', 'B'])
  assert.equal(networkRecordSchema.parse(original).whiteboard, undefined)
  const read = accessWhiteboard(original, 'B', { action: 'read' }, 100)
  assert.equal(original.whiteboard, undefined)
  assert.equal(read.result.action, 'read')
  if (read.result.action !== 'read') assert.fail('read result required')
  assert.deepEqual(read.result.entries, [])
  assert.equal(read.result.totalMatches, 0)
  assert.equal(read.result.nextCursor, null)
  assert.deepEqual(read.result.usage, { reads: 1, writes: 0, readBytes: 2, writeBytes: 0 })
  assert.equal(read.record.sequence, original.sequence)
  assert.deepEqual(read.record.nodes, original.nodes)
  assert.deepEqual(read.record.mails, original.mails)
  assert.deepEqual(read.record.tasks, original.tasks)
  assert.equal(read.record.stepsUsed, original.stepsUsed)
  assert.deepEqual(networkRecordSchema.parse(read.record).whiteboard, read.record.whiteboard)
})

test('publication persists authenticated authorship, immutable creation time and exact successful byte accounting', () => {
  const original = makeChain(['A', 'B'])
  const first = publish(original, 'evidence/slot-5', 'slot 5 value=amber')
  if (first.result.action === 'read') assert.fail('write result required')
  assert.equal(first.result.entry?.authorId, 'A')
  assert.equal(first.result.entry?.createdAt, 100)
  assert.equal(first.result.revision, original.sequence + 1)
  assert.equal(first.record.whiteboard?.usage.writes, 1)
  assert.equal(first.record.whiteboard?.usage.writeBytes, Buffer.byteLength(JSON.stringify(first.result.entry), 'utf8'))
  const second = accessWhiteboard(first.record, 'A', { action: 'publish', key: 'evidence/slot-5', body: 'slot 5 value=green',
    topics: ['lookup', ' LOOKUP ', 'new-topic'], expectedRevision: first.result.revision }, 200)
  if (second.result.action === 'read') assert.fail('write result required')
  assert.equal(second.result.entry?.createdAt, 100)
  assert.equal(second.result.entry?.updatedAt, 200)
  assert.deepEqual(second.result.entry?.topics, ['LOOKUP', 'new-topic'])
  assert.equal(second.record.whiteboard?.entries.length, 1)
  assert.equal(first.record.whiteboard?.entries[0].body, 'slot 5 value=amber', 'transforms do not mutate their inputs')
  second.result.entry!.body = 'caller modified output'
  assert.equal(second.record.whiteboard?.entries[0].body, 'slot 5 value=green')
})

test('only authors may mutate existing keys and stale revisions never replace newer or recreated entries', () => {
  const first = publish(makeChain(['A', 'B']), 'shared-key')
  if (first.result.action === 'read') assert.fail('write result required')
  const initialRevision = first.result.revision
  for (const input of [
    { action: 'publish', key: 'shared-key', expectedRevision: initialRevision, body: 'forged replacement' },
    { action: 'remove', key: 'shared-key', expectedRevision: initialRevision },
  ] satisfies WhiteboardInput[]) {
    assert.throws(() => accessWhiteboard(first.record, 'B', input, 200), { code: 'not-author' })
  }
  assert.throws(() => publish(first.record, 'shared-key'), { code: 'revision-conflict' })
  const updated = publish(first.record, 'shared-key', 'updated', 'A', initialRevision)
  assert.throws(() => publish(updated.record, 'shared-key', 'lost update', 'A', initialRevision), { code: 'revision-conflict' })
  if (updated.result.action === 'read') assert.fail('write result required')
  const removed = accessWhiteboard(updated.record, 'A', { action: 'remove', key: 'shared-key', expectedRevision: updated.result.revision }, 200)
  assert.equal(removed.record.whiteboard?.entries.length, 0)
  const recreated = publish(removed.record, 'shared-key', 'new owner', 'B')
  if (recreated.result.action === 'read') assert.fail('write result required')
  assert.ok(recreated.result.revision > updated.result.revision)
  assert.equal(recreated.result.entry?.authorId, 'B')
  assert.throws(() => publish(recreated.record, 'shared-key', 'stale old revision', 'B', initialRevision), { code: 'revision-conflict' })
  assert.equal(recreated.record.whiteboard?.usage.writes, 4)
})

test('entry-count capacity refuses additional keys but allows own replacement and deliberate removal', () => {
  let record = makeChain(['A', 'B'])
  for (let index = 0; index < MAX_WHITEBOARD_ENTRIES; index++) record = publish(record, `fact-${index}`, 'x').record
  assert.equal(record.whiteboard?.entries.length, MAX_WHITEBOARD_ENTRIES)
  assert.throws(() => publish(record, 'overflow', 'x', 'B'), { code: 'capacity-exceeded' })
  const first = record.whiteboard!.entries.find(entry => entry.key === 'fact-0')!
  record = publish(record, first.key, 'replacement', 'A', first.revision).record
  assert.equal(record.whiteboard?.entries.length, MAX_WHITEBOARD_ENTRIES)
  const revision = record.whiteboard!.entries.find(entry => entry.key === first.key)!.revision
  record = accessWhiteboard(record, 'A', { action: 'remove', key: first.key, expectedRevision: revision }, 100).record
  record = publish(record, 'new-key', 'x', 'B').record
  assert.equal(record.whiteboard?.entries.length, MAX_WHITEBOARD_ENTRIES)
  assert.ok(record.whiteboard!.entries.some(entry => entry.key === 'fact-1'), 'capacity never evicts another entry')
})

test('UTF-8 entry and global live-byte limits are enforced before committing', () => {
  const base = makeChain(['A'])
  assert.throws(() => publish(base, 'too-large', '证'.repeat(1500)), { code: 'invalid-input' })
  assert.throws(() => publish(base, 'json-escaping', '\\'.repeat(2500)), { code: 'invalid-input' })
  let record = base
  let stopped = false
  for (let index = 0; index < MAX_WHITEBOARD_ENTRIES; index++) {
    try { record = publish(record, `large-${index}`, 'x'.repeat(3800)).record }
    catch (error) {
      assert.equal((error as { code: string }).code, 'capacity-exceeded')
      stopped = true
      break
    }
  }
  assert.equal(stopped, true)
  assert.ok(record.whiteboard!.entries.length < MAX_WHITEBOARD_ENTRIES)
  assert.ok(Buffer.byteLength(JSON.stringify(record.whiteboard!.entries), 'utf8') <= MAX_WHITEBOARD_TOTAL_BYTES)
  assert.equal(record.whiteboard?.usage.writes, record.whiteboard?.entries.length)
  assert.equal(networkRecordSchema.safeParse(record).success, true)
})

test('read pagination respects item and byte bounds, preserves order and meters every successful page', () => {
  let record = makeChain(['A', 'B'])
  for (let index = 0; index < 10; index++) record = publish(record, `slot-${index}`, 'x'.repeat(3800)).record
  const seen: string[] = []
  let cursor: string | undefined
  let reads = 0
  let readBytes = 0
  do {
    const page = accessWhiteboard(record, 'B', { action: 'read', query: 'lookup', limit: 8, ...(cursor ? { cursor } : {}) }, 100)
    if (page.result.action !== 'read') assert.fail('read result required')
    assert.equal(page.result.totalMatches, 10)
    assert.ok(page.result.returnedBytes <= MAX_WHITEBOARD_READ_BYTES)
    assert.ok(page.result.entries.length <= 8)
    assert.equal(page.result.returnedBytes, Buffer.byteLength(JSON.stringify(page.result.entries), 'utf8'))
    seen.push(...page.result.entries.map(entry => entry.key))
    reads++
    readBytes += page.result.returnedBytes
    cursor = page.result.nextCursor ?? undefined
    record = page.record
  } while (cursor !== undefined)
  assert.deepEqual(seen, Array.from({ length: 10 }, (_, index) => `slot-${index}`))
  assert.ok(reads > 1)
  assert.equal(record.whiteboard?.usage.reads, reads)
  assert.equal(record.whiteboard?.usage.readBytes, readBytes)
  assert.equal(record.whiteboard?.usage.writes, 10)
})

test('search uses keys, topics and body while cursors reject writes or different filters', () => {
  let record = publish(makeChain(['A', 'B']), 'slot-5', 'private amber fact').record
  record = publish(record, 'slot-6', 'another amber fact').record
  const initial = accessWhiteboard(record, 'B', { action: 'read', query: 'amber', limit: 1 }, 100)
  if (initial.result.action !== 'read') assert.fail('read result required')
  assert.ok(initial.result.nextCursor)
  const cursor = initial.result.nextCursor
  assert.throws(() => accessWhiteboard(initial.record, 'B', { action: 'read', query: 'different', cursor }, 100), { code: 'stale-cursor' })
  const changed = publish(initial.record, 'slot-7').record
  assert.throws(() => accessWhiteboard(changed, 'B', { action: 'read', query: 'amber', cursor }, 100), { code: 'stale-cursor' })
  const exact = accessWhiteboard(initial.record, 'B', { action: 'read', key: 'slot-5' }, 100)
  if (exact.result.action !== 'read') assert.fail('read result required')
  assert.equal(exact.result.totalMatches, 1)
  assert.equal(exact.result.entries[0].body, 'private amber fact')
  assert.throws(() => accessWhiteboard(record, 'B', { action: 'read', cursor: 'malformed' }, 100), { code: 'invalid-input' })
})

test('invalid payloads, spoofed fields and unavailable callers leave state unchanged', () => {
  const record = makeChain(['A', 'B'])
  const invalid = [
    { action: 'publish', key: 'fact', body: 'fact' },
    { action: 'publish', key: 'fact', body: '  ', expectedRevision: 0 },
    { action: 'publish', key: '../bad key', body: 'fact', expectedRevision: 0 },
    { action: 'publish', key: 'fact', body: 'fact', expectedRevision: 0, authorId: 'B' },
    { action: 'publish', key: 'fact', body: 'fact', expectedRevision: 0, topics: Array(9).fill('topic') },
    { action: 'publish', key: 'fact', body: 'fact', expectedRevision: 0, topics: ['x'.repeat(81)] },
    { action: 'remove', key: 'absent', expectedRevision: 0 },
    { action: 'read', limit: 9 }, { action: 'read', body: 'unexpected write' },
  ]
  for (const input of invalid) assert.throws(() => accessWhiteboard(record, 'A', input as WhiteboardInput, 100), { code: 'invalid-input' })
  for (const changed of [
    { ...record, status: 'completed' as const }, { ...record, deadlineAt: 100 },
    { ...record, nodes: { ...record.nodes, A: { ...record.nodes.A, lifecycle: 'retired' as const } } },
    { ...record, nodes: { ...record.nodes, A: { ...record.nodes.A, creationState: 'pending' as const } } },
  ]) assert.throws(() => accessWhiteboard(changed, 'A', { action: 'read' }, 100), { code: 'unavailable' })
  assert.throws(() => accessWhiteboard(record, 'missing', { action: 'read' }, 100), { code: 'unavailable' })
  assert.equal(record.whiteboard, undefined)
})

test('durable boundary rejects duplicate keys, invalid generations and oversized payloads', () => {
  const record = publish(makeChain(['A']), 'fact').record
  const board = record.whiteboard!
  assert.equal(networkRecordSchema.safeParse({ ...record, whiteboard: { ...board, entries: [...board.entries, ...board.entries] } }).success, false)
  assert.equal(networkRecordSchema.safeParse({ ...record, whiteboard: { ...board, generation: 0 } }).success, false)
  assert.equal(networkRecordSchema.safeParse({ ...record, whiteboard: { ...board, entries: [{ ...board.entries[0], body: '证'.repeat(1500) }] } }).success, false)
})
