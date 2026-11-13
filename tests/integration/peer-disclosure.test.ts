import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { atnMessages, bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { defineCustodyPolicy } from '../../src/information-boundary.ts'
import type { PeersResult } from '../../src/runtime.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { isFullPeerSummary } from '../../src/peer-disclosure.ts'
import { defineSubstrateReadPolicy } from '../../src/substrate-read-policy.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'
import { appendSubstrate } from '../../src/substrate.ts'
import { testGoal } from '../fixtures/network.ts'

async function withKernel(mode: 'full' | 'coarse' | 'minimal', run: (kernel: Kernel) => Promise<void>) {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-disclosure-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000, config: { peerDisclosure: mode } })
  try { await run(kernel) }
  finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

async function spawn(kernel: Kernel, host: Awaited<ReturnType<typeof createHostAgent>>) {
  const born = await kernel.atn.spawn(host, { task: 'HIDDEN_FOREIGN_TASK_79231', context: 'HIDDEN_FOREIGN_CONTEXT_89231' })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(born.sessionId))
  assert.ok(agent)
  return { ...born, agent }
}

function toolTexts(agent: Awaited<ReturnType<typeof createHostAgent>>): string[] {
  return (agent.session.snapshotEvents() as readonly { type: string; data?: unknown }[])
    .filter(event => event.type === 'tool/result')
    .flatMap(event => {
      const data = event.data as { message: { isError?: boolean; content: readonly { text?: string }[] } }
      assert.equal(data.message.isError, false)
      return data.message.content.flatMap(part => part.text === undefined ? [] : [part.text])
    })
}

test('DISCLOSURE-04: real status tools and admitted topology messages share host topics and ignore model mode arguments', async () => {
  await withKernel('coarse', async kernel => {
    const host = await createHostAgent(kernel, 'disclosure-tool-host')
    const started = await kernel.atn.start(host, testGoal)
    const neighbour = await spawn(kernel, host)
    const candidate = await spawn(kernel, host)
    const policy = defineCustodyPolicy({ custody: () => ['HIDDEN_CATALOG_DOC_88324'], extractClaims: () => [],
      describeArtifact: () => ({ topics: ['trusted catalog topic'] }) })
    kernel.atn.installOutboundPolicy('*', policy)
    await kernel.atn.refreshCustody(started.networkId)
    await kernel.atn.rewire(host, { peers: [neighbour.nodeId] })
    for (let i = 0; i < 3; i++) assert.equal(await kernel.atn.admitStep(started.networkId, host.id), true)
    kernel.model.enqueue(String(host.id), [{ tool: 'atn_status', args: { query: '*', peerDisclosure: 'full' } }])
    await drive(host, 'Inspect the current peers.')
    await settle(kernel)
    const result: PeersResult = JSON.parse(toolTexts(host).at(-1)!)
    assert.equal(result.peerDisclosure, 'coarse')
    assert.deepEqual(result.nodes, [{ id: neighbour.nodeId, lifecycle: 'active', topics: ['trusted catalog topic'],
      availability: 'occupied', outcomes: { requester: 'pending', host: 'pending' } }])
    assert.deepEqual(result.candidateNodes, [{ id: candidate.nodeId, lifecycle: 'active', topics: ['trusted catalog topic'],
      availability: 'occupied', outcomes: { requester: 'pending', host: 'pending' } }])
    const feedback = atnMessages(host).filter(text => text.startsWith('[ATN local changes]')).at(-1)!
    assert.match(feedback, /peerDisclosure=coarse/)
    assert.match(feedback, /trusted catalog topic/)
    assert.doesNotMatch(JSON.stringify({ nodes: result.nodes, candidateNodes: result.candidateNodes, feedback }), /HIDDEN|79231|89231|88324/)
    const requests = kernel.model.requests.filter(request => request.sessionId === String(host.id))
    assert.ok(requests.some(request => JSON.stringify(request.options).includes(JSON.stringify(feedback).slice(1, -1))),
      'logged topology feedback enters actual model GenerateOptions')
    assert.ok(requests.some(request => JSON.stringify(request.options).includes('peerDisclosure')), 'actual model sees the tool response')
    assert.equal((await kernel.atn.network(started.networkId)).limits.peerDisclosure, 'coarse')
  })
})

test('DISCLOSURE-05: paired scripted controls measure actual responses without changing submissions or host acceptance', async t => {
  const measurements: { mode: string; peerCardBytes: number; toolResponseBytes: number; topologyFeedbackBytes: number;
    scriptModelCalls: number; taskSubmissions: number; hostAccepted: number }[] = []
  for (const mode of ['full', 'coarse', 'minimal'] as const) {
    await withKernel(mode, async kernel => {
      const host = await createHostAgent(kernel, 'paired-disclosure-host')
      const started = await kernel.atn.start(host, testGoal)
      const workers = [await spawn(kernel, host), await spawn(kernel, host)]
      kernel.atn.installOutboundPolicy(started.networkId, defineCustodyPolicy({
        custody: () => ['HIDDEN_PAIRED_DOC_76342'], extractClaims: () => [],
        describeArtifact: () => ({ topics: ['trusted paired topic'] }),
      }))
      await kernel.atn.refreshCustody(started.networkId)
      const initial = await kernel.atn.network(started.networkId)
      for (const worker of workers) {
        const task = Object.values(initial.tasks).find(task => task.holderId === worker.nodeId)!
        kernel.model.enqueue(worker.sessionId, [{ tool: 'atn_send', args: { to: started.nodeId, kind: 'result',
          taskId: task.id, body: 'PAIRED_SUBMITTED_EVIDENCE', summary: 'PAIRED_SUBMITTED_EVIDENCE', evidence: ['HIDDEN_EXPLICIT_DOC'] } }])
        await drive(worker.agent, 'Submit your assigned result.')
        await settle(kernel)
      }
      await kernel.atn.tick()
      await settle(kernel)
      await kernel.atn.rewire(host, { peers: [workers[0].nodeId] })
      for (let i = 0; i < 3; i++) assert.equal(await kernel.atn.admitStep(started.networkId, host.id), true)
      kernel.model.enqueue(String(host.id), [{ tool: 'atn_status', args: { query: '*' } }])
      await drive(host, 'Inspect the completed submissions and peers.')
      await settle(kernel)
      const response = toolTexts(host).at(-1)!
      const cards: PeersResult = JSON.parse(response)
      const feedback = atnMessages(host).filter(text => text.startsWith('[ATN local changes]')).at(-1)!
      const modelRequests = kernel.model.requests.filter(request => request.sessionId === String(host.id))
      assert.ok(modelRequests.some(request => JSON.stringify(request.options).includes(JSON.stringify(response).slice(1, -1))))
      assert.ok(modelRequests.some(request => JSON.stringify(request.options).includes(JSON.stringify(feedback).slice(1, -1))))
      if (mode === 'full') assert.match(JSON.stringify(cards.nodes), /HIDDEN_FOREIGN_TASK|HIDDEN_PAIRED_DOC|PAIRED_SUBMITTED_EVIDENCE/)
      else assert.doesNotMatch(JSON.stringify({ nodes: cards.nodes, candidateNodes: cards.candidateNodes, feedback }),
        /HIDDEN|79231|89231|76342|PAIRED_SUBMITTED_EVIDENCE/)
      const callsBeforeVerification = kernel.model.requests.length
      for (const worker of workers) {
        const task = Object.values(initial.tasks).find(task => task.holderId === worker.nodeId)!
        await kernel.atn.verifyTask(started.networkId, task.id, { id: 'independent-paired-oracle',
          validate: task => ({ passed: task.result?.summary === 'PAIRED_SUBMITTED_EVIDENCE',
            summary: 'Independent exact fixture check.', evidence: ['oracle-check'] }) })
      }
      await settle(kernel)
      assert.equal(kernel.model.requests.length, callsBeforeVerification, 'host verification and projection do not add calls')
      const final = await kernel.atn.network(started.networkId)
      const submitted = Object.values(final.tasks).filter(task => workers.some(worker => worker.nodeId === task.holderId) && task.status === 'completed')
      measurements.push({ mode,
        peerCardBytes: Buffer.byteLength(JSON.stringify({ nodes: cards.nodes, candidateNodes: cards.candidateNodes })),
        toolResponseBytes: Buffer.byteLength(response), topologyFeedbackBytes: Buffer.byteLength(feedback),
        scriptModelCalls: kernel.model.requests.length, taskSubmissions: submitted.length,
        hostAccepted: submitted.filter(task => task.acceptance?.status === 'passed').length })
    })
  }
  t.diagnostic(JSON.stringify(measurements))
  assert.equal(measurements.length, 3)
  assert.ok(measurements[0].peerCardBytes > measurements[1].peerCardBytes && measurements[1].peerCardBytes > measurements[2].peerCardBytes)
  assert.ok(measurements[0].toolResponseBytes > measurements[1].toolResponseBytes && measurements[1].toolResponseBytes > measurements[2].toolResponseBytes)
  assert.ok(measurements[0].topologyFeedbackBytes > measurements[1].topologyFeedbackBytes && measurements[1].topologyFeedbackBytes > measurements[2].topologyFeedbackBytes)
  for (const row of measurements) {
    assert.equal(row.scriptModelCalls, measurements[0].scriptModelCalls)
    assert.equal(row.taskSubmissions, 2)
    assert.equal(row.hostAccepted, 2)
  }
})

test('DISCLOSURE-06: frozen and legacy disclosure survives cold recovery despite a changed host config', async () => {
  for (const mode of ['coarse', 'minimal', 'legacy'] as const) {
    const scratch = await mkdtemp(join(tmpdir(), 'atn-disclosure-recover-'))
    const store = new MemoryNetworkStore()
    let kernel = await bootKernel(scratch, { store, clock: () => 1_000_000,
      config: { peerDisclosure: mode === 'legacy' ? 'full' : mode } })
    try {
      let host = await createHostAgent(kernel, 'frozen-disclosure-host')
      const started = await kernel.atn.start(host, testGoal)
      const worker = await spawn(kernel, host)
      await kernel.atn.rewire(host, { peers: [worker.nodeId] })
      if (mode === 'legacy') await store.update(started.networkId, record => {
        const { peerDisclosure: _mode, ...limits } = record.limits
        return { ...record, limits }
      })
      const before = await kernel.atn.peers(host)
      kernel.atn.config.peerDisclosure = mode === 'legacy' ? 'minimal' : 'full'
      assert.deepEqual(await kernel.atn.peers(host), before, 'live config cannot override a network snapshot')
      await kernel.ctx.fiber.dispose()
      kernel = await bootKernel(scratch, { store, clock: () => 1_000_000,
        config: { peerDisclosure: mode === 'legacy' ? 'minimal' : 'full' } })
      host = (await kernel.ctx.agents.resume({ resumeSessionId: SessionId('frozen-disclosure-host'),
        agentOptions: { provider: 'atn-script', model: 'deterministic' } })).agent
      await kernel.atn.recover()
      await settle(kernel)
      const after = await kernel.atn.peers(host)
      assert.equal(after.peerDisclosure, mode === 'legacy' ? undefined : mode)
      assert.equal((await kernel.atn.network(started.networkId)).limits.peerDisclosure, mode === 'legacy' ? undefined : mode)
      assert.ok((await kernel.atn.network(started.networkId)).tasks[worker.taskId].description.includes('HIDDEN_FOREIGN_TASK'))
      if (mode === 'legacy') {
        assert.ok(isFullPeerSummary(after.nodes[0]))
        assert.match(JSON.stringify(after.nodes), /HIDDEN_FOREIGN_TASK/)
      } else assert.doesNotMatch(JSON.stringify(after.nodes), /HIDDEN_FOREIGN|79231|89231/)
      const writes = store.writes, calls = kernel.model.requests.length
      await kernel.atn.peers(host, '*')
      await kernel.atn.status(host)
      assert.equal(store.writes, writes, 'projection never persists a filtered record')
      assert.equal(kernel.model.requests.length, calls)
    } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
  }
})

test('DISCLOSURE-07: incidental shaping does not grant custody or bypass independent substrate read ACLs', async () => {
  for (const mode of ['full', 'coarse', 'minimal'] as const) {
    const scratch = await mkdtemp(join(tmpdir(), 'atn-disclosure-acl-'))
    let record = makeChain(['A', 'B'], { limits: { ...makeChain([]).limits, peerDisclosure: mode } })
    record.tasks.work = makeTask('work')
    record = appendSubstrate(record, 'A', { sub_task: 'parser', artifact: 'HIDDEN_AUTHORIZED_CONTENT', rationale: 'local' })
    const store = new MemoryNetworkStore([record])
    const kernel = await bootKernel(scratch, { store, clock: () => 100 })
    try {
      const a = await createHostAgent(kernel, 'session-A')
      const b = await createHostAgent(kernel, 'session-B')
      kernel.atn.installOutboundPolicy(record.id, defineCustodyPolicy({ custody: id => id === 'B' ? ['DOC_OWNER'] : [],
        extractClaims: input => 'evidence' in input ? input.evidence ?? [] : [], describeArtifact: () => ({ topics: ['trusted owner topic'] }) }))
      assert.equal((await kernel.atn.visit(a, { addresses: ['msg:1'] })).messages[0].artifact, 'HIDDEN_AUTHORIZED_CONTENT',
        'explicit authorized content is not redacted by peerDisclosure')
      const before = await kernel.atn.network(record.id)
      await assert.rejects(kernel.atn.send(b, { to: 'A', kind: 'result', taskId: 'work', body: 'x', summary: 'x', evidence: ['DOC_OTHER'] }),
        { code: 'evidence-not-owned' })
      assert.deepEqual(await kernel.atn.network(record.id), before)
      const revoke = kernel.atn.installSubstrateReadPolicy(record.id, defineSubstrateReadPolicy({
        principalFor: () => undefined, decide: () => ({ kind: 'allow' }),
      }))
      await assert.rejects(kernel.atn.visit(a, { addresses: ['msg:1'] }), { code: 'ref-unresolved' })
      await assert.rejects(kernel.atn.publish(b, { sub_task: 'parser', artifact: 'x', rationale: 'msg:1', refs: ['msg:1'] }),
        { code: 'ref-unresolved' })
      revoke()
      assert.equal((await kernel.atn.visit(a, { addresses: ['msg:1'] })).messages[0].artifact, 'HIDDEN_AUTHORIZED_CONTENT')
    } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
  }
})

test('DISCLOSURE-11: real admitted input delays visible topic changes and never wakes for hidden changes', async () => {
  await withKernel('coarse', async kernel => {
    const host = await createHostAgent(kernel, 'disclosure-delay-host')
    const started = await kernel.atn.start(host, testGoal)
    const worker = await spawn(kernel, host)
    let topic = 'initial trusted topic'
    kernel.atn.installOutboundPolicy(started.networkId, defineCustodyPolicy({ custody: () => ['HIDDEN_LIVE_DOC'],
      extractClaims: () => [], describeArtifact: () => ({ topics: [topic] }) }))
    await kernel.atn.refreshCustody(started.networkId)
    await kernel.atn.rewire(host, { peers: [worker.nodeId] })
    for (let i = 0; i < 3; i++) await kernel.atn.admitStep(started.networkId, host.id)
    await drive(host, 'Observe a stable coarse baseline.')
    const feedback = () => atnMessages(host).filter(text => text.startsWith('[ATN local changes]'))
    const baseline = feedback().length
    const requests = kernel.model.requests.length
    const before = await kernel.atn.network(started.networkId)
    await kernel.atn.provisionRecoveryTask(started.networkId, worker.nodeId, 'HIDDEN_EXTRA_TASK_783219')
    await kernel.atn.admitStep(started.networkId, worker.sessionId)
    await settle(kernel)
    assert.equal(kernel.model.requests.length, requests)
    assert.equal(feedback().length, baseline)
    assert.deepEqual((await kernel.atn.network(started.networkId)).mails, before.mails)
    await drive(host, 'Continue after hidden same-category activity.')
    assert.equal(feedback().length, baseline, 'same-category hidden changes are not acknowledged')
    topic = 'changed trusted topic'
    await kernel.atn.refreshCustody(started.networkId)
    const callsBeforeTopic = kernel.model.requests.length
    assert.equal(feedback().length, baseline)
    await drive(host, 'First ordinary input after the visible change.')
    assert.equal(feedback().length, baseline, 'visible change remains owed inside three-step interval')
    await drive(host, 'Next ordinary input reaches the interval.')
    assert.equal(feedback().length, baseline + 1)
    assert.match(feedback().at(-1)!, /changed trusted topic/)
    assert.doesNotMatch(feedback().at(-1)!, /HIDDEN|783219/)
    assert.equal(kernel.model.requests.length, callsBeforeTopic + 2, 'feedback only piggybacks on the two real inputs')
    await drive(host, 'No further visible change.')
    assert.equal(feedback().length, baseline + 1)
  })
})

test('DISCLOSURE-12: restricted projections retain actual relevance ranking and wildcard pagination', async () => {
  for (const mode of ['full', 'coarse', 'minimal'] as const) {
    const scratch = await mkdtemp(join(tmpdir(), 'atn-disclosure-pages-'))
    const record = makeChain(['A', 'B', 'C', 'D', 'E', 'F', 'G'], { limits: { ...makeChain([]).limits, peerDisclosure: mode } })
    record.nodes.A.peerIds = []
    record.tasks.zebra = makeTask('zebra', { holderId: 'G', description: 'HIDDEN_ZEBRA_TASK' })
    const store = new MemoryNetworkStore([record])
    const kernel = await bootKernel(scratch, { store, clock: () => 100 })
    try {
      const host = await createHostAgent(kernel, 'session-A')
      const writes = store.writes, calls = kernel.model.requests.length
      const first = await kernel.atn.peers(host, '*')
      assert.deepEqual(first.candidates, ['B', 'C', 'D'])
      assert.deepEqual((await kernel.atn.peers(host, 'zebra')).candidates, ['G'], 'projection does not change internal relevance fallback')
      const second = await kernel.atn.peers(host, '*')
      assert.deepEqual(second.candidates, ['E', 'F', 'G'])
      assert.deepEqual(first.candidateNodes?.map(row => row.id), first.candidates)
      assert.deepEqual(second.candidateNodes?.map(row => row.id), second.candidates)
      assert.equal(store.writes, writes)
      assert.equal(kernel.model.requests.length, calls)
      if (mode !== 'full') assert.doesNotMatch(JSON.stringify(second.candidateNodes), /HIDDEN_ZEBRA_TASK|zebra/)
    } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
  }
})

test('DISCLOSURE-01: minimal peers and status project neighbours and candidates without mutating host facts', async () => {
  await withKernel('minimal', async kernel => {
    const host = await createHostAgent(kernel, 'disclosure-host')
    const started = await kernel.atn.start(host, testGoal)
    const neighbour = await spawn(kernel, host)
    const candidate = await spawn(kernel, host)
    await kernel.atn.rewire(host, { peers: [neighbour.nodeId] })
    const before = await kernel.atn.network(started.networkId)
    const calls = kernel.model.requests.length
    const peers = await kernel.atn.peers(host, '*')
    assert.equal(peers.peerDisclosure, 'minimal')
    assert.deepEqual(peers.nodes, [{ id: neighbour.nodeId, lifecycle: 'active' }])
    assert.deepEqual(peers.candidateNodes, [{ id: candidate.nodeId, lifecycle: 'active' }])
    const status = await kernel.atn.status(host, { query: '*' })
    assert.deepEqual(status.nodes, peers.nodes)
    assert.deepEqual(status.candidateNodes, peers.candidateNodes)
    assert.equal(status.tasks.find(task => task.id === started.taskId)?.description, testGoal.objective, 'explicit own work remains visible')
    assert.ok(status.tasks.some(task => task.description === 'HIDDEN_FOREIGN_TASK_79231'), 'explicit requested work is outside peer disclosure')
    assert.equal(status.budget.stepBudget, before.limits.stepBudget)
    assert.doesNotMatch(JSON.stringify(peers), /HIDDEN_FOREIGN|79231|89231|taskId|Fingerprint/)
    assert.deepEqual(await kernel.atn.network(started.networkId), before)
    assert.equal(kernel.model.requests.length, calls)
  })
})
