/** Bounded discovery rotates independently for callers and exposes terminal feedback. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { markTaskUnreachable, settleTask } from '../../src/tasks.ts'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { testGoal } from '../fixtures/network.ts'
import type { PeersResult, SpawnResult } from '../../src/runtime.ts'

async function withKernel(run: (kernel: Kernel, store: MemoryNetworkStore) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-discovery-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  try { await run(kernel, store) }
  finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

async function spawn(kernel: Kernel, creator: Agent, task: string): Promise<SpawnResult & { agent: Agent }> {
  const born = await kernel.atn.spawn(creator, { task, context: '' })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(born.sessionId))
  assert.ok(agent)
  return { ...born, agent }
}

async function discover(kernel: Kernel, agent: Agent, query: string): Promise<PeersResult> {
  kernel.model.enqueue(agent.id, [{ tool: 'atn_status', args: { query } }])
  await drive(agent, 'Discover collaborators.')
  await settle(kernel)
  const event = agent.session.snapshotEvents().filter(row => row.type === 'tool/result').at(-1)
  assert.ok(event)
  const message = (event.data as { message: { isError?: boolean; content: readonly { text?: string }[] } }).message
  assert.notEqual(message.isError, true, JSON.stringify(message.content))
  return JSON.parse(message.content.map(block => block.text ?? '').join('')) as PeersResult
}

test('DISCOVERY-01: wildcard pages cover all candidates, stay bounded, and advance per caller even concurrently', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'discovery-host')
    const started = await kernel.atn.start(host, testGoal)
    const other = await spawn(kernel, host, 'Another exploring branch.')
    const workers = []
    for (let index = 0; index < 6; index++) workers.push(await spawn(kernel, host, `Candidate ${index}.`))
    await kernel.atn.rewire(host, { peers: [other.nodeId] })
    await kernel.atn.rewire(other.agent, { peers: [started.nodeId] })
    const original = await kernel.atn.network(started.networkId)

    const first = await discover(kernel, host, '*')
    const second = await discover(kernel, host, '*')
    const otherFirst = await kernel.atn.peers(other.agent, '*')
    const expected = workers.map(worker => worker.nodeId).sort()
    assert.equal(first.candidates!.length, 3)
    assert.equal(second.candidates!.length, 3)
    assert.equal(new Set([...first.candidates!, ...second.candidates!]).size, 6)
    assert.deepEqual([...first.candidates!, ...second.candidates!].sort(), expected)
    assert.deepEqual(otherFirst.candidates, first.candidates, 'another caller starts its own rotation')
    assert.deepEqual(first.candidateNodes!.map(node => node.id), first.candidates)
    assert.deepEqual(second.candidateNodes!.map(node => node.id), second.candidates)

    const concurrent = await Promise.all([kernel.atn.peers(host, '*'), kernel.atn.peers(host, '*')])
    assert.deepEqual(concurrent.map(page => page.candidates), [first.candidates, second.candidates], 'simultaneous queries reserve successive pages')
    assert.deepEqual((await kernel.atn.peers(other.agent, '*')).candidates, second.candidates, 'one caller never consumes another caller\'s page')
    const edges = (nodes: typeof original.nodes) => Object.fromEntries(Object.values(nodes).map(node => [node.id, node.peerIds]))
    assert.deepEqual(edges((await kernel.atn.network(started.networkId)).nodes), edges(original.nodes), 'discovery does not change any collaboration edge')
  })
})

test('DISCOVERY-02: text relevance remains stable and does not consume the wildcard cursor', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'search-host')
    await kernel.atn.start(host, testGoal)
    const workers = []
    for (let index = 0; index < 5; index++) workers.push(await spawn(kernel, host, index === 4 ? 'Trace a zebra routing defect.' : `Generic candidate ${index}.`))
    await kernel.atn.rewire(host, { peers: [] })
    const first = await kernel.atn.peers(host, '*')
    const relevant = await kernel.atn.peers(host, 'zebra routing')
    const relevantAgain = await kernel.atn.peers(host, 'zebra routing')
    const second = await kernel.atn.peers(host, '*')
    assert.deepEqual(relevant.candidates, [workers[4]!.nodeId])
    assert.deepEqual(relevantAgain, relevant)
    assert.equal(new Set([...first.candidates!, ...second.candidates!]).size, workers.length)
    assert.deepEqual(await kernel.atn.peers(host, 'no-such-topic'), { self: first.self, neighbours: [], nodes: [], candidates: [], candidateNodes: [] })
    assert.equal((await kernel.atn.peers(host, ' ')).candidates, undefined)
    await kernel.atn.rewire(host, { peers: workers.slice(0, 4).map(worker => worker.nodeId) })
    const last = await kernel.atn.peers(host, '*')
    assert.deepEqual(last.candidates, [workers[4]!.nodeId], 'cursor survives candidates becoming neighbours without returning duplicates')
    await kernel.atn.finish(workers[4]!.agent)
    assert.deepEqual((await kernel.atn.peers(host, '*')).candidates, [], 'draining candidates disappear immediately')
  })
})

test('DISCOVERY-03: neighbourhood and candidate summaries distinguish completed, failed and unreachable work', async () => {
  await withKernel(async (kernel, store) => {
    const host = await createHostAgent(kernel, 'feedback-host')
    const started = await kernel.atn.start(host, testGoal)
    const completed = await spawn(kernel, host, 'Completed investigation.')
    const failed = await spawn(kernel, host, 'Failed investigation.')
    const unreachable = await spawn(kernel, host, 'Unreachable investigation.')
    await kernel.atn.rewire(host, { peers: [completed.nodeId] })
    await store.update(started.networkId, current => {
      const done = settleTask(current, completed.taskId, completed.nodeId, { summary: 'Verified parser.', evidence: [] }, 1_000_001).record
      const failure = settleTask(done, failed.taskId, failed.nodeId, { summary: 'Missing input fixture.', evidence: [] }, 1_000_002, true).record
      return markTaskUnreachable(failure, unreachable.taskId, 'Requester unavailable.', 1_000_003)
    })

    const feedback = await discover(kernel, host, '*')
    assert.deepEqual(feedback.nodes.find(node => node.id === completed.nodeId)!.recentResults, ['[completed] Verified parser.'])
    assert.deepEqual(feedback.candidateNodes!.find(node => node.id === failed.nodeId)!.recentResults, ['[failed] Missing input fixture.'])
    assert.deepEqual(feedback.candidateNodes!.find(node => node.id === unreachable.nodeId)!.recentResults, ['[unreachable] Unreachable investigation.'])
    assert.ok(feedback.candidateNodes!.every(node => node.openTasks === 0))
  })
})
