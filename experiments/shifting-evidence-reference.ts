/** Zero-model constructive policies over the same real runtime and evidence ACL. */
import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Config } from '../src/config.ts'
import { collaborationPeers } from '../src/topology.ts'
import { createAtnCostMeter } from './atn-cost.ts'
import { referenceKernel } from './reference-kernel.ts'
import { installShiftingEvidenceAccess } from './shifting-evidence-access.ts'
import { proveTopologyBinding } from './topology-binding-proof.ts'
import { auditFactFlow } from './topology-binding-audit.ts'
import { selectStaticWidePeers, STATIC_WIDE_POLICY } from './static-wide-topology.ts'
import { shiftingMechanisms, type SimplificationArm } from './simplification-arms.ts'
import { ShiftingEvidenceScenario, createShiftingEvidenceTask, evaluateChain, shiftingPrompt, validateRequestedEvidence, BINDING_SETUP_TASK, type ChainAnswer, type EvidenceFact } from './shifting-evidence-task.ts'

export function shiftingConfig(agents: number, steps: number, timeoutMs: number, maxCollaborationPeers = 2): Config {
  return Config({ ...Config(), maxResidentNodes: agents, maxTotalNodes: agents, maxCollaborationPeers,
    maxTasks: 128, maxRetainedMail: 256, maxPendingMailPerNode: 32, maxMessageBytes: 8192,
    stepBudget: steps, networkDeadlineMs: timeoutMs, defaultLeaseMs: timeoutMs,
    maxLeaseExtensionMs: timeoutMs, proposalDeadlineMs: Math.min(timeoutMs, 60_000) })
}

export async function provisionShifting(ctx: Context, entry: Agent, scenario: ShiftingEvidenceScenario, options: { perNodeSteps?: number; autoAdvance?: boolean; mode?: string } = {}) {
  const started = await ctx.atn.start(entry, { objective: 'Prove both versions of the changing distributed dependency chain.',
    successCriteria: 'Submit ordered current-phase proofs and terminal for both checkpoints.', constraints: shiftingPrompt(scenario.task, options) })
  const agents = [entry]
  for (let slot = 1; slot < scenario.task.agents; slot++) {
    const born = await ctx.atn.spawn(agents[slot - 1], { task: scenario.task.topologyBinding
      ? BINDING_SETUP_TASK
      : 'Read your local evidence snapshot once per phase; the host derives discovery metadata. Then respond to actual fact tasks or relay to the named holder. Return your own exact copy even if obsolete; preserve target and phase/version when relaying. Retrieve a bounded fragment only when explicitly assigned. With no assigned work, end the current turn and wait for mail or the phase update; keep the node available. Only the entry assembles the full chain and submits checkpoints.', context: '' })
    const agent = ctx.agents.list().find(row => row.id === born.sessionId)
    assert.ok(agent); agents.push(agent)
  }
  const store = await ctx.atn.openStore()
  const record = await store.update(started.networkId, current => {
    const ordered = agents.map(agent => Object.values(current.nodes).find(node => node.sessionId === agent.id)!)
    const widePeers = options.mode === 'fixed-wide' ? selectStaticWidePeers(ordered.map(node => node.id)) : null
    const nodes = { ...current.nodes }
    ordered.forEach((node, index) => { nodes[node.id] = { ...node,
      peerIds: widePeers?.[node.id] ?? [ordered[(index - 1 + agents.length) % agents.length].id, ordered[(index + 1) % agents.length].id] } })
    return { ...current, nodes }
  })
  const ids = agents.map(agent => Object.values(record.nodes).find(node => node.sessionId === agent.id)!.id)
  const reached = new Set<string>(), queue = [started.nodeId]
  while (queue.length) { const id = queue.shift()!; if (reached.has(id)) continue; reached.add(id); queue.push(...collaborationPeers(record.nodes, id, record.limits.maxCollaborationPeers)) }
  let diameter = 0
  for (const source of ids) {
    const distances = new Map<string, number>([[source, 0]]), pending = [source]
    while (pending.length) {
      const id = pending.shift()!
      for (const peer of collaborationPeers(record.nodes, id, record.limits.maxCollaborationPeers)) if (!distances.has(peer)) {
        const distance = distances.get(id)! + 1; distances.set(peer, distance); pending.push(peer); diameter = Math.max(diameter, distance)
      }
    }
  }
  const topology = { nodes: agents.length, maxPeers: Math.max(...ids.map(id => collaborationPeers(record.nodes, id, record.limits.maxCollaborationPeers).length)), reachableFromEntry: reached.size, diameter }
  assert.equal(topology.maxPeers, options.mode === 'fixed-wide' ? 4 : 2); assert.equal(topology.reachableFromEntry, agents.length)
  const initialPeerIds = Object.fromEntries(ids.map(id => [id, [...record.nodes[id].peerIds!]]))
  return { ...started, agents, ids, topology, initialPeerIds,
    staticSelection: options.mode === 'fixed-wide' ? { ...STATIC_WIDE_POLICY, publicNodeIds: ids, peers: initialPeerIds } : null }
}

/** Resolve received documents, never inspect the hidden task fixture to choose an answer. */
export function assembleChain(rootKey: string, phase: 1 | 2, facts: readonly EvidenceFact[]): ChainAnswer {
  const chain: ChainAnswer['chain'] = []
  let key: string | null = rootKey, terminal = ''
  while (key !== null) {
    const matches = facts.filter(fact => validateRequestedEvidence(fact, { phase, key: key! }).status === 'accepted')
    if (matches.length !== 1 || chain.some(row => row.key === key)) throw new Error('Missing, ambiguous or cyclic received evidence')
    const fact: EvidenceFact = matches[0]
    chain.push({ key: fact.key, proof: fact.proof, document: fact.id }); terminal = fact.terminal ?? ''; key = fact.next
  }
  return { phase, chain, terminal }
}

export interface ShiftingReferenceOptions {
  agents?: number; seed?: number; chainLength?: number; topologyBinding?: boolean
  steps?: number; maxCalls?: number; timeoutMs?: number; topology?: SimplificationArm | 'fixed' | 'fixed-wide'
}
export async function runShiftingReference(options: ShiftingReferenceOptions = {}) {
  const task = createShiftingEvidenceTask(options.agents ?? 8, options.seed ?? 17, options.chainLength, options.topologyBinding)
  const scenario = new ShiftingEvidenceScenario(task)
  const topologyMode = options.topology ?? (task.topologyBinding ? 'adaptive' : 'fixed')
  const mechanisms = { ...shiftingMechanisms(topologyMode), sharedBoard: false }
  const staticTopology = topologyMode === 'fixed' || topologyMode === 'fixed-wide'
  const scratch = await mkdtemp(join(tmpdir(), 'atn-shifting-reference-'))
  const kernel = await referenceKernel(scratch, scenario, shiftingConfig(task.agents, options.steps ?? 16, options.timeoutMs ?? 240_000, topologyMode === 'fixed-wide' ? 4 : 2))
  const costs = createAtnCostMeter()
  const actionsByNode: Record<string, number> = {}
  const receivedFacts: Array<{ phase: 1 | 2; taskId: string; ownerSlot: number; fact: EvidenceFact }> = []
  const unavailable: Array<{ phase: number; key: string; ownerSlot: number }> = []
  const checkpoints: Array<{ phase: 1 | 2; at: number; answer: string }> = []
  let actions = 0
  try {
    kernel.ctx.on('atn/network-updated', ({ record }) => { costs.observe(record) }, { global: true })
    const network = await provisionShifting(kernel.ctx, kernel.entry, scenario, { perNodeSteps: options.steps ?? 16, mode: topologyMode })
    const fixedPeers = task.topologyBinding && staticTopology ? network.initialPeerIds : undefined
    installShiftingEvidenceAccess(kernel.ctx.atn, network.networkId, sessionId => scenario.knowledgeHints(sessionId), scenario, fixedPeers)
    if (fixedPeers) kernel.ctx.atn.rewire = async () => { throw new Error('Rewiring disabled by fixed-topology ablation') }
    if (!mechanisms.requesterFeedback) kernel.ctx.atn.feedback = async () => { throw new Error('Requester ratings disabled by no-feedback ablation') }
    const step = async (index: number) => {
      if (++actions > (options.maxCalls ?? task.agents * 16)) throw new Error('Reference global action budget exhausted')
      if (!await kernel.ctx.atn.admitStep(network.networkId, network.agents[index].id)) throw new Error('Reference per-node step budget exhausted')
      actionsByNode[network.ids[index]] = (actionsByNode[network.ids[index]] ?? 0) + 1
    }
    for (const phase of [1, 2] as const) {
      // A fixed-reference diagnostic visits both fixtures even if phase 1 cannot
      // be submitted. This host transition is reported; it is never a live success.
      if (phase === 2) scenario.advance(scenario.submissions.has(1) ? 'phase-1-checkpoint' : 'reference-diagnostic-phase-2')
      if (task.topologyBinding) {
        for (let i = 0; i < network.agents.length; i++) {
          await step(i); scenario.read(network.agents[i].id)
          await kernel.ctx.atn.refreshCustody(network.networkId)
        }
        const facts: EvidenceFact[] = []
        let key: string | null = task.rootKey
        while (key !== null) {
          await step(0)
          const discovery = await kernel.ctx.atn.peers(kernel.entry, key)
          const advertised = [...discovery.nodes, ...(discovery.candidateNodes ?? [])].filter(peer =>
            peer.knowledgeFingerprint.documents.some(id => id.endsWith(`:${key}`)))
          const wanted = advertised.filter(peer => peer.knowledgeFingerprint.documents.includes(`phase-${phase}:${key}`))
          const stale = key === task.rootKey ? advertised.filter(peer => peer.knowledgeFingerprint.documents.some(id => id.startsWith('copy-for-phase-'))) : []
          assert.equal(wanted.length, 1)
          for (const peer of [...stale, ...wanted]) {
            const index = network.ids.indexOf(peer.id)
            assert.ok(index >= 0)
            if (!(await kernel.ctx.atn.peers(kernel.entry)).neighbours.includes(peer.id)) {
              if (staticTopology) { unavailable.push({ phase, key, ownerSlot: index }); continue }
              await step(0); await kernel.ctx.atn.rewire(kernel.entry, { peers: [peer.id] })
            }
            await step(0)
            const sent = await kernel.ctx.atn.send(kernel.entry, { to: peer.id, kind: 'task', body: JSON.stringify({ phase, key }) })
            await step(index)
            const fact = scenario.read(network.agents[index].id, key).documents[0]
            await step(index)
            await kernel.ctx.atn.send(network.agents[index], { to: network.nodeId, kind: 'result', taskId: sent.settledTaskId!,
              body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] })
            const record = await kernel.ctx.atn.network(network.networkId)
            const received = JSON.parse(record.tasks[sent.settledTaskId!].result!.summary) as EvidenceFact
            receivedFacts.push({ phase, taskId: sent.settledTaskId!, ownerSlot: index, fact: received })
            const verdict = validateRequestedEvidence(received, { phase, key })
            if (mechanisms.requesterFeedback) {
              await step(0)
              await kernel.ctx.atn.feedback(kernel.entry, { taskId: sent.settledTaskId!, status: verdict.status,
                summary: verdict.reasons.join(',') || 'Current local fields match.', evidence: [received.id], comparisonKey: 'versioned-fact:v1' })
            }
            if (verdict.status === 'accepted') facts.push(received)
          }
          const current = facts.find(fact => fact.key === key)!
          if (!current) { assert.ok(staticTopology); break }
          key = current.next
        }
        if (key === null) {
          await step(0)
          const answer = JSON.stringify(assembleChain(task.rootKey, phase, facts))
          scenario.submit(phase, answer); checkpoints.push({ phase, at: Date.now(), answer })
        }
        continue
      }
      // A gather request follows the ring; each holder reads only its own ACL,
      // appends the child's delivered result and reports through its real task.
      const gather = async (index: number): Promise<EvidenceFact[]> => {
        await step(index)
        const own = scenario.read(network.agents[index].id).documents
        await kernel.ctx.atn.refreshCustody(network.networkId)
        if (index === task.agents - 1) return own
        await step(index)
        const sent = await kernel.ctx.atn.send(network.agents[index], { to: network.ids[index + 1], kind: 'task',
          body: `Gather phase ${phase} facts from your ring segment and return exact document records.` })
        const child = await gather(index + 1)
        await step(index + 1)
        await kernel.ctx.atn.send(network.agents[index + 1], { to: network.ids[index], kind: 'result', taskId: sent.settledTaskId!,
          body: `Phase ${phase} ring-segment facts are in the result summary.`, summary: JSON.stringify(child), evidence: child.map(row => row.id) })
        const persisted = await kernel.ctx.atn.network(network.networkId)
        const received = JSON.parse(persisted.tasks[sent.settledTaskId!].result!.summary) as EvidenceFact[]
        if (mechanisms.requesterFeedback) {
          await step(index)
          const stale = received.some(fact => validateRequestedEvidence(fact, { phase, key: fact.key }).status === 'rejected')
          await kernel.ctx.atn.feedback(network.agents[index], { taskId: sent.settledTaskId!, status: stale ? 'rejected' : 'accepted',
            summary: stale ? 'Received segment contains phase/version mismatch; use only locally validated records.' : 'Received current-phase facts with document keys and proofs; final oracle remains separate.',
            evidence: [received[0]?.id ?? 'empty-ring-segment'], comparisonKey: 'ring-segment-facts:v1' })
        }
        return [...own, ...received]
      }
      const received = await gather(0)
      await step(0)
      scenario.submit(phase, JSON.stringify(assembleChain(task.rootKey, phase, received)))
    }
    const evaluation = ([1, 2] as const).map(phase => evaluateChain(task, phase, scenario.submissions.get(phase)))
    const passed = evaluation.every(row => row.passed)
    if (!task.topologyBinding || !staticTopology) assert.ok(passed)
    assert.equal(kernel.modelCalls(), 0)
    const proof = task.topologyBinding ? proveTopologyBinding(task) : null
    const staticTopologyProof = task.topologyBinding && staticTopology ? proveTopologyBinding(task, { entrySlot: 0,
      maxCollaborationPeers: topologyMode === 'fixed-wide' ? 4 : 2,
      initialPeers: network.initialPeerIds[network.nodeId].map(id => network.ids.indexOf(id)) }) : null
    const obtainedRequiredFacts = proof?.requiredFacts.filter(row => receivedFacts.some(received => received.phase === row.phase &&
      received.ownerSlot === row.holder && received.fact.id === row.document && received.fact.key === row.key &&
      validateRequestedEvidence(received.fact, { phase: row.phase, key: row.key }).status === 'accepted')) ?? []
    const factFlowAudit = task.topologyBinding ? auditFactFlow(task, await kernel.ctx.atn.network(network.networkId), checkpoints, network.initialPeerIds[network.nodeId]) : null
    const finalRecord = await kernel.ctx.atn.network(network.networkId)
    const requesterRatings = Object.values(finalRecord.tasks).filter(task => task.localFeedback).length
    return { seed: task.seed, topologyMode, mechanisms, requesterRatings,
      policy: task.topologyBinding ? staticTopology ? 'direct-owner-synthesis-with-fixed-edges' : 'direct-owner-synthesis-with-sequential-rewiring' : 'hub-synthesis-via-fixed-ring', evaluation, passed,
      issuedModelCalls: 0, actions, actionsByNode, maxNodeActions: Math.max(...Object.values(actionsByNode)),
      entrySteps: actionsByNode[network.nodeId] ?? 0, receivedFacts, unavailable, checkpoints, topologyProof: proof, staticTopologyProof,
      requiredFactCount: proof?.requiredFacts.length ?? 0, obtainedRequiredFacts, obtainedRequiredFactCount: obtainedRequiredFacts.length, factFlowAudit,
      topology: network.topology, initialPeerIds: network.initialPeerIds, staticSelection: network.staticSelection,
      manipulation: scenario.snapshot(), ...costs.snapshot(),
      interpretation: task.topologyBinding ? 'Zero-model direct-owner policy using public metadata and actual task/results only. Fixed failure is a task-design constraint, not evidence of adaptive benefit. Diagnostic phase advancement after a missing checkpoint is not a success.' : 'Feasible central synthesis with the same ACL, ring, step and message limits; not a proven optimum. All task/results count.' }
  } finally {
    await kernel.ctx.fiber.dispose()
    assert.equal(dirname(scratch), resolve(tmpdir()))
    await rm(scratch, { recursive: true, force: true })
  }
}
