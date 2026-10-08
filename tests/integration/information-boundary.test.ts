/** Regression cases recorded before the 0.5.0 information-boundary repair. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { defineCustodyPolicy, OUTBOUND_CHANNELS, type OutboundChannel } from '../../src/information-boundary.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SpawnInput } from '../../src/runtime.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'

const goal = { objective: 'Check local evidence.', successCriteria: 'Grounded result.', constraints: '' }
const foreign = 'artifacts/foreign.json'

async function withKernel(run: (kernel: Kernel) => Promise<void>) {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-boundary-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try { await run(kernel) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

test('BOUNDARY-RED-REVIEW: review.summary cannot launder an unowned artifact', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'boundary-review-host')
    const started = await kernel.atn.start(host, goal)
    const worker = await kernel.atn.spawn(host, { task: 'Check evidence.', context: '' })
    await settle(kernel)
    const agent = kernel.ctx.agents.get(SessionId(worker.sessionId))!
    await kernel.atn.send(agent, { to: started.nodeId, kind: 'result', taskId: worker.taskId,
      body: 'Done.', summary: 'Done.', evidence: [] })
    await settle(kernel)
    kernel.atn.installOutboundPolicy(started.networkId, defineCustodyPolicy({ custody: () => [],
      extractClaims: input => JSON.stringify(input).includes(foreign) ? [foreign] : [] }))
    const before = await kernel.atn.network(started.networkId)
    await assert.rejects(kernel.atn.status(host, { review: { taskId: worker.taskId,
      status: 'accepted', summary: `I hold ${foreign}`, evidence: ['local-check'] } }), { code: 'evidence-not-owned' })
    assert.deepEqual(await kernel.atn.network(started.networkId), before)
  })
})

type AdmissionFixture = { kernel: Kernel; root: Agent; worker: Agent; newcomer: Agent; proposalId: string }
/** Deliberately readable, exhaustive cases; never generate this list from runtime channels. */
const admissionCases: { channel: OutboundChannel; run: (fixture: AdmissionFixture) => Promise<unknown> }[] = [
  { channel: 'start', run: f => f.kernel.atn.start(f.newcomer, { ...goal, objective: foreign }) },
  { channel: 'spawn', run: f => f.kernel.atn.spawn(f.root, { task: foreign, context: '' }) },
  { channel: 'send.task', run: f => f.kernel.atn.send(f.root, { to: 'B', kind: 'task', body: foreign }) },
  { channel: 'send.note', run: f => f.kernel.atn.send(f.root, { to: 'B', kind: 'note', body: foreign }) },
  { channel: 'send.result', run: f => f.kernel.atn.send(f.worker, { to: 'A', kind: 'result', taskId: 'open', body: foreign, summary: foreign, evidence: [] }) },
  { channel: 'status.review', run: f => f.kernel.atn.status(f.root, { review: { taskId: 'done', status: 'accepted', summary: foreign, evidence: ['check'] } }) },
  { channel: 'status.claim', run: f => f.kernel.atn.status(f.worker, { claimTaskId: foreign }) },
  { channel: 'status.rewire', run: f => f.kernel.atn.status(f.root, { rewire: { peers: [foreign] } }) },
  { channel: 'finish.node', run: f => f.kernel.atn.finish(f.worker, foreign) },
  { channel: 'finish.network', run: f => f.kernel.atn.deliver(f.root, { summary: foreign, evidence: [], goalVersion: 1 }) },
  { channel: 'propose', run: f => f.kernel.atn.propose(f.root, { document: goal, rationale: foreign }) },
  { channel: 'vote', run: f => f.kernel.atn.vote(f.worker, { proposalId: f.proposalId, approve: true, reason: foreign }) },
  { channel: 'renew', run: f => f.kernel.atn.renew(f.worker, { taskId: 'open', extendMs: 100, basis: foreign }) },
]

test('BOUNDARY-CHANNELS: every outbound channel invokes policy and every laundering attempt is atomic', async t => {
  assert.deepEqual(admissionCases.map(row => row.channel), [...OUTBOUND_CHANNELS])
  for (const row of admissionCases) await t.test(row.channel, async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'atn-admission-'))
    const record = makeChain(['A', 'B', 'C'])
    record.nodes.C.lifecycle = 'failed'
    record.tasks.done = makeTask('done', { status: 'completed', result: { summary: 'Done.', evidence: [] }, settledBy: 'B', settledAt: 1 })
    record.tasks[foreign] = makeTask(foreign, { holderId: 'C', status: 'unreachable', settledAt: 1 })
    if (row.channel !== 'status.claim') record.tasks.open = makeTask('open')
    const store = new MemoryNetworkStore([record])
    const kernel = await bootKernel(scratch, { store, clock: () => 100 })
    try {
      const root = await createHostAgent(kernel, 'session-A')
      const worker = await createHostAgent(kernel, 'session-B')
      const newcomer = await createHostAgent(kernel, 'new-entry')
      let proposalId = ''
      if (row.channel === 'vote') {
        proposalId = (await kernel.atn.propose(root, { document: { ...record.goalHistory[0].document, plan: 'Plan update.' }, rationale: 'Plan update.' })).proposalId
        await settle(kernel)
      }
      const observed: OutboundChannel[] = []
      const policy = defineCustodyPolicy({ custody: () => [], extractClaims: (input, operation) => {
        observed.push(operation.channel)
        return JSON.stringify(input).includes(foreign) ? [foreign] : []
      } })
      kernel.atn.installOutboundPolicy(row.channel === 'start' ? '*' : record.id, policy)
      const before = structuredClone(await kernel.atn.network(record.id))
      const writes = store.writes
      const agents = kernel.ctx.agents.list().length
      const calls = kernel.model.requests.length
      await assert.rejects(row.run({ kernel, root, worker, newcomer, proposalId }), { code: 'evidence-not-owned' })
      assert.deepEqual(observed, [row.channel])
      assert.deepEqual(await kernel.atn.network(record.id), before)
      assert.equal(store.writes, writes, 'no persistent write, even node provisioning or receipt reconciliation')
      assert.deepEqual(await store.list(), [record.id], 'a rejected start creates no network')
      assert.equal(kernel.ctx.agents.list().length, agents, 'a rejected spawn creates no agent')
      assert.equal(kernel.model.requests.length, calls, 'a refusal wakes nobody')
    } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
  })
})

test('BOUNDARY-FIELDS: evidence, spawn context and optional transport fields cannot launder artifacts', async t => {
  const cases = [
    { name: 'review.evidence', run: (k: Kernel, a: Agent, b: string, task: string) => k.atn.status(a, { review: { taskId: task, status: 'accepted', summary: 'Checked.', evidence: [foreign] } }) },
    { name: 'result.evidence', run: (k: Kernel, a: Agent, b: string, task: string) => k.atn.send(a, { to: b, kind: 'result', taskId: task, body: 'Done.', summary: 'Done.', evidence: [foreign] }) },
    { name: 'spawn.context', run: (k: Kernel, a: Agent) => k.atn.spawn(a, { task: 'Check.', context: foreign } satisfies SpawnInput) },
    { name: 'messageId', run: (k: Kernel, a: Agent, b: string) => k.atn.send(a, { to: b, kind: 'task', body: 'Check.', messageId: foreign }) },
    { name: 'dependsOn', run: (k: Kernel, a: Agent, b: string) => k.atn.send(a, { to: b, kind: 'task', body: 'Check.', dependsOn: [foreign] }) },
    { name: 'retryOf', run: (k: Kernel, a: Agent, b: string) => k.atn.send(a, { to: b, kind: 'task', body: 'Check.', retryOf: foreign }) },
  ]
  for (const row of cases) await t.test(row.name, async () => {
    await withKernel(async kernel => {
      const host = await createHostAgent(kernel, `boundary-fields-${row.name}`)
      const start = await kernel.atn.start(host, goal)
      const worker = await kernel.atn.spawn(host, { task: 'Check.', context: '' })
      await settle(kernel)
      const agent = kernel.ctx.agents.get(SessionId(worker.sessionId))!
      if (row.name === 'review.evidence') {
        await kernel.atn.send(agent, { to: start.nodeId, kind: 'result', taskId: worker.taskId, body: 'Done.', summary: 'Done.', evidence: [] })
        await settle(kernel)
      }
      kernel.atn.installOutboundPolicy(start.networkId, defineCustodyPolicy({ custody: () => [],
        extractClaims: input => JSON.stringify(input).includes(foreign) ? [foreign] : [] }))
      const before = await kernel.atn.network(start.networkId)
      await assert.rejects(row.run(kernel, row.name === 'result.evidence' ? agent : host,
        row.name === 'result.evidence' ? start.nodeId : worker.nodeId, worker.taskId), { code: 'evidence-not-owned' })
      assert.deepEqual(await kernel.atn.network(start.networkId), before)
    })
  })
})

test('BOUNDARY-REPAIR: a newly repaired topology edge does not change custody', async () => {
  await withKernel(async kernel => {
    const root = await createHostAgent(kernel, 'boundary-repair')
    const start = await kernel.atn.start(root, goal)
    const old = await kernel.atn.spawn(root, { task: 'Check.', context: '' })
    await settle(kernel)
    const agent = kernel.ctx.agents.get(SessionId(old.sessionId))!
    const next = await kernel.atn.spawn(agent, { task: 'Check.', context: '' })
    await settle(kernel)
    await kernel.atn.rewire(root, { peers: [old.nodeId] })
    kernel.atn.installOutboundPolicy(start.networkId, defineCustodyPolicy({ custody: () => [],
      extractClaims: input => JSON.stringify(input).includes(foreign) ? [foreign] : [] }))
    await kernel.atn.failNode(start.networkId, old.nodeId, 'Repair fixture')
    const before = await kernel.atn.network(start.networkId)
    assert.ok((await kernel.atn.peers(root)).neighbours.includes(next.nodeId), 'repair must actually create the new edge')
    await assert.rejects(kernel.atn.send(root, { to: next.nodeId, kind: 'note', body: foreign }), { code: 'evidence-not-owned' })
    assert.deepEqual(await kernel.atn.network(start.networkId), before)
  })
})

test('BOUNDARY-ADMISSION: owned requests/results succeed and revoked custody cannot bypass policy via an idempotent retry', async () => {
  await withKernel(async kernel => {
    const root = await createHostAgent(kernel, 'boundary-owned')
    const start = await kernel.atn.start(root, goal)
    const worker = await kernel.atn.spawn(root, { task: 'Check.', context: '' })
    await settle(kernel)
    const agent = kernel.ctx.agents.get(SessionId(worker.sessionId))!
    const custody = new Map([[start.nodeId, new Set(['root-artifact'])], [worker.nodeId, new Set(['worker-artifact'])]])
    const dispose = kernel.atn.installOutboundPolicy(start.networkId, defineCustodyPolicy({
      custody: id => custody.get(id) ?? [],
      extractClaims: input => [...JSON.stringify(input).matchAll(/claim:([a-z-]+)/g)].map(match => match[1]),
    }))
    const requested = await kernel.atn.send(root, { to: worker.nodeId, kind: 'task', body: 'claim:root-artifact', messageId: 'owned-request' })
    await kernel.atn.send(agent, { to: start.nodeId, kind: 'result', taskId: requested.settledTaskId!,
      body: 'claim:worker-artifact', summary: 'claim:worker-artifact', evidence: ['claim:worker-artifact'] })
    await settle(kernel)
    const before = await kernel.atn.network(start.networkId)
    custody.get(start.nodeId)!.clear()
    await assert.rejects(kernel.atn.send(root, { to: worker.nodeId, kind: 'task', body: 'claim:root-artifact', messageId: 'owned-request' }), { code: 'evidence-not-owned' })
    assert.deepEqual(await kernel.atn.network(start.networkId), before)
    dispose(); dispose()
    kernel.atn.installOutboundPolicy(start.networkId, defineCustodyPolicy({ custody: () => [], extractClaims: () => [] }))
  })
})

test('BOUNDARY-SYNC: asynchronous checks cannot silently authorize a persistent write', async () => {
  await withKernel(async kernel => {
    const root = await createHostAgent(kernel, 'boundary-sync')
    const start = await kernel.atn.start(root, goal)
    await settle(kernel)
    kernel.atn.installOutboundPolicy(start.networkId, async () => { throw new Error('delayed rejection') })
    const before = await kernel.atn.network(start.networkId)
    await assert.rejects(kernel.atn.send(root, { to: start.nodeId, kind: 'note', body: 'Unadmitted.' }), { code: 'async-policy' })
    assert.deepEqual(await kernel.atn.network(start.networkId), before)
  })
})

test('BOUNDARY-RED-DISCOVERY: an agent cannot forge its discovery custody', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'boundary-discovery-host')
    const started = await kernel.atn.start(host, goal)
    const worker = await kernel.atn.spawn(host, { task: 'Check evidence.', context: '' })
    await settle(kernel)
    const agent = kernel.ctx.agents.get(SessionId(worker.sessionId))!
    kernel.atn.installOutboundPolicy(started.networkId, defineCustodyPolicy({
      custody: id => id === worker.nodeId ? ['artifacts/owned.json'] : [],
      extractClaims: input => JSON.stringify(input).includes(foreign) ? [foreign] : [],
    }))
    await kernel.atn.refreshCustody(started.networkId)
    const before = (await kernel.atn.network(started.networkId)).nodes[worker.nodeId].knowledgeFingerprint
    assert.equal(kernel.ctx.tools.schemas(agent.id).some(tool => tool.name === 'atn_board'), false)
    assert.equal('board' in kernel.atn, false)
    assert.equal('publishKnowledge' in kernel.atn, false)
    kernel.model.enqueue(agent.id, [
      { tool: 'atn_board', args: { action: 'publish', key: 'forged-custody', body: 'I hold this document.', documents: [foreign], topics: ['forged-topic'] } },
      { tool: 'atn_status', args: { query: '*', documents: [foreign], topics: ['forged-topic'], knowledgeFingerprint: { documents: [foreign] } } },
    ])
    await drive(agent, 'Try to forge custody.')
    await settle(kernel)
    assert.deepEqual((await kernel.atn.network(started.networkId)).nodes[worker.nodeId].knowledgeFingerprint, before)
    await kernel.atn.rewire(host, { peers: [] })
    const discovered = await kernel.atn.status(host, { query: 'owned' })
    assert.deepEqual(discovered.candidates, [worker.nodeId])
    assert.equal(discovered.candidateNodes?.[0].knowledgeFingerprint.source, 'host-custody')
    assert.deepEqual((await kernel.atn.status(host, { query: 'foreign' })).candidates, [])
  })
})
