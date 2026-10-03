/**
 * RECOVER/CONTEXT: a goal commit that happened while a node had no live Agent
 * must be replayed after recovery, exactly once.
 * @module dsh-atn/tests/integration/recover
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, atnMessages, type Kernel } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { currentGoal } from '../../src/domain.ts'

const goal = {
  objective: 'Replay an unread goal revision.',
  successCriteria: 'Every live node reads the current revision exactly once.',
  constraints: 'Deterministic clock only.',
}

interface Bench {
  kernel: Kernel
  store: MemoryNetworkStore
  scratch: string
}

async function bench(): Promise<Bench> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-recover-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000, cleanupTimeoutMs: 50 })
  return { kernel, store, scratch }
}

test('RECOVER-CONTEXT-01: a revision committed without a live Agent is replayed once', async () => {
  const b = await bench()
  try {
    // A three-node chain: entry -> parent -> leaf.
    const host = await createHostAgent(b.kernel, 'session-host')
    b.kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Parent work.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(b.kernel)
    const networkId = (await b.kernel.ctx.atn.networkIds())[0]!
    const opening = await b.kernel.ctx.atn.network(networkId)
    const parent = Object.values(opening.nodes).find((node) => !node.isEntry)!
    const parentAgent = b.kernel.ctx.agents.get(SessionId(parent.sessionId))!
    const spawned = await b.kernel.ctx.atn.spawn(parentAgent, { task: 'Leaf work.', context: '' })
    let record = await b.kernel.ctx.atn.network(networkId)
    const leaf = record.nodes[spawned.nodeId]!
    assert.equal(leaf.lastGoalVersionSent, 1, 'the leaf read v1 while it was live')

    // The middle node proposes; its frozen approvers are the entry node and the
    // leaf, so one consent is not enough.
    const proposal = await b.kernel.ctx.atn.propose(parentAgent, {
      document: { ...goal, objective: 'Replayed objective.' },
      rationale: 'revise',
    })
    assert.deepEqual([...proposal.voters].sort(), [record.entryNodeId, leaf.id].sort())
    const leafAgent = b.kernel.ctx.agents.get(SessionId(leaf.sessionId))!
    const pending = await b.kernel.ctx.atn.vote(leafAgent, { proposalId: proposal.proposalId, approve: true })
    assert.equal(pending.status, 'pending', 'one consent is not unanimity')

    // Take the leaf's live Agent away before the committing vote: that is the
    // node which cannot be told about v2 at commit time.
    const runtime = b.kernel.ctx.atn as unknown as { handles: Map<string, AgentHandle> }
    const handle = runtime.handles.get(leaf.sessionId)!
    await handle.dispose()
    runtime.handles.delete(leaf.sessionId)
    assert.equal(b.kernel.ctx.atn.ownsHandle(leaf.id), false)

    await b.kernel.ctx.atn.vote(host, { proposalId: proposal.proposalId, approve: true })
    record = await b.kernel.ctx.atn.network(networkId)
    assert.equal(record.goalHistory.length, 2, 'v2 is committed')
    assert.equal(currentGoal(record).version, 2)
    assert.equal(record.nodes[leaf.id]!.lastGoalVersionSent, 1, 'the offline leaf still owes v2')

    const report = await b.kernel.ctx.atn.recover()
    const resumed = report.find((entry) => entry.nodeId === leaf.id)
    assert.equal(resumed?.action, 'resume', 'recovery rebuilt the offline node')

    record = await b.kernel.ctx.atn.network(networkId)
    assert.equal(record.nodes[leaf.id]!.lastGoalVersionSent, 2, 'the committed revision is now recorded as read')

    // The node's next model request carries the replayed revision.
    const resumedAgent = b.kernel.ctx.agents.get(SessionId(leaf.sessionId))!
    b.kernel.model.enqueue(leaf.sessionId, [{ tool: 'atn_peers', args: {} }])
    await drive(resumedAgent, 'continue after recovery')
    await settle(b.kernel)
    const snapshots = atnMessages(resumedAgent).filter((text) => text.includes('version=2'))
    assert.ok(snapshots.length >= 1, 'the replayed snapshot reached the node input')
    assert.ok(snapshots[0]!.includes('Replayed objective.'), 'the snapshot carries the committed body')

    // A second recovery pass must not create a second handle or snapshot.
    const seen = snapshots.length
    const second = await b.kernel.ctx.atn.recover()
    const untouched = second.find((entry) => entry.nodeId === leaf.id)
    assert.equal(untouched?.action, 'leave', 'an already activated session is left alone')
    const stillSeen = atnMessages(resumedAgent).filter((text) => text.includes('version=2'))
    assert.equal(stillSeen.length, seen, 'recovery appends no duplicate goal context')
    assert.equal(b.kernel.ctx.atn.ownsHandle(leaf.id), true, 'the resumed handle is preserved')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('RECOVER-CONTEXT-02: a node that already read the revision is not appended twice', async () => {
  const b = await bench()
  try {
    const host = await createHostAgent(b.kernel, 'session-host')
    b.kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Child work.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(b.kernel)
    const networkId = (await b.kernel.ctx.atn.networkIds())[0]!
    const record = await b.kernel.ctx.atn.network(networkId)
    const child = Object.values(record.nodes).find((node) => !node.isEntry)!
    const childAgent = b.kernel.ctx.agents.get(SessionId(child.sessionId))!
    const before = atnMessages(childAgent).filter((text) => text.includes('version=1')).length
    assert.ok(before >= 1, 'the child read v1 once')

    // The node still has a live handle, so recovery leaves it alone and appends
    // nothing: the same revision/session pair is never synced twice.
    const report = await b.kernel.ctx.atn.recover()
    const decision = report.find((entry) => entry.nodeId === child.id)
    assert.equal(decision?.action, 'leave')
    const after = atnMessages(childAgent).filter((text) => text.includes('version=1')).length
    assert.equal(after, before, 'no duplicate goal snapshot was appended')
    assert.ok(b.kernel.ctx.atn.ownsHandle(child.id), 'the existing handle is preserved')
    assert.equal(b.kernel.ctx.agents.get(SessionId(child.sessionId)), childAgent, 'the same live Agent is kept')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('RECOVER-CONTEXT-03: recovery never reopens a terminal network', async () => {
  const b = await bench()
  try {
    const host = await createHostAgent(b.kernel, 'session-host')
    b.kernel.model.enqueue('session-host', [{ tool: 'atn_start', args: goal }])
    await drive(host, 'start')
    await settle(b.kernel)
    const networkId = (await b.kernel.ctx.atn.networkIds())[0]!
    await b.kernel.ctx.atn.stop(networkId, 'stopped before recovery')
    const report = await b.kernel.ctx.atn.recover()
    const entry = report.find((candidate) => candidate.networkId === networkId)
    assert.equal(entry, undefined, 'a stopped network produces no recovery decision')
    const after = await b.kernel.ctx.atn.network(networkId)
    assert.equal(after.status, 'stopped')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})
