import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { bootKernel, createHostAgent, settle } from '../fixtures/kernel.ts'
import { TopologyScenario, getTopologyTask } from '../../experiments/topology-task.ts'
import { advanceTopologyScenario, provisionTopologyScenario } from '../../experiments/topology-host.ts'
import { evaluateTopologyTask } from '../../experiments/topology-evaluation.ts'
import { collaborationPeers } from '../../src/topology.ts'
import { referenceKernel } from '../../experiments/reference-kernel.ts'

for (const mode of ['atn-no-rewire', 'atn-adaptive']) test(`TOPOLOGY-EXPERIMENT ${mode}: actual eight-node graph reaches corrected final oracle after worker failure`, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-topology-experiment-'))
  const kernel = await bootKernel(scratch)
  if (mode === 'atn-no-rewire') kernel.atn.rewire = async () => { throw new Error('Voluntary rewiring is disabled by this experiment') }
  let release!: () => void
  const ready = new Promise<void>(resolve => { release = resolve })
  kernel.ctx.on('agent/pre-step', async (_payload, next) => { await ready; return next() }, { global: true, prepend: true })
  kernel.ctx.on('llm/stream', (_request, next) => (async function* () { await ready; yield* next() })(), { global: true, prepend: true })
  const scenario = new TopologyScenario(getTopologyTask('shift-ledger-1', 8), { recoveryMode: 'preassigned-backup' })
  kernel.ctx.on('agent/created', ({ agent }) => { scenario.register(agent.id); return undefined })
  try {
    const host = await createHostAgent(kernel, 'topology-experiment-entry')
    await provisionTopologyScenario(kernel.ctx, host, scenario)
    const networkId = kernel.atn.networkForSession(host.id)!
    let record = await kernel.atn.network(networkId)
    assert.equal(kernel.model.requests.length, 0, 'no inference before identical setup is complete')
    assert.equal(Object.keys(record.nodes).length, 8)
    assert.ok(Object.values(record.nodes).every(node => collaborationPeers(record.nodes, node.id).length === 4))
    assert.equal(scenario.snapshot().checks.initialGraphReachable, true)
    assert.equal(scenario.snapshot().checks.sparseTopology, true)
    assert.equal(record.rewireHistory?.length ?? 0, 0, 'host setup must not masquerade as adaptive behavior')
    release()
    await settle(kernel)
    for (const node of Object.values(record.nodes)) {
      const request = kernel.model.requests.find(request => request.sessionId === node.sessionId)
      assert.ok(request, 'each seeded node reaches its initial request')
      assert.ok(JSON.stringify(request.options.messages).includes(`Initial neighbours: ${collaborationPeers(record.nodes, node.id).toSorted().join(', ')}`),
        'first request observes the finalized ring, never the partial birth graph')
    }
    for (let slot = 0; slot < 8; slot++) scenario.read(scenario.sessionAt(slot), `initial-${slot}`)
    assert.equal(scenario.readyForPhaseChange, true)
    const failed = Object.values(record.nodes).find(node => node.sessionId === scenario.sessionAt(7))!
    await advanceTopologyScenario(kernel.ctx, host, scenario)
    await settle(kernel)
    record = await kernel.atn.network(networkId)
    assert.equal(record.nodes[failed.id].lifecycle, 'failed')
    assert.equal(kernel.ctx.agents.list().some(agent => agent.id === failed.sessionId), false)
    assert.throws(() => scenario.read(failed.sessionId, 'mine'), /access denied/)
    assert.throws(() => scenario.read(host.id, 'correction-7'), /access denied/)
    for (let slot = 0; slot < 8; slot++) scenario.read(scenario.sessionAt(slot === 7 ? 1 : slot), `correction-${slot}`)
    scenario.read(scenario.sessionAt(1), 'initial-7')
    assert.equal(scenario.snapshot().valid, true)
    assert.deepEqual(scenario.snapshot().outcomeChecks, { revisedEvidenceRead: true, failedShardRecovered: true })
    const final = { phase: 2, netByAccount: { A: 1042, B: 811, C: 805, D: 935 },
      evidence: scenario.task.shards.flatMap(shard => [`initial-${shard.slot}`, `correction-${shard.slot}`]) }
    assert.equal(evaluateTopologyTask(scenario.task, JSON.stringify(final)).passed, true)
    assert.ok(Object.values(record.nodes).filter(node => node.lifecycle === 'active').every(node =>
      !collaborationPeers(record.nodes, node.id).includes(failed.id)))
  } finally {
    release()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('TOPOLOGY-RECOVERY: only a committed claim of the host-provisioned recovery task grants failed evidence', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-topology-recovery-'))
  const scenario = new TopologyScenario(getTopologyTask('shift-ledger-1', 8))
  const kernel = await referenceKernel(scratch, scenario)
  const { ctx, entry } = kernel
  try {
    await provisionTopologyScenario(ctx, entry, scenario)
    const networkId = ctx.atn.networkForSession(entry.id)!
    for (let slot = 0; slot < 8; slot++) scenario.read(scenario.sessionAt(slot), `initial-${slot}`)
    await advanceTopologyScenario(ctx, entry, scenario, () => false, { wake: false })
    let record = await ctx.atn.network(networkId)
    const recovery = Object.values(record.tasks).find(task => scenario.recoverySlot(task.id) === 7)!
    assert.ok(recovery)
    assert.match(recovery.description, /slot 7.*initial-7.*correction-7.*atn_send\(kind=result\)/)
    assert.equal(recovery.status, 'unreachable')
    const settleOwn = async (slot: number) => {
      const agent = ctx.agents.list().find(agent => agent.id === scenario.sessionAt(slot))!
      record = await ctx.atn.network(networkId)
      const node = Object.values(record.nodes).find(node => node.sessionId === agent.id)!
      const task = Object.values(record.tasks).find(task => task.holderId === node.id && task.status === 'open')!
      await ctx.atn.send(agent, { to: task.requesterId, kind: 'result', taskId: task.id, body: 'Local work done.', summary: 'Done.' })
      return agent
    }
    const unrelatedClaimant = await settleOwn(2)
    const originalOrphan = Object.values(record.tasks).find(task => task.id !== recovery.id && task.status === 'unreachable')!
    await ctx.atn.status(unrelatedClaimant, { claimTaskId: originalOrphan.id })
    assert.throws(() => scenario.read(unrelatedClaimant.id, 'initial-7'), /access denied/,
      'claiming an unrelated task is not a recovery grant')
    const claimant = await settleOwn(4)
    assert.throws(() => scenario.read(claimant.id, 'initial-7'), /access denied/)
    assert.throws(() => scenario.read(scenario.sessionAt(1), 'initial-7'), /access denied/,
      'the historical backup slot has no implicit grant')
    const status = await ctx.atn.status(claimant, { claimTaskId: recovery.id })
    assert.ok(status.claimedTask)
    assert.equal(scenario.recoverySlot(status.claimedTask.id), 7)
    scenario.read(claimant.id, 'initial-7')
    scenario.read(claimant.id, 'correction-7')
    assert.equal(scenario.snapshot().outcomeChecks.failedShardRecovered, true)
    assert.throws(() => scenario.read(scenario.sessionAt(1), 'correction-7'), /access denied/)
    assert.equal(kernel.modelCalls(), 0)
  } finally {
    await ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
