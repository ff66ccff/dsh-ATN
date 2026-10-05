/**
 * The single-writer repair: concurrent network operations must serialize on one
 * per-network critical section so no caller ever writes from a stale snapshot.
 * @module dsh-atn/tests/integration/concurrency
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'

const goal = {
  objective: 'Serialize every network write.',
  successCriteria: 'Concurrent operations lose nothing.',
  constraints: 'Deterministic clock only.',
}

interface Bench {
  kernel: Kernel
  store: MemoryNetworkStore
  scratch: string
}

async function boot(): Promise<Bench> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-conc-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000, cleanupTimeoutMs: 50 })
  return { kernel, store, scratch }
}

async function startNetwork(kernel: Kernel): Promise<{ host: Agent; networkId: string }> {
  const host = await createHostAgent(kernel, 'session-host')
  kernel.model.enqueue('session-host', [{ tool: 'atn_start', args: goal }])
  await drive(host, 'start')
  await settle(kernel)
  const networkId = (await kernel.ctx.atn.networkIds())[0]!
  return { host: kernel.ctx.agents.get(SessionId('session-host'))!, networkId }
}

test('CONCURRENCY-01: two simultaneous spawns keep both nodes and both tasks, and one selected child', async () => {
  const bench = await boot()
  try {
    const { host, networkId } = await startNetwork(bench.kernel)
    const selectedDuringPublish: string[] = []
    bench.store.updateHook = next => {
      const selected = next.nodes[next.entryNodeId]!.selectedChildId
      if (selected !== null) selectedDuringPublish.push(selected)
    }
    const [first, second] = await Promise.all([
      bench.kernel.ctx.atn.spawn(host, { task: 'First concurrent task.', context: '' }),
      bench.kernel.ctx.atn.spawn(host, { task: 'Second concurrent task.', context: '' }),
    ])
    assert.notEqual(first.nodeId, second.nodeId, 'each spawn allocated its own node id')

    const record = await bench.kernel.ctx.atn.network(networkId)
    const children = Object.values(record.nodes).filter((node) => node.creatorId === record.entryNodeId)
    assert.equal(children.length, 2, 'both spawned nodes survived')
    assert.equal(Object.values(record.tasks).filter((task) => task.status === 'open').length, 3, 'the entry task and both spawned tasks survived')
    assert.ok(selectedDuringPublish.length > 0)
    assert.equal(new Set(selectedDuringPublish).size, 1, 'later publications never overwrite the first successful claim')
    assert.equal(record.nodes[record.entryNodeId]!.selectedChildId, selectedDuringPublish[0], 'the first published child claimed the selected slot, independent of creation-intent order')
    for (const child of children) {
      assert.ok(bench.kernel.ctx.atn.ownsHandle(child.id), `${child.id} keeps its handle`)
      assert.equal(child.creationState, 'published')
    }
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('CONCURRENCY-02: simultaneous voters keep every vote and commit exactly one new revision', async () => {
  const bench = await boot()
  try {
    const { host, networkId } = await startNetwork(bench.kernel)
    // A chain of three: the middle node's frozen approver list is its upstream
    // parent and its downstream selected child.
    const parent = await bench.kernel.ctx.atn.spawn(host, { task: 'Parent work.', context: '' })
    const parentAgent = bench.kernel.ctx.agents.get(SessionId(parent.sessionId))!
    const child = await bench.kernel.ctx.atn.spawn(parentAgent, { task: 'Child work.', context: '' })
    const childAgent = bench.kernel.ctx.agents.get(SessionId(child.sessionId))!

    const proposal = await bench.kernel.ctx.atn.propose(parentAgent, {
      document: { ...goal, plan: 'Revised work plan.' },
      rationale: 'concurrent approval',
    })
    const topology = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(topology.nodes[topology.entryNodeId]!.selectedChildId, parent.nodeId, 'the entry node selects the middle node')
    assert.equal(topology.nodes[parent.nodeId]!.selectedChildId, child.nodeId, 'the middle node selects the child')
    // A proposer is never one of its own approvers: the frozen list is the two
    // neighbours, one upstream and one downstream.
    assert.deepEqual([...proposal.voters].sort(), [topology.entryNodeId, child.nodeId].sort(), 'both neighbours are approvers')

    // Both approvers vote at the same time, one from each direction.
    const [upstreamVote, downstreamVote] = await Promise.all([
      bench.kernel.ctx.atn.vote(host, { proposalId: proposal.proposalId, approve: true }),
      bench.kernel.ctx.atn.vote(childAgent, { proposalId: proposal.proposalId, approve: true }),
    ])
    assert.equal(downstreamVote.status, 'committed')
    const record = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(upstreamVote.status, 'committed', 'the last vote commits the proposal once')
    assert.equal(record.goalHistory.length, 2, 'exactly one new goal revision')
    assert.equal(record.goalHistory[1]!.version, 2)
    assert.equal(record.proposals[proposal.proposalId]!.votes.length, 2, 'every vote is retained')
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('CONCURRENCY-03: concurrent task mails keep every mail and task with unique ids', async () => {
  const bench = await boot()
  try {
    const { host, networkId } = await startNetwork(bench.kernel)
    const child = await bench.kernel.ctx.atn.spawn(host, { task: 'Child work.', context: '' })
    const childAgent = bench.kernel.ctx.agents.get(SessionId(child.sessionId))!

    const [assigned, noted] = await Promise.all([
      bench.kernel.ctx.atn.send(host, { to: child.nodeId, kind: 'task', body: 'Assigned work.' }),
      bench.kernel.ctx.atn.send(childAgent, { to: (await bench.kernel.ctx.atn.network(networkId)).entryNodeId, kind: 'note', body: 'Status note.' }),
    ])
    assert.notEqual(assigned.mailId, noted.mailId)

    const record = await bench.kernel.ctx.atn.network(networkId)
    const assignedTask = Object.values(record.tasks).find((task) => task.description === 'Assigned work.')!
    assert.equal(assignedTask.holderId, child.nodeId)
    assert.equal(record.mails[assigned.mailId]!.taskId, assignedTask.id)
    assert.equal(Object.values(record.mails).find((mail) => mail.body === 'Status note.')!.fromId, child.nodeId)
    const allocated = Object.keys(record.nodes).length + Object.keys(record.tasks).length + Object.keys(record.mails).length
    assert.equal(record.sequence, allocated, 'the record counter matches every allocated id')
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('CONCURRENCY-04: concurrent steps are bounded per node without consuming a peer budget', async () => {
  const bench = await boot()
  try {
    const { host, networkId } = await startNetwork(bench.kernel)
    const first = await bench.kernel.ctx.atn.spawn(host, { task: 'A work.', context: '' })
    const second = await bench.kernel.ctx.atn.spawn(host, { task: 'B work.', context: '' })

    await settle(bench.kernel)
    // Freeze each budget at one unit; previous real fixture calls are deliberately reset.
    await bench.store.update(networkId, (current) => ({ ...current, limits: { ...current.limits, stepBudget: 1 }, stepsUsed: 0,
      nodes: Object.fromEntries(Object.entries(current.nodes).map(([id, node]) => [id, { ...node, stepsUsed: 0 }])) }))
    const [a, b, duplicate] = await Promise.all([
      bench.kernel.ctx.atn.admitStep(networkId, first.sessionId),
      bench.kernel.ctx.atn.admitStep(networkId, second.sessionId),
      bench.kernel.ctx.atn.admitStep(networkId, first.sessionId),
    ])
    assert.deepEqual([a, b, duplicate], [true, true, false])
    const record = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(record.stepsUsed, 2, 'aggregate remains telemetry only')
    assert.equal(record.nodes[first.nodeId]!.stepsUsed, 1)
    assert.equal(record.nodes[second.nodeId]!.stepsUsed, 1)
    assert.equal(record.nodes[first.nodeId]!.lifecycle, 'retired')
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('CONCURRENCY: no committed write is built from a stale snapshot', async () => {
  const bench = await boot()
  try {
    const { host, networkId } = await startNetwork(bench.kernel)
    const seen: string[][] = []
    bench.store.updateHook = (next) => {
      seen.push(Object.keys(next.nodes).sort())
    }
    await Promise.all([
      bench.kernel.ctx.atn.spawn(host, { task: 'T1', context: '' }),
      bench.kernel.ctx.atn.spawn(host, { task: 'T2', context: '' }),
      bench.kernel.ctx.atn.spawn(host, { task: 'T3', context: '' }),
    ])
    const final = await bench.kernel.ctx.atn.network(networkId)
    assert.equal(Object.keys(final.nodes).length, 4, 'three children plus the entry node')
    assert.ok(seen.length >= 3, 'the concurrent writes really interleaved through the store')
    for (const nodes of seen) {
      assert.ok(nodes.includes('node-1'), `every committed write kept the entry node: ${nodes.join(',')}`)
    }
    for (let index = 1; index < seen.length; index += 1) {
      assert.ok(seen[index]!.length >= seen[index - 1]!.length, 'a later write never drops a node an earlier write created')
    }
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('CONCURRENCY-05: a concurrent result cannot be written past the completion gate', async () => {
  const bench = await boot()
  try {
    const { host, networkId } = await startNetwork(bench.kernel)
    const child = await bench.kernel.ctx.atn.spawn(host, { task: 'Child work.', context: '' })
    const childAgent = bench.kernel.ctx.agents.get(SessionId(child.sessionId))!
    const before = await bench.kernel.ctx.atn.network(networkId)
    const childTask = Object.values(before.tasks).find((task) => task.holderId === child.nodeId && task.status === 'open')!

    const [delivery, settlement] = await Promise.all([
      bench.kernel.ctx.atn.deliver(host, { summary: 'summary', evidence: [], goalVersion: 1 }),
      bench.kernel.ctx.atn.send(childAgent, {
        to: before.entryNodeId,
        kind: 'result',
        taskId: childTask.id,
        body: 'done',
        summary: 'child done',
      }),
    ])
    assert.equal(settlement.settledTaskId, childTask.id)

    const record = await bench.kernel.ctx.atn.network(networkId)
    if (delivery.accepted) {
      assert.equal(record.status, 'completed')
      assert.ok(
        Object.values(record.tasks).every((task) => task.status !== 'open'),
        'an accepted completion never leaves an open task behind',
      )
    } else {
      assert.equal(record.status, 'open')
      assert.ok(record.tasks[childTask.id]!.status !== 'open' || record.status === 'open')
    }
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})
