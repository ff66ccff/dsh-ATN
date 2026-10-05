import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, settle, atnMessages, type Kernel } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'

const goal = { objective: 'Review regression', successCriteria: 'No leaked agents or lost work', constraints: 'Scripted model only' }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
async function fixture(run: (kernel: Kernel, store: MemoryNetworkStore) => Promise<void>, timeout = 1000) {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-review-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000, cleanupTimeoutMs: timeout })
  try { await run(kernel, store) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}
async function start(kernel: Kernel, session = 'host') {
  const host = await createHostAgent(kernel, session)
  await kernel.atn.start(host, goal)
  const found = await kernel.atn.findBySessionId(session)
  return { host, networkId: found!.record.id }
}
function internals(kernel: Kernel) {
  return kernel.atn as unknown as { owner: Context; handles: Map<string, AgentHandle> }
}

test('REVIEW-01: stop cancels a create that returns its live handle after the timeout', async () => {
  await fixture(async kernel => {
    const { host, networkId } = await start(kernel)
    const registry = internals(kernel).owner.agents
    const original = registry.create.bind(registry)
    const created = deferred(), release = deferred()
    registry.create = async options => { const handle = await original(options); created.resolve(); await release.promise; return handle }
    const spawning = kernel.atn.spawn(host, { task: 'late worker', context: '' })
    const rejected = assert.rejects(spawning)
    try {
      await created.promise
      const stop = await kernel.atn.stop(networkId, 'stop during create')
      assert.equal(stop.stragglers.length, 1)
      release.resolve()
      await rejected
      const record = await kernel.atn.network(networkId)
      const child = Object.values(record.nodes).find(n => !n.isEntry)!
      assert.equal(record.status, 'stopped')
      assert.equal(child.lifecycle, 'failed')
      assert.equal(Object.values(record.tasks).some(t => t.status === 'open'), false)
      assert.equal(kernel.ctx.agents.get(SessionId(child.sessionId)), undefined)
    } finally { registry.create = original; release.resolve(); await rejected }
  }, 40)
})

test('REVIEW-02: concurrent stops release same-numbered nodes in separate networks', async () => {
  await fixture(async kernel => {
    const a = await start(kernel, 'host-A'), b = await start(kernel, 'host-B')
    const ca = await kernel.atn.spawn(a.host, { task: 'A', context: '' })
    const cb = await kernel.atn.spawn(b.host, { task: 'B', context: '' })
    await settle(kernel)
    assert.equal(ca.nodeId, cb.nodeId)
    const [ra, rb] = await Promise.all([kernel.atn.stop(a.networkId, 'A'), kernel.atn.stop(b.networkId, 'B')])
    assert.deepEqual(ra.stragglers, [])
    assert.deepEqual(rb.stragglers, [])
    assert.deepEqual(ra.released, [ca.nodeId])
    assert.deepEqual(rb.released, [cb.nodeId])
    assert.equal(kernel.ctx.agents.get(SessionId(ca.sessionId)), undefined)
    assert.equal(kernel.ctx.agents.get(SessionId(cb.sessionId)), undefined)
  })
})

test('REVIEW-04: failure after publish settles the initial task and frees completion', async () => {
  await fixture(async (kernel, store) => {
    const { host, networkId } = await start(kernel)
    let injected = false
    store.updateHook = next => {
      if (!injected && Object.values(next.nodes).some(n => !n.isEntry && n.lastGoalVersionSent === 1)) {
        injected = true; throw new Error('goal receipt write failed')
      }
    }
    await assert.rejects(kernel.atn.spawn(host, { task: 'failed assignment', context: '' }), /goal receipt/)
    assert.equal(injected, true)
    const record = await kernel.atn.network(networkId)
    const child = Object.values(record.nodes).find(n => !n.isEntry)!
    const task = Object.values(record.tasks).find(t => t.holderId === child.id)!
    assert.equal(task.status, 'failed')
    assert.equal(child.lifecycle, 'failed')
    assert.equal(kernel.ctx.agents.get(SessionId(child.sessionId)), undefined)
    assert.equal((await kernel.atn.deliver(host, { summary: 'reported failure', evidence: [], goalVersion: 1 })).accepted, true)
  })
})

test('REVIEW-06: exhausted budget drains and releases a node with no outstanding work', async () => {
  await fixture(async (kernel, store) => {
    const { host, networkId } = await start(kernel)
    const child = await kernel.atn.spawn(host, { task: 'work', context: '' })
    await settle(kernel)
    const agent = kernel.ctx.agents.get(SessionId(child.sessionId))!
    const record = await kernel.atn.network(networkId)
    const task = Object.values(record.tasks).find(t => t.holderId === child.nodeId)!
    await kernel.atn.send(agent, { to: record.entryNodeId, kind: 'result', taskId: task.id, body: 'done', summary: 'done' })
    await settle(kernel)
    await store.update(networkId, current => ({ ...current, nodes: { ...current.nodes,
      [child.nodeId]: { ...current.nodes[child.nodeId]!, stepsUsed: current.limits.stepBudget } } }))
    assert.equal(await kernel.atn.admitStep(networkId, child.sessionId), false)
    await kernel.atn.tick()
    assert.equal((await kernel.atn.network(networkId)).nodes[child.nodeId]!.lifecycle, 'retired')
    assert.equal(kernel.ctx.agents.get(SessionId(child.sessionId)), undefined)
  })
})

test('REVIEW-07: concurrent votes and recovery append one goal snapshot per recipient', async () => {
  await fixture(async kernel => {
    const { host } = await start(kernel)
    const b = await kernel.atn.spawn(host, { task: 'B', context: '' })
    const ba = kernel.ctx.agents.get(SessionId(b.sessionId))!
    const c = await kernel.atn.spawn(ba, { task: 'C', context: '' })
    const ca = kernel.ctx.agents.get(SessionId(c.sessionId))!
    await settle(kernel)
    const proposal = await kernel.atn.propose(ba, { document: { ...goal, plan: 'v2' }, rationale: 'test' })
    await Promise.all([kernel.atn.vote(host, { proposalId: proposal.proposalId, approve: true }), kernel.atn.vote(ca, { proposalId: proposal.proposalId, approve: true })])
    await kernel.atn.recover()
    await settle(kernel)
    for (const agent of [host, ba, ca]) {
      const text = [...atnMessages(agent), ...agent.inbox.nextStep.flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : [])), ...agent.inbox.nextTurn.flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : []))]
      assert.equal(text.filter(t => t.split('\n')[0]!.includes('version=2')).length, 1, JSON.stringify({session: agent.id, matched: text.filter(t => t.split('\n')[0]!.includes('version=2')).map(t => t.split('\n')[0]), history: atnMessages(agent).map(t=>t.split('\n')[0]), step: agent.inbox.nextStep.length, turn: agent.inbox.nextTurn.length}))
    }
  })
})

test('REVIEW-08: retries report queued and undeliverable accurately without new tasks', async () => {
  await fixture(async (kernel, store) => {
    const { host, networkId } = await start(kernel)
    const child = await kernel.atn.spawn(host, { task: 'work', context: '' })
    await settle(kernel)
    const handle = internals(kernel).handles.get(child.sessionId)!
    await handle.dispose()
    internals(kernel).handles.delete(child.sessionId)
    const input = { to: child.nodeId, kind: 'task' as const, body: 'queued work', messageId: 'stable-retry' }
    assert.equal((await kernel.atn.send(host, input)).delivery, 'queued')
    const retry = await kernel.atn.send(host, input)
    assert.equal(retry.duplicate, true)
    assert.equal(retry.delivery, 'queued')
    await store.update(networkId, r => ({ ...r, nodes: { ...r.nodes, [child.nodeId]: { ...r.nodes[child.nodeId]!, lifecycle: 'failed' } } }))
    assert.equal((await kernel.atn.send(host, input)).delivery, 'undeliverable')
    assert.equal((await kernel.atn.send(host, input)).delivery, 'undeliverable')
    assert.equal(Object.values((await kernel.atn.network(networkId)).tasks).filter(t => t.description === input.body).length, 1)
  })
})


test('MAIL-02: a lost delivery receipt is deduplicated from history after full kernel rebuild', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-mail-rebuild-'))
  const store = new MemoryNetworkStore()
  let kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  try {
    const { host, networkId } = await start(kernel)
    const child = await kernel.atn.spawn(host, { task: 'work', context: '' })
    await settle(kernel)
    let lost = false
    store.updateHook = next => {
      if (!lost && next.mails['lost-receipt']?.status === 'delivered') { lost = true; throw new Error('lost receipt') }
    }
    await assert.rejects(kernel.atn.send(host, { to: child.nodeId, kind: 'note', body: 'once only', messageId: 'lost-receipt' }), /lost receipt/)
    await settle(kernel)
    assert.equal(lost, true)
    assert.equal((await kernel.atn.network(networkId)).mails['lost-receipt']!.status, 'queued')
    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
    await kernel.atn.recover()
    await settle(kernel)
    const resumed = kernel.ctx.agents.get(SessionId(child.sessionId))!
    assert.equal(atnMessages(resumed).filter(text => text.includes('once only')).length, 1)
    assert.equal((await kernel.atn.network(networkId)).mails['lost-receipt']!.status, 'delivered')
  } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})

test('STOP-STREAM: stop aborts an active model stream and retains the host entry', async () => {
  await fixture(async kernel => {
    const { host, networkId } = await start(kernel)
    const entered = deferred()
    let aborted = false
    const original = kernel.model.stream.bind(kernel.model)
    kernel.model.stream = async function* (options) {
      if (String(options.sessionId) === 'host') { yield* original(options); return }
      entered.resolve()
      await new Promise<void>(resolve => {
        if (options.signal?.aborted) { aborted = true; resolve(); return }
        options.signal?.addEventListener('abort', () => { aborted = true; resolve() }, { once: true })
      })
      options.signal?.throwIfAborted()
    }
    const child = await kernel.atn.spawn(host, { task: 'busy worker', context: '' })
    await entered.promise
    const report = await kernel.atn.stop(networkId, 'stop busy stream')
    assert.equal(aborted, true)
    assert.deepEqual(report.stragglers, [])
    assert.equal(kernel.ctx.agents.get(SessionId(child.sessionId)), undefined)
    assert.equal(kernel.ctx.agents.get(SessionId('host')), host)
  })
})
