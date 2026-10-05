/** Real kernel + strict Gateway coverage of the read-only operator surface. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { SessionId } from '@deepseek-ai/dsh-session'
import { AtnObserver } from '../../src/observer.ts'
import { atnObserverSnapshotSchema, OBSERVER_MAX_EVENTS, OBSERVER_MAX_TASKS } from '../../src/observer-schema.ts'
import type { AtnObserverSnapshot } from '../../src/observer-types.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { validateTaskResult } from '../../src/tasks.ts'
import { evaluateRewireEvidence } from '../../src/verified-feedback.ts'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { makeChain, makeTask, testGoal } from '../fixtures/network.ts'

async function withObserver(run: (kernel: Kernel) => Promise<void>, store?: MemoryNetworkStore): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-observer-'))
  const kernel = await bootKernel(scratch, { clock: () => Date.now(), store })
  try {
    await kernel.ctx.plugin(TypertRegistry)
    await kernel.ctx.plugin(TypertGateway)
    await kernel.ctx.plugin(AtnObserver)
    await run(kernel)
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

async function snapshot(kernel: Kernel, sessionId: string): Promise<AtnObserverSnapshot> {
  const value = await kernel.ctx.typertGateway.invoke({
    namespace: 'atnObserver', method: 'snapshot', args: { sessionId }, signal: new AbortController().signal,
  })
  return atnObserverSnapshotSchema.parse(value)
}

test('OBSERVER-01: strict Gateway scopes observation to the viewed session and never changes network or model input', async () => {
  await withObserver(async kernel => {
    const host = await createHostAgent(kernel, 'observer-host')
    const started = await kernel.atn.start(host, testGoal)
    const child = await kernel.atn.spawn(host, { task: 'Investigate parsing.', context: 'private task context' })
    await settle(kernel)
    const agent = kernel.ctx.agents.get(SessionId(child.sessionId))!
    await kernel.atn.rewire(host, { peers: [child.nodeId] })
    await kernel.atn.rewire(agent, { peers: [] })
    const before = await kernel.atn.network(started.networkId)
    const histories = kernel.ctx.agents.list().map(row => [row.id, row.session.snapshotEvents().length])
    const requests = kernel.model.requests.length
    const first = await snapshot(kernel, host.id)
    const second = await snapshot(kernel, child.sessionId)
    assert.equal(first.network!.id, second.network!.id)
    assert.deepEqual(first.network!.nodes.find(row => row.id === child.nodeId)!.peers, [])
    assert.ok(first.network!.edges.some(edge => edge.kind === 'collaboration' && edge.source === started.nodeId && edge.target === child.nodeId))
    assert.ok(!first.network!.edges.some(edge => edge.kind === 'collaboration' && edge.source === child.nodeId))
    assert.ok(first.network!.edges.some(edge => edge.kind === 'birth' && edge.source === started.nodeId && edge.target === child.nodeId))
    assert.equal((await snapshot(kernel, 'unrelated-session')).network, null)
    assert.deepEqual(await kernel.atn.network(started.networkId), before)
    assert.deepEqual(kernel.ctx.agents.list().map(row => [row.id, row.session.snapshotEvents().length]), histories)
    assert.equal(kernel.model.requests.length, requests)
    assert.equal(JSON.stringify(first).includes('private task context'), false)
    assert.equal(JSON.stringify(first).includes('permissionSeed'), false)
    await assert.rejects(() => kernel.ctx.typertGateway.invoke({
      namespace: 'atnObserver', method: 'snapshot', args: { sessionId: 42 }, signal: new AbortController().signal,
    }), /boundary validation/i)
    await assert.rejects(() => kernel.ctx.typertGateway.invoke({
      namespace: 'atnObserver', method: 'snapshot', args: { sessionId: host.id, allNetworks: true }, signal: new AbortController().signal,
    }), /unexpected|unknown|argument/i)
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(() => kernel.ctx.atnObserver.snapshot(host.id, abort.signal))
  })
})

test('OBSERVER-02: live tool activity is visible during execution and cleared on settlement without exposing arguments', async () => {
  await withObserver(async kernel => {
    const host = await createHostAgent(kernel, 'observer-live')
    await kernel.atn.start(host, testGoal)
    await settle(kernel)
    await snapshot(kernel, host.id)
    let entered!: () => void
    let release!: () => void
    const entering = new Promise<void>(resolve => { entered = resolve })
    const released = new Promise<void>(resolve => { release = resolve })
    const remove = kernel.ctx.on('tools/execute', async (exec, next) => {
      if (exec.name === 'atn_status') { entered(); await released }
      return next()
    })
    kernel.model.enqueue(host.id, [{ tool: 'atn_status', args: { query: 'password=argument-must-not-leak' } }])
    const running = drive(host, 'Inspect peers.')
    try {
      await entering
      const during = await snapshot(kernel, host.id)
      assert.equal(during.network!.nodes[0].agentStatus, 'running')
      assert.equal(during.network!.nodes[0].currentTool, 'atn_status')
      assert.ok(during.network!.events.some(event => event.kind === 'tool/call' && event.summary.includes('atn_status')))
      assert.ok(!JSON.stringify(during).includes('argument-must-not-leak'))
    } finally { release(); remove(); await running }
    const after = await snapshot(kernel, host.id)
    assert.equal(after.network!.nodes[0].agentStatus, 'idle')
    assert.equal(after.network!.nodes[0].currentTool, null)
    const persisted = await kernel.atn.network(after.network!.id)
    assert.equal(after.network!.nodes[0].stepsUsed, persisted.nodes[after.network!.nodes[0].id]!.stepsUsed)
    assert.ok(after.network!.events.some(event => event.kind === 'tool/result' && event.summary.includes('atn_status')))
  })
})

test('OBSERVER-03: rapid rewiring and failed results survive between snapshots', async () => {
  await withObserver(async kernel => {
    const host = await createHostAgent(kernel, 'observer-rewire')
    const started = await kernel.atn.start(host, testGoal)
    const first = await kernel.atn.spawn(host, { task: 'First branch.', context: '' })
    const second = await kernel.atn.spawn(host, { task: 'Second branch.', context: '' })
    await settle(kernel)
    const worker = kernel.ctx.agents.get(SessionId(first.sessionId))!
    await snapshot(kernel, host.id)
    await kernel.atn.rewire(worker, { peers: [] })
    await kernel.atn.rewire(worker, { peers: [second.nodeId] })
    await kernel.atn.rewire(worker, { peers: [started.nodeId] })
    await kernel.atn.send(worker, {
      to: started.nodeId, kind: 'result', taskId: first.taskId, body: 'Parsing failed.',
      summary: 'Unsupported input.', evidence: [], outcome: 'failed',
    })
    await settle(kernel)
    const view = (await snapshot(kernel, host.id)).network!
    assert.ok(view.events.some(event => event.kind === 'edge-added' && event.nodeId === first.nodeId && event.targetId === second.nodeId))
    assert.ok(view.events.some(event => event.kind === 'edge-removed' && event.nodeId === first.nodeId && event.targetId === second.nodeId))
    assert.equal(view.tasks.find(task => task.id === first.taskId)!.status, 'failed')
    assert.ok(view.events.some(event => event.kind === 'task-failed' && event.taskId === first.taskId))
    assert.ok(view.events.some(event => event.kind === 'mail-sent' && event.nodeId === first.nodeId && event.targetId === started.nodeId))
  })
})

test('OBSERVER-04: cold durable records yield bounded useful history without resuming unloaded agents', async () => {
  const store = new MemoryNetworkStore()
  const record = makeChain(['A', 'B'])
  record.nodes.A.peerIds = ['B']
  record.nodes.B.peerIds = []
  record.nodes.B.permissionSeed = { apiKey: 'host-credential-must-not-leak' }
  for (let index = 0; index < 250; index++) record.tasks[`task-${index}`] = makeTask(`task-${index}`, {
    description: `Task ${index} ${'x'.repeat(1000)}`, context: 'private-context-must-not-leak',
    status: 'failed', result: { summary: 'Failure password=hidden-secret', evidence: ['private-evidence'] },
    createdAt: index, settledAt: index + 1000,
  })
  await store.create(record)
  await withObserver(async kernel => {
    const view = (await snapshot(kernel, 'session-B')).network!
    assert.equal(view.nodes.length, 2)
    assert.ok(view.nodes.every(node => node.agentStatus === 'unloaded'))
    assert.equal(view.tasks.length, OBSERVER_MAX_TASKS)
    assert.equal(view.events.length, OBSERVER_MAX_EVENTS)
    assert.ok(view.tasks.every(task => task.description.length <= 512))
    assert.ok(view.events.some(event => event.kind === 'task-failed'))
    const serialized = JSON.stringify(view)
    for (const forbidden of ['host-credential-must-not-leak', 'private-context-must-not-leak', 'private-evidence', 'hidden-secret', 'permissionSeed']) {
      assert.equal(serialized.includes(forbidden), false, forbidden)
    }
    assert.equal(kernel.ctx.agents.list().length, 0)
    assert.deepEqual(await store.load(record.id), record)
  }, store)
})

test('OBSERVER-05: proposals, votes and commit history are present on first read', async () => {
  const store = new MemoryNetworkStore()
  const record = makeChain(['A', 'B'])
  record.proposals.p1 = {
    id: 'p1', proposerId: 'A', baseVersion: 1, document: testGoal, rationale: 'Clarify acceptance.',
    voters: ['B'], votes: [{ voterId: 'B', approve: true, reason: null, at: 2 }], status: 'committed',
    deadlineAt: 100, createdAt: 1, settledAt: 3, committedVersion: 2, note: null,
  }
  record.goalHistory.push({ version: 2, document: testGoal, proposedBy: 'A', approvedBy: ['B'], committedAt: 3 })
  await store.create(record)
  await withObserver(async kernel => {
    const view = (await snapshot(kernel, 'session-A')).network!
    assert.equal(view.goalVersion, 2)
    assert.ok(view.events.some(event => event.kind === 'proposal-created'))
    assert.ok(view.events.some(event => event.kind === 'proposal-vote' && event.nodeId === 'B'))
    assert.ok(view.events.some(event => event.kind === 'proposal-committed'))
    assert.ok(view.events.some(event => event.kind === 'goal-committed' && event.id === 'goal:2'))
  }, store)
})

test('OBSERVER-06: cold history distinguishes submission, independent acceptance, exploration and observed regression', async () => {
  const store = new MemoryNetworkStore()
  let record = makeChain(['A', 'B', 'C'])
  for (const [id, holderId] of [['old', 'B'], ['new', 'C'], ['legacy', 'B'], ['stale', 'C']]) {
    record.tasks[id] = makeTask(id, {
      holderId, status: 'completed', createdAt: 1, settledAt: 11, settledBy: holderId,
      result: { summary: `Submission ${id}`, evidence: ['private-result-evidence'] },
    })
  }
  for (const id of ['old', 'new', 'stale']) {
    record = validateTaskResult(record, id, {
      id: 'host-validator-v1',
      validate: () => ({
        passed: id !== 'old', summary: 'Checked password=hidden-validator-secret', evidence: ['private-host-evidence'],
        metrics: { comparisonKey: 'matched-work-v1', cost: 2, costUnit: 'tokens' },
      }),
    }, 20).record
  }
  record.tasks.stale = { ...record.tasks.stale!, result: { summary: 'Changed after verification', evidence: [] } }
  record.rewireHistory = [{
    id: 'forward', nodeId: 'A', createdAt: 30, previousPeers: ['B'], nextPeers: ['C'], intent: 'verified-improvement',
    evaluation: evaluateRewireEvidence(record, {
      requesterId: 'A', previousPeers: ['B'], nextPeers: ['C'], baselineTaskIds: ['old'], candidateTaskIds: ['new'],
    }),
  }, {
    id: 'reverse', nodeId: 'A', createdAt: 40, previousPeers: ['C'], nextPeers: ['B'], intent: 'exploration',
    evaluation: evaluateRewireEvidence(record, {
      requesterId: 'A', previousPeers: ['C'], nextPeers: ['B'], baselineTaskIds: ['new'], candidateTaskIds: ['old'],
    }),
  }]
  await store.create(record)
  await withObserver(async kernel => {
    const view = (await snapshot(kernel, 'session-A')).network!
    const submitted = view.events.find(event => event.kind === 'task-completed' && event.taskId === 'legacy')!
    assert.match(submitted.summary, /已提交，等待独立验收/)
    assert.ok(!view.events.some(event => event.kind.startsWith('task-acceptance-') && event.taskId === 'legacy'))
    assert.match(view.events.find(event => event.kind === 'task-acceptance-passed' && event.taskId === 'new')!.summary, /独立验收通过/)
    assert.match(view.events.find(event => event.kind === 'task-acceptance-failed' && event.taskId === 'old')!.summary, /独立验收未通过/)
    assert.match(view.events.find(event => event.kind === 'task-acceptance-stale')!.summary, /仍未验证/)
    assert.match(view.events.find(event => event.id === 'rewire:forward')!.summary, /局部观测改善.*不代表因果收益/)
    assert.match(view.events.find(event => event.id === 'rewire:reverse')!.summary, /探索.*局部观测退化/)
    const serialized = JSON.stringify(view)
    for (const hidden of ['private-result-evidence', 'private-host-evidence', 'hidden-validator-secret']) {
      assert.ok(!serialized.includes(hidden), hidden)
    }
    assert.deepEqual(await store.load(record.id), record)
    assert.equal(kernel.model.requests.length, 0)
  }, store)
})
