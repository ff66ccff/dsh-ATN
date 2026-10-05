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
import { goalSnapshotMessage } from '../../src/messages.ts'
import type { GoalRevision } from '../../src/schema.ts'

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
      document: { ...goal, plan: 'Replayed work plan.' },
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
    b.kernel.model.enqueue(leaf.sessionId, [{ tool: 'atn_status', args: {} }])
    await drive(resumedAgent, 'continue after recovery')
    await settle(b.kernel)
    const snapshots = atnMessages(resumedAgent).filter((text) => text.includes('version=2'))
    assert.ok(snapshots.length >= 1, 'the replayed snapshot reached the node input')
    assert.ok(snapshots[0]!.includes('Replayed work plan.'), 'the snapshot carries the committed plan')

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

test('RECOVER-GOVERNANCE: an already-read legacy revision receives the initial contract once after cold recovery', async () => {
  const b = await bench()
  try {
    const host = await createHostAgent(b.kernel, 'session-host')
    const started = await b.kernel.atn.start(host, goal)
    const child = await b.kernel.atn.spawn(host, { task: 'Review the durable contract.', context: '' })
    await settle(b.kernel)
    const childAgent = b.kernel.ctx.agents.get(SessionId(child.sessionId))!
    const legacy: GoalRevision = {
      version: 2,
      document: {
        objective: 'Legacy replacement objective.',
        successCriteria: 'Legacy relaxed criteria.',
        constraints: '',
        plan: 'Compare independent evidence before selecting a result.',
      },
      proposedBy: started.nodeId,
      approvedBy: [child.nodeId],
      committedAt: 1_000_000,
    }
    // Log the exact pre-upgrade marker/body before installing the legacy
    // durable revision, so ordinary runtime sync cannot supplement it early.
    childAgent.inject(goalSnapshotMessage(legacy, started.networkId))
    await drive(childAgent, 'Read the legacy revision.')
    await settle(b.kernel)
    await b.kernel.ctx.sessions.flush(childAgent.session)
    assert.ok(atnMessages(childAgent).some(text => text.includes('version=2') && text.includes(legacy.document.objective)))
    const old = await b.store.update(started.networkId, record => ({
      ...record,
      goalHistory: [...record.goalHistory, legacy],
      nodes: { ...record.nodes, [child.nodeId]: { ...record.nodes[child.nodeId]!, lastGoalVersionSent: 2 } },
    }))
    await b.kernel.ctx.fiber.dispose()
    b.kernel = await bootKernel(b.scratch, { store: b.store, clock: () => 1_000_000, cleanupTimeoutMs: 50 })
    await b.kernel.atn.recover()
    await settle(b.kernel)

    const resumed = b.kernel.ctx.agents.get(SessionId(child.sessionId))!
    const supplements = () => atnMessages(resumed).filter(text => text.split('\n')[0].includes('version=2 contract=initial'))
    assert.equal(supplements().length, 1, 'the old same-version receipt cannot suppress the contract supplement')
    for (const value of [goal.objective, goal.successCriteria, goal.constraints, legacy.document.plan!]) {
      assert.ok(supplements()[0].includes(value), `supplement includes ${value}`)
    }
    assert.ok(!supplements()[0].includes(legacy.document.objective), 'the effective snapshot does not present a weakened legacy field as authoritative')
    assert.ok(atnMessages(resumed).some(text => text.includes(legacy.document.objective)), 'the old log is retained for audit')
    const recovered = await b.kernel.atn.network(started.networkId)
    assert.deepEqual(recovered.goalHistory, old.goalHistory, 'recovery does not fabricate a vote or rewrite committed history')
    assert.equal(recovered.nodes[child.nodeId].lastGoalVersionSent, 2)

    await b.kernel.atn.recover()
    await settle(b.kernel)
    assert.equal(supplements().length, 1, 'the supplemental marker deduplicates later recovery')

    const newcomer = await b.kernel.atn.spawn(resumed, { task: 'Join after upgrade.', context: '' })
    await settle(b.kernel)
    const newcomerAgent = b.kernel.ctx.agents.get(SessionId(newcomer.sessionId))!
    const firstSnapshot = atnMessages(newcomerAgent).find(text => text.startsWith('[ATN shared goal]'))!
    assert.ok(firstSnapshot.includes('version=2 contract=initial'))
    assert.ok(firstSnapshot.includes(goal.constraints), 'new nodes also receive the original constraints')
    assert.ok(!firstSnapshot.includes(legacy.document.objective))
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
