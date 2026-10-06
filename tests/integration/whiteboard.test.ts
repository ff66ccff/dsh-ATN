/** The shared medium uses the runtime writer queue, never another node's inbox. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'

const goal = { objective: 'Share bounded evidence without waking peers.',
  successCriteria: 'Durable author-bound publications and metered reads.', constraints: 'Scripted local execution.' }

async function withKernel(run: (kernel: Kernel) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-board-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try { await run(kernel) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

async function worker(kernel: Kernel, host: Agent): Promise<Agent> {
  const born = await kernel.atn.spawn(host, { task: 'Publish local evidence when available.', context: '' })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(born.sessionId))
  assert.ok(agent)
  return agent
}

function toolErrors(agent: Agent): boolean[] {
  return (agent.session.snapshotEvents() as readonly { type: string; data?: unknown }[])
    .filter(event => event.type === 'tool/result')
    .map(event => (event.data as { message: { isError?: boolean } }).message.isError === true)
}

test('BOARD-01: real tool publication derives author identity and refuses foreign mutation or outsider access', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'board-tool-host')
    const started = await kernel.atn.start(host, goal)
    const peer = await worker(kernel, host)
    kernel.model.enqueue(String(peer.id), [{ tool: 'atn_board', args: {
      action: 'publish', key: 'slot-5', body: 'amber', topics: ['lookup'], expectedRevision: 0,
    } }])
    await drive(peer, 'Publish your evidence on the shared board.')
    await settle(kernel)
    assert.equal(toolErrors(peer).at(-1), false)
    const record = await kernel.atn.network(started.networkId)
    const entry = record.whiteboard!.entries[0]
    assert.equal(record.nodes[entry.authorId].sessionId, String(peer.id))
    assert.notEqual(entry.authorId, started.nodeId)
    kernel.model.enqueue(String(host.id), [{ tool: 'atn_board', args: {
      action: 'publish', key: 'slot-5', body: 'forged update', expectedRevision: entry.revision,
    } }])
    await drive(host, 'Try to modify evidence you do not own.')
    await settle(kernel)
    assert.equal(toolErrors(host).at(-1), true)
    const outsider = await createHostAgent(kernel, 'board-outsider')
    kernel.model.enqueue(String(outsider.id), [{ tool: 'atn_board', args: { action: 'read' } }])
    await drive(outsider, 'Try to read a board outside your network.')
    await settle(kernel)
    assert.equal(toolErrors(outsider).at(-1), true)
    assert.deepEqual((await kernel.atn.network(started.networkId)).whiteboard, record.whiteboard)
  })
})

test('BOARD-02: publishing, reading and removing create no mail, driver calls or peer steps', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'board-no-wakeup')
    const started = await kernel.atn.start(host, goal)
    const peer = await worker(kernel, host)
    const before = await kernel.atn.network(started.networkId)
    const calls = kernel.model.requests.length
    const published = await kernel.atn.board(peer, { action: 'publish', key: 'slot-5', body: 'amber', expectedRevision: 0 })
    if (published.action === 'read') assert.fail('publication result required')
    const read = await kernel.atn.board(host, { action: 'read', query: 'slot-5' })
    if (read.action !== 'read') assert.fail('read result required')
    assert.equal(read.entries[0].body, 'amber')
    await kernel.atn.board(peer, { action: 'remove', key: 'slot-5', expectedRevision: published.revision })
    await settle(kernel)
    const after = await kernel.atn.network(started.networkId)
    assert.equal(kernel.model.requests.length, calls)
    assert.equal(after.stepsUsed, before.stepsUsed)
    assert.deepEqual(after.nodes, before.nodes)
    assert.deepEqual(after.mails, before.mails)
    assert.deepEqual(after.tasks, before.tasks)
    assert.equal(after.whiteboard?.usage.reads, 1)
    assert.equal(after.whiteboard?.usage.writes, 2)
    assert.ok(after.whiteboard!.usage.readBytes > 0)
    assert.ok(after.whiteboard!.usage.writeBytes > 0)
    assert.deepEqual(after.whiteboard?.entries, [])
  })
})

test('BOARD-03: concurrent compare-and-swap writes cannot lose updates or successful read accounting', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'board-concurrent')
    const started = await kernel.atn.start(host, goal)
    const initial = await kernel.atn.board(host, { action: 'publish', key: 'fact', body: 'original', expectedRevision: 0 })
    if (initial.action === 'read') assert.fail('publication result required')
    const writes = await Promise.allSettled([
      kernel.atn.board(host, { action: 'publish', key: 'fact', body: 'first update', expectedRevision: initial.revision }),
      kernel.atn.board(host, { action: 'publish', key: 'fact', body: 'second update', expectedRevision: initial.revision }),
    ])
    assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1)
    const failure = writes.find(result => result.status === 'rejected') as PromiseRejectedResult
    assert.equal(failure.reason.code, 'revision-conflict')
    await Promise.all([
      kernel.atn.board(host, { action: 'publish', key: 'extra-1', body: 'one', expectedRevision: 0 }),
      kernel.atn.board(host, { action: 'publish', key: 'extra-2', body: 'two', expectedRevision: 0 }),
      ...Array.from({ length: 6 }, () => kernel.atn.board(host, { action: 'read', key: 'fact' })),
    ])
    const record = await kernel.atn.network(started.networkId)
    assert.equal(record.whiteboard?.entries.length, 3)
    assert.equal(record.whiteboard?.entries.find(entry => entry.key === 'fact')?.body, 'first update')
    assert.equal(record.whiteboard?.usage.writes, 4)
    assert.equal(record.whiteboard?.usage.reads, 6)
    const read = await kernel.atn.board(host, { action: 'read' })
    if (read.action !== 'read') assert.fail('read result required')
    read.entries[0].body = 'client mutation'
    assert.notEqual((await kernel.atn.network(started.networkId)).whiteboard!.entries[0].body, 'client mutation')
  })
})

test('BOARD-04: entries, monotonic revisions and metering survive cold recovery', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-board-recovery-'))
  let kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try {
    const host = await createHostAgent(kernel, 'board-recovery')
    const started = await kernel.atn.start(host, goal)
    const peer = await worker(kernel, host)
    await kernel.atn.board(peer, { action: 'publish', key: 'persisted', body: 'durable observation', expectedRevision: 0 })
    await kernel.atn.board(host, { action: 'read', key: 'persisted' })
    const before = await kernel.atn.network(started.networkId)
    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
    await kernel.atn.recover()
    await settle(kernel)
    const after = await kernel.atn.network(started.networkId)
    assert.deepEqual(after.whiteboard, before.whiteboard)
    assert.equal(after.sequence, before.sequence)
  } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})
