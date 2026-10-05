/** Real-kernel coverage of discovery, directed rewiring, obligations and recovery. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, atnMessages, type Kernel } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import type { PeersResult, SendResult, SpawnResult, StartResult } from '../../src/runtime.ts'

const goal = {
  objective: 'Find useful collaborators and adapt the graph as evidence changes.',
  successCriteria: 'Sibling branches collaborate through chosen edges and keep their existing obligations.',
  constraints: 'Scripted model decisions; real kernel, tools, sessions and storage.',
}

async function withKernel(run: (kernel: Kernel) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-adaptive-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try { await run(kernel) }
  finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

/** Execute the actual registered tool and inspect its persisted result. */
async function call<T>(kernel: Kernel, agent: Agent, tool: string, args: Record<string, unknown>): Promise<T> {
  kernel.model.enqueue(agent.id, [{ tool, args }])
  await drive(agent, `Run ${tool}.`)
  await settle(kernel)
  const event = agent.session.snapshotEvents().filter(row => row.type === 'tool/result').at(-1)
  assert.ok(event, `${tool} wrote a tool result`)
  const message = (event.data as { message: { isError?: boolean; content: readonly { text?: string }[] } }).message
  assert.notEqual(message.isError, true, `${tool}: ${JSON.stringify(message.content)}`)
  return JSON.parse(message.content.map(block => block.text ?? '').join('')) as T
}

async function start(kernel: Kernel): Promise<{ host: Agent; networkId: string; entryId: string }> {
  const host = await createHostAgent(kernel, 'session-host')
  const started = await kernel.atn.start(host, goal)
  return { host, networkId: started.networkId, entryId: started.nodeId }
}

async function spawn(kernel: Kernel, creator: Agent, task: string): Promise<SpawnResult & { agent: Agent }> {
  const born = await kernel.atn.spawn(creator, { task, context: '' })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(born.sessionId))
  assert.ok(agent, 'the published child has a live agent')
  return { ...born, agent }
}

test('ADAPTIVE-01: real tools discover a sibling branch, collaborate, then rewire using the result', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'session-host')
    const started = await call<StartResult>(kernel, host, 'atn_start', goal)
    const left = await spawn(kernel, host, 'Investigate parsing.')
    const right = await spawn(kernel, host, 'Investigate routing regressions.')
    const parser = await spawn(kernel, left.agent, 'Diagnose malformed packet checksums.')
    const benchmark = await spawn(kernel, right.agent, 'Benchmark packet validation.')
    const before = await kernel.atn.network(started.networkId)
    assert.ok(!(await kernel.atn.peers(parser.agent)).neighbours.includes(benchmark.nodeId), 'the sibling leaf is outside the initial graph')

    const discovery = await call<PeersResult>(kernel, parser.agent, 'atn_status', { query: '*' })
    assert.ok(discovery.candidates?.includes(benchmark.nodeId), 'exploration reaches the sibling branch')
    assert.ok(discovery.candidateNodes?.find(node => node.id === benchmark.nodeId)?.taskSummaries.some(text => text.includes('Benchmark packet validation')))
    await call(kernel, parser.agent, 'atn_rewire', { peers: [benchmark.nodeId] })
    const assigned = await call<SendResult>(kernel, parser.agent, 'atn_send', {
      to: benchmark.nodeId, kind: 'task', body: 'Compare the checksum failure with the packet benchmark.', messageId: 'cross-branch-task',
    })
    assert.ok(assigned.settledTaskId)
    await call(kernel, benchmark.agent, 'atn_send', {
      to: parser.nodeId, kind: 'result', taskId: assigned.settledTaskId,
      body: 'Checksum code passes; investigate routing.', summary: 'The benchmark isolates a routing regression.', evidence: ['benchmark:packet-17'],
    })

    const feedback = await call<PeersResult>(kernel, parser.agent, 'atn_status', { query: 'routing' })
    assert.ok(feedback.nodes.find(node => node.id === benchmark.nodeId)?.recentResults.some(text => text.includes('isolates a routing regression')))
    assert.ok(feedback.candidateNodes?.find(node => node.id === right.nodeId)?.taskSummaries.some(text => text.includes('routing regressions')))
    await call(kernel, parser.agent, 'atn_rewire', { peers: [right.nodeId] })
    const followup = await call<SendResult>(kernel, parser.agent, 'atn_send', {
      to: right.nodeId, kind: 'task', body: 'Trace the routing regression identified by the benchmark.',
    })

    const after = await kernel.atn.network(started.networkId)
    assert.deepEqual((await kernel.atn.peers(parser.agent)).neighbours, [right.nodeId])
    assert.equal(after.tasks[assigned.settledTaskId]!.status, 'completed')
    assert.deepEqual(after.tasks[assigned.settledTaskId]!.result!.evidence, ['benchmark:packet-17'])
    assert.equal(after.tasks[followup.settledTaskId!]!.requesterId, parser.nodeId)
    assert.equal(after.tasks[followup.settledTaskId!]!.holderId, right.nodeId)
    assert.equal(after.nodes[parser.nodeId]!.creatorId, left.nodeId, 'rewiring preserves birth origin')
    assert.deepEqual(after.nodes[benchmark.nodeId]!.peerIds, before.nodes[benchmark.nodeId]!.peerIds, 'choosing a peer never changes its outgoing edges')
    assert.ok(kernel.model.toolSets.filter(row => row.sessionId === parser.sessionId).every(row => row.tools.includes('atn_rewire')), 'workers receive the same rewiring capability')
  })
})

test('ADAPTIVE-02: outgoing edges admit new work, while disconnected tasks retain only their own conversation and result', async () => {
  await withKernel(async kernel => {
    const { host, entryId, networkId } = await start(kernel)
    const requester = await spawn(kernel, host, 'Requester initial work.')
    const worker = await spawn(kernel, host, 'Worker initial work.')
    await kernel.atn.rewire(worker.agent, { peers: [] })
    await kernel.atn.rewire(requester.agent, { peers: [worker.nodeId] })
    assert.deepEqual((await kernel.atn.peers(worker.agent)).neighbours, [], 'incoming edges confer no outgoing permission')
    for (const kind of ['task', 'note'] as const) {
      await assert.rejects(() => kernel.atn.send(worker.agent, { to: requester.nodeId, kind, body: 'An unsolicited reverse message.' }))
    }
    const task = await kernel.atn.send(requester.agent, { to: worker.nodeId, kind: 'task', body: 'Joint investigation.' })
    assert.ok(task.settledTaskId)
    await kernel.atn.rewire(requester.agent, { peers: [] })
    const disconnected = await kernel.atn.network(networkId)
    for (const kind of ['task', 'note'] as const) {
      await assert.rejects(() => kernel.atn.send(requester.agent, { to: worker.nodeId, kind, body: 'Unrelated new work.' }))
    }
    const initialTask = Object.values(disconnected.tasks).find(row => row.holderId === requester.nodeId)!
    await assert.rejects(() => kernel.atn.send(requester.agent, { to: worker.nodeId, kind: 'note', taskId: initialTask.id, body: 'An unrelated task cannot authorize this edge.' }))
    await assert.rejects(() => kernel.atn.send(requester.agent, { to: worker.nodeId, kind: 'note', taskId: 'missing-task', body: 'A made-up task cannot authorize this edge.' }))
    assert.equal(Object.keys((await kernel.atn.network(networkId)).mails).length, Object.keys(disconnected.mails).length, 'rejections create no mail')

    await kernel.atn.send(requester.agent, { to: worker.nodeId, kind: 'note', taskId: task.settledTaskId, body: 'Clarification on our existing task.' })
    await kernel.atn.send(worker.agent, { to: requester.nodeId, kind: 'note', taskId: task.settledTaskId, body: 'Answer to the clarification.' })
    await assert.rejects(() => kernel.atn.send(worker.agent, {
      to: entryId, kind: 'result', taskId: task.settledTaskId!, body: 'Wrong recipient.', summary: 'Must return to requester.',
    }))
    assert.equal((await kernel.atn.network(networkId)).tasks[task.settledTaskId]!.status, 'open')
    const result = await kernel.atn.send(worker.agent, {
      to: requester.nodeId, kind: 'result', taskId: task.settledTaskId, body: 'Finished.', summary: 'Joint investigation complete.',
    })
    assert.equal(result.settledTaskId, task.settledTaskId)
    await assert.rejects(() => kernel.atn.send(worker.agent, { to: requester.nodeId, kind: 'note', taskId: task.settledTaskId!, body: 'The closed task no longer grants an edge.' }))
    await kernel.atn.send(worker.agent, { to: worker.nodeId, kind: 'note', body: 'Self notes remain available.' })
  })
})

test('ADAPTIVE-03: stable task, note and result retries survive disconnection without duplicate obligations', async () => {
  await withKernel(async kernel => {
    const { host, entryId, networkId } = await start(kernel)
    const worker = await spawn(kernel, host, 'Initial work.')
    const taskInput = { to: worker.nodeId, kind: 'task' as const, body: 'Retryable work.', messageId: 'retry-task' }
    const noteInput = { to: worker.nodeId, kind: 'note' as const, body: 'Retryable note.', messageId: 'retry-note' }
    const task = await kernel.atn.send(host, taskInput)
    const note = await kernel.atn.send(host, noteInput)
    await kernel.atn.rewire(host, { peers: [] })
    await kernel.atn.rewire(worker.agent, { peers: [] })
    const before = await kernel.atn.network(networkId)
    for (const [input, original] of [[taskInput, task], [noteInput, note]] as const) {
      const retry = await kernel.atn.send(host, input)
      assert.equal(retry.duplicate, true)
      assert.equal(retry.mailId, original.mailId)
      await assert.rejects(() => kernel.atn.send(host, { ...input, body: 'Changed content.' }), /cannot be reused/i)
    }
    const after = await kernel.atn.network(networkId)
    assert.equal(Object.keys(after.tasks).length, Object.keys(before.tasks).length)
    assert.equal(Object.keys(after.mails).length, Object.keys(before.mails).length)
    const resultInput = {
      to: entryId, kind: 'result' as const, taskId: task.settledTaskId!, body: 'Done.', summary: 'Retryable work done.', messageId: 'retry-result',
    }
    const result = await kernel.atn.send(worker.agent, resultInput)
    const settled = await kernel.atn.network(networkId)
    const retry = await kernel.atn.send(worker.agent, resultInput)
    assert.equal(retry.duplicate, true)
    assert.equal(retry.mailId, result.mailId)
    assert.deepEqual((await kernel.atn.network(networkId)).tasks[task.settledTaskId!], settled.tasks[task.settledTaskId!])
    assert.equal(Object.keys((await kernel.atn.network(networkId)).mails).length, Object.keys(settled.mails).length)
  })
})

test('ADAPTIVE-04: rewiring cannot narrow future governance or change an already frozen vote', async () => {
  await withKernel(async kernel => {
    const { host, entryId, networkId } = await start(kernel)
    const proposer = await spawn(kernel, host, 'Propose a better goal.')
    const voter = await spawn(kernel, host, 'Review evidence.')
    await kernel.atn.rewire(proposer.agent, { peers: [voter.nodeId] })
    const first = await kernel.atn.propose(proposer.agent, { document: { ...goal, plan: 'Revised work plan.' }, rationale: 'New evidence.' })
    assert.deepEqual(first.voters, [entryId, voter.nodeId].sort())
    await kernel.atn.rewire(proposer.agent, { peers: [entryId] })
    assert.deepEqual((await kernel.atn.network(networkId)).proposals[first.proposalId]!.voters, [entryId, voter.nodeId].sort())
    await kernel.atn.vote(voter.agent, { proposalId: first.proposalId, approve: true })
    assert.equal((await kernel.atn.network(networkId)).proposals[first.proposalId]!.status, 'pending')
    await kernel.atn.vote(host, { proposalId: first.proposalId, approve: true })
    assert.equal((await kernel.atn.network(networkId)).proposals[first.proposalId]!.status, 'committed')
    await kernel.atn.rewire(proposer.agent, { peers: [] })
    const second = await kernel.atn.propose(proposer.agent, { document: { ...goal, plan: 'Another plan revision.' }, rationale: 'Later evidence.' })
    assert.deepEqual(second.voters, [entryId, voter.nodeId].sort())
  })
})

test('ADAPTIVE-05: a departing peer bridges its lost slot while explicit empty graphs stay empty', async () => {
  await withKernel(async kernel => {
    const { host, entryId, networkId } = await start(kernel)
    const retained = await spawn(kernel, host, 'Retained neighbour.')
    const bridge = await spawn(kernel, host, 'Temporary collaborator.')
    const replacement = await spawn(kernel, host, 'Replacement collaborator.')
    const extra = await spawn(kernel, host, 'Additional candidate.')
    await kernel.atn.rewire(retained.agent, { peers: [] })
    await kernel.atn.rewire(bridge.agent, { peers: [replacement.nodeId, extra.nodeId] })
    await kernel.atn.rewire(host, { peers: [retained.nodeId, bridge.nodeId] })
    const record = await kernel.atn.network(networkId)
    const task = Object.values(record.tasks).find(row => row.holderId === bridge.nodeId)!
    await kernel.atn.send(bridge.agent, { to: entryId, kind: 'result', taskId: task.id, body: 'Complete.', summary: 'Temporary work complete.' })
    await kernel.atn.finish(bridge.agent, 'Finished.')
    await settle(kernel)
    await kernel.atn.tick()
    assert.equal((await kernel.atn.network(networkId)).nodes[bridge.nodeId]!.lifecycle, 'retired')
    assert.deepEqual((await kernel.atn.peers(host)).neighbours, [retained.nodeId, replacement.nodeId], 'only the departed slot is replaced')
    assert.deepEqual((await kernel.atn.peers(retained.agent)).neighbours, [], 'an intentional empty graph is not filled')
  })
})

test('ADAPTIVE-06: concurrent rewires preserve both choices, enforce four slots and leave invalid updates atomic', async () => {
  await withKernel(async kernel => {
    const { host, entryId, networkId } = await start(kernel)
    const first = await spawn(kernel, host, 'First collaborator.')
    const second = await spawn(kernel, host, 'Second collaborator.')
    const third = await spawn(kernel, host, 'Third collaborator.')
    const fourth = await spawn(kernel, host, 'Fourth collaborator.')
    const fifth = await spawn(kernel, host, 'Fifth collaborator.')
    await Promise.all([
      kernel.atn.rewire(first.agent, { peers: [second.nodeId, third.nodeId] }),
      kernel.atn.rewire(second.agent, { peers: [fourth.nodeId, fifth.nodeId] }),
    ])
    assert.deepEqual((await kernel.atn.peers(first.agent)).neighbours, [second.nodeId, third.nodeId])
    assert.deepEqual((await kernel.atn.peers(second.agent)).neighbours, [fourth.nodeId, fifth.nodeId])
    const chosen = [first.nodeId, second.nodeId, third.nodeId, fourth.nodeId]
    await kernel.atn.rewire(host, { peers: chosen })
    for (const peers of [[...chosen, fifth.nodeId], [first.nodeId, first.nodeId], [entryId], ['unknown-node']]) {
      await assert.rejects(() => kernel.atn.rewire(host, { peers }))
      assert.deepEqual((await kernel.atn.peers(host)).neighbours, chosen, 'a rejected replacement keeps every previous edge')
    }
    const record = await kernel.atn.network(networkId)
    assert.deepEqual(record.nodes[first.nodeId]!.peerIds, [second.nodeId, third.nodeId])
    assert.deepEqual(record.nodes[second.nodeId]!.peerIds, [fourth.nodeId, fifth.nodeId])
  })
})

test('ADAPTIVE-07: a cold kernel restores directed choices and empty graphs from JSON storage', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-adaptive-recover-'))
  let kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try {
    const { host, networkId } = await start(kernel)
    const first = await spawn(kernel, host, 'Persistent collaborator A.')
    const second = await spawn(kernel, host, 'Persistent collaborator B.')
    await kernel.atn.rewire(first.agent, { peers: [second.nodeId] })
    await kernel.atn.rewire(second.agent, { peers: [] })
    const task = await kernel.atn.send(first.agent, { to: second.nodeId, kind: 'task', body: 'An obligation that survives restart.', messageId: 'durable-task' })
    await settle(kernel)
    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
    const report = await kernel.atn.recover()
    for (const node of [first, second]) assert.equal(report.find(row => row.nodeId === node.nodeId)?.action, 'resume')
    const resumedFirst = kernel.ctx.agents.get(SessionId(first.sessionId))!
    const resumedSecond = kernel.ctx.agents.get(SessionId(second.sessionId))!
    assert.deepEqual((await kernel.atn.peers(resumedFirst)).neighbours, [second.nodeId])
    assert.deepEqual((await kernel.atn.peers(resumedSecond)).neighbours, [])
    await kernel.atn.rewire(resumedFirst, { peers: [] })
    await call(kernel, resumedSecond, 'atn_send', {
      to: first.nodeId, kind: 'result', taskId: task.settledTaskId, body: 'Completed after restart.', summary: 'Recovered task complete.',
    })
    const record = await kernel.atn.network(networkId)
    assert.equal(record.tasks[task.settledTaskId!]!.status, 'completed')
    assert.deepEqual(record.nodes[first.nodeId]!.peerIds, [])
    assert.deepEqual(record.nodes[second.nodeId]!.peerIds, [])
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('ADAPTIVE-08: accepted queued mail still reaches a recovered recipient after its sender disconnects', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-adaptive-outbox-'))
  let kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try {
    const { host, entryId, networkId } = await start(kernel)
    const worker = await spawn(kernel, host, 'Initial assignment.')
    // Drop only the live recipient; its session and active durable node survive.
    await kernel.atn.handleFor(worker.nodeId)!.dispose()
    assert.equal(kernel.ctx.agents.get(SessionId(worker.sessionId)), undefined)
    const body = 'Accepted before disconnection; deliver after recovery.'
    const accepted = await kernel.atn.send(host, { to: worker.nodeId, kind: 'task', body, messageId: 'queued-before-rewire' })
    assert.equal(accepted.delivery, 'queued')
    await kernel.atn.rewire(host, { peers: [] })
    assert.equal((await kernel.atn.network(networkId)).mails[accepted.mailId]!.status, 'queued')
    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
    await kernel.atn.recover()
    await settle(kernel)
    const resumed = kernel.ctx.agents.get(SessionId(worker.sessionId))!
    await kernel.atn.tick() // Confirm receipt after the resumed driver admits the input.
    const record = await kernel.atn.network(networkId)
    assert.deepEqual(record.nodes[entryId]!.peerIds, [])
    assert.equal(record.mails[accepted.mailId]!.status, 'delivered')
    assert.equal(record.tasks[accepted.settledTaskId!]!.status, 'open', 'delivery preserves the accepted obligation')
    assert.equal(atnMessages(resumed).filter(text => text.includes(body)).length, 1)
    await kernel.atn.recover()
    await settle(kernel)
    assert.equal(atnMessages(resumed).filter(text => text.includes(body)).length, 1, 'recovery never redelivers accepted input')
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('ADAPTIVE-09: the first legacy mutation persists its graph once and preserves frozen proposals', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-adaptive-legacy-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000 })
  try {
    const { host, entryId, networkId } = await start(kernel)
    const middle = await spawn(kernel, host, 'Middle node.')
    const leaf = await spawn(kernel, middle.agent, 'Selected leaf.')
    const sibling = await spawn(kernel, host, 'Separate branch.')
    const proposal = await kernel.atn.propose(middle.agent, { document: { ...goal, plan: 'Legacy plan.' }, rationale: 'Pre-upgrade evidence.' })
    await settle(kernel)
    // Reproduce a pre-upgrade record: real node/session/task/proposal records,
    // with only the new optional graph field absent at the durable boundary.
    await store.update(networkId, current => ({
      ...current,
      nodes: Object.fromEntries(Object.entries(current.nodes).map(([id, node]) => {
        const legacy = { ...node }
        delete legacy.peerIds
        return [id, legacy]
      })),
    }))
    const originalProposal = (await store.load(networkId))!.proposals[proposal.proposalId]!
    await kernel.atn.rewire(sibling.agent, { peers: [] })
    const migrated = (await store.load(networkId))!
    assert.deepEqual(migrated.nodes[entryId]!.peerIds, [middle.nodeId, leaf.nodeId], 'the legacy selected path seeds the first durable graph')
    assert.ok(Object.values(migrated.nodes).every(node => node.peerIds !== undefined))
    assert.deepEqual(migrated.proposals[proposal.proposalId], originalProposal)

    await kernel.atn.rewire(host, { peers: [] })
    await kernel.atn.rewire(middle.agent, { peers: [sibling.nodeId] })
    await kernel.atn.tick()
    const later = (await store.load(networkId))!
    assert.deepEqual(later.nodes[entryId]!.peerIds, [], 'subsequent mutations do not reseed an intentional empty graph')
    assert.deepEqual(later.nodes[middle.nodeId]!.peerIds, [sibling.nodeId])
    assert.deepEqual(later.proposals[proposal.proposalId], originalProposal, 'migration and rewiring preserve the outstanding vote')
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
