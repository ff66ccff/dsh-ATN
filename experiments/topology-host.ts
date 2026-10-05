/** Host-only experimental initialization; all model requests must remain gated until this returns. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { collaborationPeers } from '../src/topology.ts'
import { renderTopologyPrompt, type TopologyScenario } from './topology-task.ts'

export async function provisionTopologyScenario(ctx: Context, entry: Agent, scenario: TopologyScenario): Promise<void> {
  const task = scenario.task
  const prompt = renderTopologyPrompt(task, scenario.recoveryMode)
  const started = await ctx.atn.start(entry, {
    objective: 'Reconcile the distributed ledger after the phase 2 corrections and worker failure.',
    successCriteria: 'The current delivery holder submits the exact final JSON artifact supported by every shard.', constraints: prompt,
  })
  ctx.on('atn/task-claimed', event => {
    if (event.networkId !== started.networkId) return
    const slot = scenario.recoverySlot(event.sourceTask.id)
    if (slot === undefined) return
    scenario.registerRecoveryTask(event.task.id, slot)
    scenario.authorizeRecovery(event.sessionId, slot)
  }, { global: true })
  let creator = entry
  for (let slot = 1; slot < task.agents; slot++) {
    const child = await ctx.atn.spawn(creator, {
      task: 'Contribute to the shared objective using your local evidence; choose collaborators and division of work.', context: '',
    })
    creator = ctx.agents.list().find(agent => agent.id === child.sessionId)!
    if (!creator) throw new Error('Seeded topology worker is missing')
  }
  // Birth graphs may exhaust an ancestor's slots before they connect all eight
  // nodes. Seed an explicitly connected ring, identically in both arms, before
  // allowing inference. This setup action is not a model-requested rewire.
  const store = await ctx.atn.openStore()
  const record = await store.update(started.networkId, current => {
    const ordered = Array.from({ length: task.agents }, (_, slot) =>
      Object.values(current.nodes).find(node => node.sessionId === scenario.sessionAt(slot))!)
    if (ordered.some(node => !node || node.lifecycle !== 'active')) throw new Error('Topology initialization lost a worker')
    const nodes = { ...current.nodes }
    for (let index = 0; index < ordered.length; index++) {
      const node = ordered[index]
      nodes[node.id] = { ...node, peerIds: [-2, -1, 1, 2].map(offset => ordered[(index + offset + ordered.length) % ordered.length].id) }
    }
    return { ...current, nodes }
  })
  const nodes = Object.values(record.nodes).filter(node => node.lifecycle === 'active')
  const reached = new Set<string>()
  const pending = [record.entryNodeId]
  while (pending.length) {
    const id = pending.pop()!
    if (reached.has(id)) continue
    reached.add(id)
    pending.push(...collaborationPeers(record.nodes, id).filter(peer => !reached.has(peer)))
  }
  const degrees = nodes.map(node => collaborationPeers(record.nodes, node.id).length)
  scenario.recordInitialTopology({ nodes: nodes.length, maxPeers: Math.max(...degrees), minPeers: Math.min(...degrees), reachableFromEntry: reached.size })
}

/** Invoke from the host event loop, never from inside the victim's tool stack. */
export async function advanceTopologyScenario(ctx: Context, entry: Agent, scenario: TopologyScenario,
  ended: () => boolean = () => false, options: { wake?: boolean } = {}): Promise<void> {
  const networkId = ctx.atn.networkForSession(entry.id)!
  const before = await ctx.atn.network(networkId)
  const victim = Object.values(before.nodes).find(node => node.sessionId === scenario.sessionAt(scenario.task.failedSlot))!
  if (scenario.recoveryMode === 'self-organized') {
    const slot = scenario.task.failedSlot
    const recovery = await ctx.atn.provisionRecoveryTask(networkId, victim.id,
      `Recover ledger slot ${slot}: read initial-${slot} and correction-${slot}; apply the correction once, compute only the four account subtotals and applied entry count, exchange those subtotals with slot provenance, then settle this recovery task with atn_send(kind=result).`,
      'The successful atn_status claim grants access to these documents. Call read_document with id="mine" after claiming. Do not transmit raw ledger entries.')
    scenario.registerRecoveryTask(recovery.id, slot)
  }
  await ctx.atn.failNode(networkId, victim.id, 'experiment phase-2 deterministic worker failure')
  const after = await ctx.atn.network(networkId)
  scenario.advancePhase({ wasActive: victim.lifecycle === 'active', confirmed: after.nodes[victim.id].lifecycle === 'failed' })
  if (ended() || options.wake === false) return
  for (const node of Object.values(after.nodes)) {
    if (node.lifecycle !== 'active') continue
    const agent = ctx.agents.list().find(agent => agent.id === node.sessionId)
    agent?.followup(createUserMessage({ content: [{ type: 'text', text:
      `Phase 2 is now active. Node ${victim.id} (slot ${scenario.task.failedSlot}) failed. ${scenario.recoveryMode === 'preassigned-backup'
        ? `This preassigned-backup control arm grants its evidence to slot ${scenario.task.backupSlot}.`
        : 'No backup is assigned. Any idle node may discover and claim the orphan recovery task with atn_status; that committed claim grants document access.'} All surviving holders must call read_document with id="mine" and inspect the new corrections. Send only four account subtotals and applied entry count with slot provenance; do not send raw entries. The complete evidence manifest is ${JSON.stringify(scenario.evidenceIds())}; the current delivery holder can assemble it locally without forwarding document lists.` }], source: { kind: 'user' } }))
  }
}
