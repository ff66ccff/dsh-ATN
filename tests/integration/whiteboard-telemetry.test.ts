/** Real runtime board calls are charged without leaking their private contents. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installTelemetry } from '../../experiments/telemetry.ts'
import { bootKernel, createHostAgent, settle } from '../fixtures/kernel.ts'

test('BOARD-TELEMETRY-01: live publish/read/remove exports only counters, charges empty reads and preserves totals', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-board-telemetry-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  const telemetry = await installTelemetry(kernel.ctx, { directory: join(scratch, 'telemetry'), runId: 'board' })
  try {
    const host = await createHostAgent(kernel, 'PRIVATE_BOARD_HOST')
    const started = await kernel.atn.start(host, {
      objective: 'Account for shared evidence.', successCriteria: 'Every successful access is counted.', constraints: 'No paid model.',
    })
    const spawned = await kernel.atn.spawn(host, { task: 'Read available evidence.', context: '' })
    await settle(kernel)
    const worker = kernel.ctx.agents.get(SessionId(spawned.sessionId))!
    const before = telemetry.snapshot()
    const requestsBefore = kernel.model.requests.length
    const recordBefore = await kernel.atn.network(started.networkId)
    const empty = await kernel.atn.board(worker, { action: 'read', key: 'PRIVATE_ABSENT_KEY' })
    assert.equal(empty.action, 'read')
    if (empty.action !== 'read') throw new Error('Expected a read result')
    assert.equal(empty.returnedBytes, 2)
    assert.deepEqual(empty.entries, [])
    const publication = await kernel.atn.board(host, {
      action: 'publish', key: 'PRIVATE_BOARD_KEY', body: 'PRIVATE_BOARD_BODY: 当前版本的证据',
      topics: ['PRIVATE_BOARD_TOPIC'], expectedRevision: 0,
    })
    const read = await kernel.atn.board(worker, { action: 'read', query: 'PRIVATE_BOARD_TOPIC' })
    assert.equal(read.action, 'read')
    if (read.action !== 'read') throw new Error('Expected a read result')
    assert.equal(read.entries.length, 1)
    assert.equal(read.entries[0].body, 'PRIVATE_BOARD_BODY: 当前版本的证据')
    assert.equal(read.returnedBytes, Buffer.byteLength(JSON.stringify(read.entries), 'utf8'))
    const removed = await kernel.atn.board(host, { action: 'remove', key: 'PRIVATE_BOARD_KEY', expectedRevision: publication.snapshotRevision })
    assert.equal(removed.capacity.entries, 0)
    const emptyAgain = await kernel.atn.board(worker, { action: 'read' })
    await settle(kernel)
    const measured = telemetry.snapshot()
    const record = await kernel.atn.network(started.networkId)
    assert.deepEqual(measured.atnBoard, record.whiteboard!.usage)
    assert.deepEqual(measured.atnBoard, emptyAgain.usage)
    assert.equal(measured.atnBoard.reads, 3)
    assert.equal(measured.atnBoard.writes, 2)
    assert.equal(measured.atnBoard.readBytes, read.returnedBytes + 4)
    assert.ok(measured.atnBoard.writeBytes > 0, 'removal frees capacity without removing already transferred bytes')
    assert.equal(measured.atnMessages, before.atnMessages)
    assert.equal(measured.atnPayloadBytes, before.atnPayloadBytes)
    assert.equal(measured.atnTotalInteractions - before.atnTotalInteractions, 5)
    assert.equal(measured.atnTotalTransferBytes - before.atnTotalTransferBytes,
      measured.atnBoard.readBytes + measured.atnBoard.writeBytes)
    assert.equal(kernel.model.requests.length, requestsBefore, 'successful board operations never wake another model')
    assert.deepEqual(record.mails, recordBefore.mails)
    assert.equal(record.stepsUsed, recordBefore.stepsUsed)
    const eventsBeforeReplay = measured.events
    kernel.ctx.emit('atn/network-updated', { record, at: 1_000_001 })
    kernel.ctx.emit('atn/network-updated', { record, at: 1_000_002 })
    const replayed = telemetry.snapshot()
    assert.deepEqual(replayed.atnBoard, measured.atnBoard)
    assert.equal(replayed.atnTotalInteractions, measured.atnTotalInteractions)
    assert.equal(replayed.atnTotalTransferBytes, measured.atnTotalTransferBytes)
    assert.equal(replayed.events, eventsBeforeReplay, 'unchanged board facts are deduplicated')
    const closed = await telemetry.close()
    assert.deepEqual((await telemetry.close()).atnBoard, closed.atnBoard)
    const raw = await readFile(telemetry.paths.events, 'utf8')
    const events = raw.trim().split('\n').map(line => JSON.parse(line))
    const states = events.filter(event => event.kind === 'whiteboard.state')
    assert.equal(states.length, 5, 'each successful read/write emits a usage change, including empty reads and deletion')
    assert.equal(states.at(-1).entries, 0)
    assert.equal(states.at(-1).reads, 3)
    assert.equal(states.at(-1).writes, 2)
    for (const state of states) {
      assert.deepEqual(Object.keys(state).filter(key => !['version', 'sequence', 'at', 'kind', 'network', 'entries', 'generation',
        'reads', 'writes', 'readBytes', 'writeBytes'].includes(key)), [], 'board exports contain no user payload fields')
    }
    assert.equal(raw.includes('PRIVATE_'), false)
    assert.equal(raw.includes('当前版本的证据'), false)
    assert.equal(raw.includes(String(host.id)), false)
    assert.equal(raw.includes(spawned.sessionId), false)
  } finally {
    await telemetry.close()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
