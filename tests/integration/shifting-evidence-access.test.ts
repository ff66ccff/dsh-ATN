/** Discovery/control metadata cannot replace the experiment's metered proof transport. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { installShiftingEvidenceAccess } from '../../experiments/shifting-evidence-access.ts'
import type { PublishKnowledgeInput } from '../../src/knowledge.ts'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'

const goal = { objective: 'Find the requested versioned evidence.', successCriteria: 'Return proof via mail or board.', constraints: 'Scripted decisions only.' }
const proof = 'witness-PRIVATE_PROOF'

async function withKernel(run: (kernel: Kernel) => Promise<void>) {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-evidence-access-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try { await run(kernel) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

async function setup(kernel: Kernel, workers = 3) {
  const host = await createHostAgent(kernel, 'access-host')
  const started = await kernel.atn.start(host, goal)
  const peers = []
  const hints = new Map<string, PublishKnowledgeInput>([[String(host.id), { documents: [], topics: ['phase-1'], contributions: [] }]])
  for (let index = 0; index < workers; index++) {
    const born = await kernel.atn.spawn(host, { task: `Lookup request ${index}.`, context: `PRIVATE_CONTEXT_${index}` })
    await settle(kernel)
    const agent = kernel.ctx.agents.get(SessionId(born.sessionId))!
    peers.push({ ...born, agent })
    hints.set(String(agent.id), { documents: [`phase-1:key-${index}`], topics: [`key-${index}`, 'phase-1'], contributions: [] })
  }
  installShiftingEvidenceAccess(kernel.atn, started.networkId, sessionId => hints.get(sessionId)!)
  return { host, started, peers, hints }
}

test('ACCESS-01: third parties cannot read result/context through tasks, discovery or control while actual requesters can review', async () => {
  await withKernel(async kernel => {
    const { host, started, peers } = await setup(kernel)
    const [holder, observer, departing] = peers
    await kernel.atn.send(holder.agent, { to: started.nodeId, kind: 'result', taskId: holder.taskId,
      body: proof, summary: proof, evidence: ['phase-1:key-0'] })
    await settle(kernel)
    await kernel.atn.feedback(host, { taskId: holder.taskId, status: 'accepted', summary: 'Reviewed actual result.',
      evidence: ['requester-check'], comparisonKey: proof })
    const own = await kernel.atn.tasks(host, [holder.taskId])
    assert.equal(own[0].result?.summary, proof)
    assert.equal(own[0].localFeedback?.status, 'accepted')
    assert.equal((await kernel.atn.tasks(holder.agent, [holder.taskId]))[0].result?.summary, proof)
    await assert.rejects(() => kernel.atn.tasks(observer.agent, [holder.taskId]), /only to the holder and requester/)
    await assert.rejects(() => kernel.atn.status(observer.agent, { taskIds: [holder.taskId] }), /only to the holder and requester/)

    await kernel.atn.rewire(observer.agent, { peers: [] })
    await kernel.atn.publishKnowledge(holder.agent, { documents: ['phase-1:key-0'], topics: ['key-0'], contributions: [] })
    const discovered = await kernel.atn.status(observer.agent, { query: 'key-0' })
    assert.equal(discovered.candidates?.[0], holder.nodeId)
    assert.equal(JSON.stringify(discovered).includes(proof), false)
    assert.ok(discovered.candidateNodes?.every(peer => peer.taskSummaries.length === 0 && peer.recentResults.length === 0))
    assert.deepEqual((await kernel.atn.peers(observer.agent, proof)).candidates, [])
    assert.deepEqual((await kernel.atn.peers(observer.agent, 'PRIVATE_CONTEXT_0')).candidates, [])
    assert.deepEqual((await kernel.atn.peers(observer.agent, 'Lookup request')).candidates, [])
    await assert.rejects(() => kernel.atn.rewire(observer.agent, {
      peers: [holder.nodeId], baselineTaskIds: [holder.taskId], candidateTaskIds: [holder.taskId],
    }), /requested by the calling node/)
    await assert.rejects(() => kernel.atn.finish(holder.agent, proof), /retirement is disabled/)

    const store = await kernel.atn.openStore()
    await store.update(started.networkId, current => ({ ...current, nodes: { ...current.nodes,
      [departing.nodeId]: { ...current.nodes[departing.nodeId], lifecycle: 'failed' } } }))
    const status = await kernel.atn.status(observer.agent, {})
    assert.deepEqual(status.orphanTasks, [])
    assert.equal(status.orphanTasksRemaining, 0)
    assert.equal(JSON.stringify(status).includes('PRIVATE_CONTEXT_2'), false)
    await assert.rejects(() => kernel.atn.status(observer.agent, { claimTaskId: departing.taskId }), /claiming is disabled/)
    await assert.rejects(() => kernel.atn.claim(observer.agent, departing.taskId), /claiming is disabled/)
  })
})

test('ACCESS-02: publication validates metadata and writes a canonical complete index; phase changes never invent publication', async () => {
  await withKernel(async kernel => {
    const { started, peers, hints } = await setup(kernel, 2)
    const [holder, observer] = peers
    await kernel.atn.rewire(observer.agent, { peers: [] })
    kernel.model.enqueue(holder.sessionId, [{ tool: 'atn_board', args: {
      action: 'publish', key: 'phase-1:private', body: proof, expectedRevision: 0, documents: ['phase-1:key-0'], topics: [proof],
    } }])
    await drive(holder.agent, 'Attempt to publish a proof through discovery.')
    await settle(kernel)
    assert.equal((await kernel.atn.network(started.networkId)).nodes[holder.nodeId].knowledgeFingerprint, undefined)
    const errors = holder.agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
      .map(event => (event.data as { message: { isError?: boolean } }).message.isError)
    assert.equal(errors.at(-1), true)
    await kernel.atn.publishKnowledge(holder.agent, { documents: [], topics: ['phase-1', 'phase-1'], contributions: [] })
    const published = (await kernel.atn.network(started.networkId)).nodes[holder.nodeId].knowledgeFingerprint!
    assert.deepEqual(published.documents, ['phase-1:key-0'])
    assert.deepEqual(published.topics, ['key-0', 'phase-1'])
    assert.deepEqual(published.contributions, [])
    assert.deepEqual((await kernel.atn.peers(observer.agent, 'key-0')).candidates, [holder.nodeId])
    hints.set(holder.sessionId, { documents: ['phase-2:key-9'], topics: ['key-9', 'phase-2'], contributions: [] })
    assert.deepEqual((await kernel.atn.peers(observer.agent, 'key-9')).candidates, [], 'old publication does not reveal new owned keys')
    assert.deepEqual((await kernel.atn.peers(observer.agent, 'key-0')).candidates, [], 'stale ownership metadata is hidden')
    await kernel.atn.publishKnowledge(holder.agent, hints.get(holder.sessionId)!)
    assert.deepEqual((await kernel.atn.peers(observer.agent, 'key-9')).candidates, [holder.nodeId])
    await assert.rejects(() => kernel.atn.publishKnowledge(holder.agent, { documents: [], topics: [], contributions: [proof] }), /Discovery accepts only/)
  })
})

test('ACCESS-04: board discovery metadata is canonical while proof bodies stay on the metered board', async () => {
  await withKernel(async kernel => {
    const { peers, started, hints } = await setup(kernel, 2)
    const [holder, observer] = peers
    await kernel.atn.rewire(observer.agent, { peers: [] })
    await assert.rejects(() => kernel.atn.board(holder.agent, { action: 'publish', key: 'phase-1:proof', expectedRevision: 0,
      body: proof, documents: [proof] }), /Board discovery accepts only/)
    await kernel.atn.board(holder.agent, { action: 'publish', key: 'phase-1:proof', expectedRevision: 0,
      body: proof, documents: [], topics: ['phase-1'] })
    const discovered = await kernel.atn.status(observer.agent, { query: 'key-0' })
    assert.deepEqual(discovered.candidates, [holder.nodeId])
    assert.equal(JSON.stringify(discovered).includes(proof), false)
    assert.deepEqual((await kernel.atn.peers(observer.agent, proof)).candidates, [])
    const board = await kernel.atn.board(observer.agent, { action: 'read', key: 'phase-1:proof' })
    assert.ok(board.action === 'read')
    assert.equal(board.entries[0].body, proof)
    assert.deepEqual(board.entries[0].documents, hints.get(holder.sessionId)!.documents)
    assert.ok((await kernel.atn.network(started.networkId)).whiteboard!.usage.readBytes > 0)
  })
})

test('ACCESS-03: wildcard discovery stays bounded and rotates independently of text queries; caller authentication stays intact', async () => {
  await withKernel(async kernel => {
    const { host, peers, hints } = await setup(kernel, 5)
    await kernel.atn.rewire(host, { peers: [] })
    for (const peer of peers) await kernel.atn.publishKnowledge(peer.agent, hints.get(peer.sessionId)!)
    const first = await kernel.atn.peers(host, '*')
    assert.equal(first.candidates?.length, 3)
    const byText = await kernel.atn.peers(host, 'key-4')
    assert.equal(byText.candidates?.[0], peers[4].nodeId)
    const second = await kernel.atn.peers(host, '*')
    assert.equal(second.candidates?.length, 3)
    assert.equal(new Set([...first.candidates!, ...second.candidates!]).size, 5)
    assert.equal(first.candidates?.includes(second.candidates![0]), false, 'text search does not consume the public wildcard cursor')
    const forged = { id: host.id } as Agent
    await assert.rejects(() => kernel.atn.peers(forged, '*'), /not the live agent/)
    await assert.rejects(() => kernel.atn.tasks(forged), /not the live agent/)
    await assert.rejects(() => kernel.atn.publishKnowledge(forged, hints.get(String(host.id))!), /not the live agent/)
    const outsider = await createHostAgent(kernel, 'access-outsider')
    await assert.rejects(() => kernel.atn.status(outsider, {}), /not part of an ATN network/)
    await assert.rejects(() => kernel.atn.finish(outsider), /not part of an ATN network/)
  })
})
