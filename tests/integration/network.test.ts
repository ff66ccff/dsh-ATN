/**
 * One vertical ATN path through the real kernel: start, create a chain, settle
 * local tasks, change the shared document by unanimous consent, and complete
 * with a delivery that the runtime refuses until the network is settled.
 * @module dsh-atn/tests/integration/network
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, atnMessages, type Kernel } from '../fixtures/kernel.ts'
import type { NetworkRecord } from '../../src/schema.ts'

const goal = {
  objective: 'Establish the vertical path.',
  successCriteria: 'Every step is proven by a real kernel interaction.',
  constraints: 'No paid models.',
}

const revised = {
  ...goal,
  plan: 'Prove every step including the shared plan change.',
}

async function withKernel(run: (kernel: Kernel) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-network-'))
  let kernel: Kernel | undefined
  try {
    kernel = await bootKernel(scratch)
    await run(kernel)
  } finally {
    await kernel?.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

function nodeByCreator(record: NetworkRecord, creatorId: string): NetworkRecord['nodes'][string] {
  const node = Object.values(record.nodes).find((candidate) => candidate.creatorId === creatorId)
  assert.ok(node !== undefined, `a child of ${creatorId} exists`)
  return node
}

test('M3/DELIVERY: the full path commits one goal revision and completes the network', async () => {
  await withKernel(async (kernel) => {
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Node B local work.', context: 'from the entry node' } },
    ])
    await drive(host, 'start the network and create node B')
    await settle(kernel)

    const networkId = (await kernel.ctx.atn.networkIds())[0]!
    let record = await kernel.ctx.atn.network(networkId)
    const entryId = record.entryNodeId
    const nodeB = nodeByCreator(record, entryId)
    assert.equal(nodeB.lifecycle, 'active')

    // B creates C through a real model call.
    kernel.model.enqueue(nodeB.sessionId, [
      { tool: 'atn_spawn', args: { task: 'Node C local work.', context: 'from node B' } },
    ])
    await drive(kernel.ctx.agents.get(SessionId(nodeB.sessionId))!, 'create node C')
    await settle(kernel)

    record = await kernel.ctx.atn.network(networkId)
    const nodeC = nodeByCreator(record, nodeB.id)
    const taskC = Object.values(record.tasks).find((task) => task.holderId === nodeC.id && task.status === 'open')!

    // C reports its result to B: only its own task may be settled.
    kernel.model.enqueue(nodeC.sessionId, [
      { tool: 'atn_send', args: { to: nodeB.id, kind: 'result', taskId: taskC.id, body: 'C is done.', summary: 'C completed its local work.', evidence: ['session-c'] } },
    ])
    await drive(kernel.ctx.agents.get(SessionId(nodeC.sessionId))!, 'report the local result')
    await settle(kernel)

    record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.tasks[taskC.id]!.status, 'completed', 'C settled its own task')
    assert.equal(record.tasks[taskC.id]!.settledBy, nodeC.id)
    assert.deepEqual(record.tasks[taskC.id]!.result!.evidence, ['session-c'])

    // B settles its own task and opens a proposal on the shared document.
    const taskB = Object.values(record.tasks).find((task) => task.holderId === nodeB.id && task.status === 'open')!
    kernel.model.enqueue(nodeB.sessionId, [
      { tool: 'atn_send', args: { to: entryId, kind: 'result', taskId: taskB.id, body: 'B is done.', summary: 'B completed its local work.', evidence: ['session-b'] } },
    ])
    await drive(kernel.ctx.agents.get(SessionId(nodeB.sessionId))!, 'report and propose')
    await settle(kernel)
    await kernel.atn.propose(kernel.ctx.agents.get(SessionId(nodeB.sessionId))!, { document: revised, rationale: 'Host-managed plan revision.' })

    record = await kernel.ctx.atn.network(networkId)
    const proposal = Object.values(record.proposals)[0]!
    assert.equal(proposal.status, 'pending')
    assert.deepEqual([...proposal.voters].sort(), [entryId, nodeC.id].sort(), 'every other active participant reviews the shared plan')

    // C consents; the entry node has not voted yet, so nothing commits.
    await kernel.atn.vote(kernel.ctx.agents.get(SessionId(nodeC.sessionId))!, { proposalId: proposal.id, approve: true, reason: 'agreed' })
    await settle(kernel)

    record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.proposals[proposal.id]!.status, 'pending', 'one consent is not unanimity')
    assert.equal(record.goalHistory.length, 1)

    // The entry node consents: the document now commits exactly once.
    const requestsBefore = kernel.model.requests.filter((request) => request.sessionId === nodeB.sessionId).length
    await kernel.atn.vote(host, { proposalId: proposal.id, approve: true, reason: 'agreed' })
    await settle(kernel)

    record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.proposals[proposal.id]!.status, 'committed')
    assert.equal(record.goalHistory.length, 2, 'exactly one new goal version')
    assert.equal(record.goalHistory[1]!.version, 2)
    assert.deepEqual(record.goalHistory[1]!.approvedBy.slice().sort(), [entryId, nodeC.id].sort())

    // CONTEXT-03: syncing the new version does not wake an idle node.
    assert.equal(
      kernel.model.requests.filter((request) => request.sessionId === nodeB.sessionId).length,
      requestsBefore,
      'B was not woken by the goal-version sync',
    )

    // CONTEXT-01: B's next real request carries the new version, replayably.
    kernel.model.enqueue(nodeB.sessionId, [{ tool: 'atn_status', args: {} }])
    await drive(kernel.ctx.agents.get(SessionId(nodeB.sessionId))!, 'report neighbours')
    await settle(kernel)
    const bTexts = atnMessages(kernel.ctx.agents.get(SessionId(nodeB.sessionId))!)
    assert.ok(bTexts.some((text) => text.includes('version=2') && text.includes(revised.plan)), 'B can replay plan v2')

    // An early delivery against the old version is refused.
    kernel.model.enqueue('session-host', [
      { tool: 'atn_finish', args: { scope: 'network', summary: 'stale summary', evidence: ['old'], goalVersion: 1 } },
    ])
    await drive(host, 'try to deliver against the old version')
    await settle(kernel)
    record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.status, 'open', 'a delivery against an old version cannot complete the network')

    // The current version can complete it, and releases the ATN-owned nodes.
    kernel.model.enqueue('session-host', [
      { tool: 'atn_finish', args: { scope: 'network', summary: 'Everything is done and verified.', evidence: ['session-b', 'session-c'], goalVersion: 2 } },
    ])
    await drive(host, 'deliver the final result')
    await settle(kernel)

    record = await kernel.ctx.atn.network(networkId)
    assert.equal(record.status, 'completed')
    assert.equal(record.tasks[Object.keys(record.tasks)[0]!].status !== 'open', true)

    assert.equal(kernel.ctx.atn.handleFor(nodeB.id), undefined, 'B was released on completion')
    assert.equal(kernel.ctx.atn.handleFor(nodeC.id), undefined, 'C was released on completion')
    assert.equal(kernel.ctx.agents.get(SessionId('session-host')), host, 'the host entry agent survives completion')
    assert.ok(
      atnMessages(host).some((text) => text.includes('version=2')),
      'the entry node can replay the committed revision it was told about',
    )
  })
})

test('DELIVERY-01: an early delivery is refused while another node still holds work', async () => {
  await withKernel(async (kernel) => {
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Node B local work.', context: '' } },
      { tool: 'atn_finish', args: { scope: 'network', summary: 'early', evidence: [], goalVersion: 1 } },
    ])
    await drive(host, 'start, spawn and try to finish early')
    await settle(kernel)

    const record = await kernel.ctx.atn.network((await kernel.ctx.atn.networkIds())[0]!)
    assert.equal(record.status, 'open')
    assert.ok(Object.values(record.tasks).some((task) => task.status === 'open'), 'the spawned node still holds its task')
  })
})

test('MAIL-04: queued, delivered and completed are separate facts on the wire', async () => {
  await withKernel(async (kernel) => {
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Node B local work.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(kernel)

    const record = await kernel.ctx.atn.network((await kernel.ctx.atn.networkIds())[0]!)
    const nodeB = nodeByCreator(record, record.entryNodeId)

    // A task request creates the task and its mail in one update; the task stays open.
    kernel.model.enqueue('session-host', [
      { tool: 'atn_send', args: { to: nodeB.id, kind: 'task', body: 'Second piece of work for B.' } },
    ])
    await drive(host, 'assign a second task')
    await settle(kernel)
    await kernel.ctx.atn.tick() // Confirm the newly admitted user-message receipt.

    const after = await kernel.ctx.atn.network(record.id)
    const second = Object.values(after.tasks).find((task) => task.description === 'Second piece of work for B.')!
    assert.equal(second.status, 'open', 'delivery of the request is not completion of the task')
    const mail = Object.values(after.mails).find((entry) => entry.taskId === second.id)!
    assert.equal(mail.status, 'delivered', 'the request reached the target input')
    assert.equal(mail.fromId, record.entryNodeId, 'the sender is the real caller')
  })
})

test('TOPO-02/VOTE-03: new branches join free collaboration slots without rewriting lineage', async () => {
  await withKernel(async (kernel) => {
    const host = await createHostAgent(kernel, 'session-host')
    kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Node B local work.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(kernel)
    const record = await kernel.ctx.atn.network((await kernel.ctx.atn.networkIds())[0]!)
    const nodeB = nodeByCreator(record, record.entryNodeId)

    // B's first child keeps the selected-child birth record.
    kernel.model.enqueue(nodeB.sessionId, [
      { tool: 'atn_spawn', args: { task: 'Node C local work.', context: 'selected branch' } },
    ])
    await drive(kernel.ctx.agents.get(SessionId(nodeB.sessionId))!, 'create the selected child')
    await settle(kernel)

    // A second child joins a free collaboration slot despite being off the selected path.
    kernel.model.enqueue(nodeB.sessionId, [
      { tool: 'atn_spawn', args: { task: 'Node X local work.', context: 'other branch' } },
    ])
    await drive(kernel.ctx.agents.get(SessionId(nodeB.sessionId))!, 'branch out and propose')
    await settle(kernel)
    await kernel.atn.propose(kernel.ctx.agents.get(SessionId(nodeB.sessionId))!, { document: revised, rationale: 'consult current collaborators' })

    const after = await kernel.ctx.atn.network(record.id)
    const children = Object.values(after.nodes).filter((node) => node.creatorId === nodeB.id)
    assert.equal(children.length, 2, 'B has two children')
    assert.equal(after.nodes[nodeB.id]!.selectedChildId, children[0]!.id, 'the first published child keeps the slot')

    const proposal = Object.values(after.proposals)[0]!
    assert.equal(proposal.voters.length, 3, 'the frozen list holds every other active participant')
    for (const child of children) {
      assert.ok(
        proposal.voters.includes(child.id),
        `${child.id} is an approver because it is an active participant`,
      )
    }
  })
})
