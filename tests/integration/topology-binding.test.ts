import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { referenceKernel } from '../../experiments/reference-kernel.ts'
import { shiftingConfig, provisionShifting } from '../../experiments/shifting-evidence-reference.ts'
import { installShiftingEvidenceAccess } from '../../experiments/shifting-evidence-access.ts'
import { createShiftingEvidenceTask, ShiftingEvidenceScenario, validateRequestedEvidence } from '../../experiments/shifting-evidence-task.ts'
import { installTopologyBindingAccess } from '../../experiments/topology-binding-access.ts'
import * as AtnTools from '../../src/tools.ts'

async function fixture(run: (k: Awaited<ReturnType<typeof referenceKernel>>, s: ShiftingEvidenceScenario,
  n: Awaited<ReturnType<typeof provisionShifting>>) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'atn-topology-binding-'))
  const task = createShiftingEvidenceTask(8, 17, 2, true)
  const scenario = new ShiftingEvidenceScenario(task)
  const kernel = await referenceKernel(directory, scenario, shiftingConfig(8, 48, 30000))
  try {
    await kernel.ctx.plugin(AtnTools)
    const network = await provisionShifting(kernel.ctx, kernel.entry, scenario)
    ;(installShiftingEvidenceAccess as any)(kernel.ctx.atn, network.networkId, (id: string) => scenario.knowledgeHints(id), scenario)
    await run(kernel, scenario, network)
    assert.equal(kernel.modelCalls(), 0)
  } finally { await kernel.ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) }
}

test('BIND-ACL: a relayed result fails atomically; a directly connected genuine owner succeeds', async () => {
  await fixture(async ({ ctx, entry }, scenario, network) => {
    const key = scenario.task.rootKey, owner = scenario.task.phases[0].holders[key]
    const fact = scenario.read(network.agents[owner].id, key).documents[0]
    const request = await ctx.atn.send(entry, { to: network.ids[1], kind: 'task', body: JSON.stringify({ phase: 1, key }) })
    const before = await ctx.atn.network(network.networkId)
    await assert.rejects(ctx.atn.send(network.agents[1], { to: network.nodeId, kind: 'result', taskId: request.settledTaskId!,
      body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] }), /evidence-not-owned/)
    assert.deepEqual(await ctx.atn.network(network.networkId), before, 'refusal creates neither mail nor settlement')
    await assert.rejects(ctx.atn.send(entry, { to: network.ids[owner], kind: 'task', body: JSON.stringify({ phase: 1, key }) }), /not in your collaboration neighbours/)
    await ctx.atn.rewire(entry, { peers: [network.ids[owner], network.ids[1]] })
    const direct = await ctx.atn.send(entry, { to: network.ids[owner], kind: 'task', body: JSON.stringify({ phase: 1, key }) })
    await ctx.atn.send(network.agents[owner], { to: network.nodeId, kind: 'result', taskId: direct.settledTaskId!,
      body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] })
    assert.equal((await ctx.atn.network(network.networkId)).tasks[direct.settledTaskId!].status, 'completed')
    const record = await ctx.atn.network(network.networkId)
    const nodes = Object.values(record.nodes)
    for (const node of nodes) {
      assert.deepEqual(node.modelRoute, nodes[0].modelRoute)
      assert.deepEqual(JSON.parse(JSON.stringify(node.permissionSeed ?? {})), {}, 'no node acquires permission overrides')
    }
    const toolSets = network.agents.map(agent => ctx.tools.schemas(agent.id).map(tool => tool.name).sort())
    assert.equal(toolSets[0].length, 6)
    for (const tools of toolSets) assert.deepEqual(tools, toolSets[0])
    for (const agent of network.agents) assert.deepEqual(JSON.parse(JSON.stringify(agent.options)), JSON.parse(JSON.stringify(entry.options)))
  })
})

test('BIND-CHANNELS: board bodies, notes and extra request fields cannot carry relayed facts', async () => {
  await fixture(async ({ ctx, entry }, scenario, network) => {
    const fact = scenario.task.phases[0].facts[0], hints = scenario.knowledgeHints(entry.id)
    await assert.rejects(ctx.atn.board(entry, { action: 'publish', key: `phase-1:${network.nodeId}`, expectedRevision: 0,
      body: JSON.stringify(fact), documents: hints.documents, topics: hints.topics }), /metadata-only/)
    await assert.rejects(ctx.atn.send(entry, { to: network.ids[1], kind: 'note', body: JSON.stringify(fact) }), /fact-requests-and-owner-results-only/)
    await assert.rejects(ctx.atn.send(entry, { to: network.ids[1], kind: 'task', body: JSON.stringify({ phase: 1, key: fact.key, proof: fact.proof }) }), /invalid-fact-request/)
  })
})

test('BIND-STALE: genuine stale ownership is allowed, requester rejection is independent, and old replies fail after a phase update', async () => {
  await fixture(async ({ ctx, entry }, scenario, network) => {
    const key = scenario.task.rootKey, fact = scenario.read(network.agents[1].id, key).documents[0]
    const sent = await ctx.atn.send(entry, { to: network.ids[1], kind: 'task', body: JSON.stringify({ phase: 1, key }) })
    await ctx.atn.send(network.agents[1], { to: network.nodeId, kind: 'result', taskId: sent.settledTaskId!,
      body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] })
    const verdict = validateRequestedEvidence(fact, { phase: 1, key })
    assert.equal(verdict.status, 'rejected')
    const reviewed = await ctx.atn.feedback(entry, { taskId: sent.settledTaskId!, status: verdict.status,
      summary: verdict.reasons.join(','), evidence: [fact.id], comparisonKey: 'versioned-fact:v1' })
    assert.equal(reviewed.localFeedback?.status, 'rejected')
    assert.equal(reviewed.acceptance, null, 'owner ACL is not host proof verification')
    const pending = await ctx.atn.send(entry, { to: network.ids[1], kind: 'task', body: JSON.stringify({ phase: 1, key }) })
    scenario.advance('test-update')
    const before = await ctx.atn.network(network.networkId)
    await assert.rejects(ctx.atn.send(network.agents[1], { to: network.nodeId, kind: 'result', taskId: pending.settledTaskId!,
      body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] }), /evidence-not-owned/)
    assert.deepEqual(await ctx.atn.network(network.networkId), before)
  })
})

test('BIND-FIXED: automatic graph repair cannot grant a fact channel outside the frozen initial ring', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atn-binding-fixed-'))
  const scenario = new ShiftingEvidenceScenario(createShiftingEvidenceTask(8, 17, 2, true))
  const kernel = await referenceKernel(directory, scenario, shiftingConfig(8, 48, 30000))
  try {
    const network = await provisionShifting(kernel.ctx, kernel.entry, scenario)
    const frozen = Object.fromEntries(network.ids.map((id, i) => [id, [network.ids[(i + 7) % 8], network.ids[(i + 1) % 8]]]))
    installTopologyBindingAccess(kernel.ctx.atn, network.networkId, scenario, frozen)
    const owner = scenario.task.phases[0].holders[scenario.task.rootKey]
    await kernel.ctx.atn.rewire(kernel.entry, { peers: [network.ids[owner]] })
    const before = await kernel.ctx.atn.network(network.networkId)
    await assert.rejects(kernel.ctx.atn.send(kernel.entry, { to: network.ids[owner], kind: 'task',
      body: JSON.stringify({ phase: 1, key: scenario.task.rootKey }) }), /fixed-edge-required/)
    assert.deepEqual(await kernel.ctx.atn.network(network.networkId), before)
  } finally { await kernel.ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) }
})

test('BIND-READY: a constant setup receipt settles initialization without becoming an evidence channel', async () => {
  await fixture(async ({ ctx }, scenario, network) => {
    const record = await ctx.atn.network(network.networkId)
    const setup = Object.values(record.tasks).find(task => task.holderId === network.ids[1] && task.requesterId === network.nodeId)!
    assert.ok(setup)
    await ctx.atn.send(network.agents[1], { to: network.nodeId, kind: 'result', taskId: setup.id,
      body: '{"ready":true}', summary: '{"ready":true}', evidence: [] })
    assert.equal((await ctx.atn.network(network.networkId)).tasks[setup.id].status, 'completed')
    const other = Object.values(record.tasks).find(task => task.holderId === network.ids[2])!
    const fact = scenario.read(network.agents[2].id).documents[0]
    const before = await ctx.atn.network(network.networkId)
    await assert.rejects(ctx.atn.send(network.agents[2], { to: other.requesterId, kind: 'result', taskId: other.id,
      body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] }), /invalid-setup-receipt/)
    assert.deepEqual(await ctx.atn.network(network.networkId), before)
  })
})
