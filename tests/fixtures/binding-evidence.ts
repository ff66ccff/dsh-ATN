import { auditFactFlow, type BindingReferencePair, type BindingReferenceRun } from '../../experiments/topology-binding-audit.ts'
import { createShiftingEvidenceTask, expectedChain, ShiftingEvidenceScenario } from '../../experiments/shifting-evidence-task.ts'
import { proveTopologyBinding } from '../../experiments/topology-binding-proof.ts'
import { makeChain, makeTask } from './network.ts'

/** Immutable owner deliveries with interleaved directed rewires and checkpoints. */
export function factFlowFixture(seed = 17) {
  const task = createShiftingEvidenceTask(8, seed, 2, true)
  const nodes = Array.from({ length: 8 }, (_, i) => `node-${i}`)
  const network = makeChain(nodes, { rewireHistory: [] })
  const checkpoints = ([1, 2] as const).map(phase => ({ phase, at: phase * 1000, answer: JSON.stringify(expectedChain(task, phase)) }))
  let index = 0
  for (const required of proveTopologyBinding(task).requiredFacts) {
    const fact = task.phases[required.phase - 1].facts.find(row => row.id === required.document)!
    const id = `task-${100 + index * 10}`, holder = nodes[required.holder]
    network.rewireHistory!.push({ id: `rewire-${99 + index * 10}`, nodeId: nodes[0], createdAt: index,
      previousPeers: index ? [nodes[proveTopologyBinding(task).requiredFacts[index - 1].holder]] : [nodes[7], nodes[1]],
      nextPeers: [holder], intent: 'exploration', evaluation: { verdict: 'insufficient-evidence', causalClaim: false,
        baselineTaskIds: [], candidateTaskIds: [], comparisonKey: null, validatorId: null, costUnit: null,
        baseline: { passed: 0, failed: 0, unverified: 0, passRate: null, meanLatencyMs: null, meanCost: null },
        candidate: { passed: 0, failed: 0, unverified: 0, passRate: null, meanLatencyMs: null, meanCost: null },
        delta: { passRate: null, meanLatencyMs: null, meanCost: null }, reasons: [] } })
    network.tasks[id] = makeTask(id, { holderId: holder, requesterId: nodes[0], status: 'completed',
      description: JSON.stringify({ phase: required.phase, key: fact.key }), result: { summary: JSON.stringify(fact), evidence: [fact.id] },
      createdAt: index, settledAt: index + 20 })
    for (const kind of ['task', 'result'] as const) {
      const mailId = `${kind}-mail-${index}`
      network.mails[mailId] = { id: mailId, kind, fromId: kind === 'task' ? nodes[0] : holder, toId: kind === 'task' ? holder : nodes[0],
        taskId: id, proposalId: null, body: kind === 'task' ? network.tasks[id].description : JSON.stringify(fact),
        status: 'delivered', enqueuedAt: index, settledAt: kind === 'task' ? index + 10 : index + 30, note: null }
    }
    index++
  }
  return { task, network, checkpoints }
}

/** Synthetic gate inputs; real reference execution is covered by integration tests. */
export function bindingEvidence(conditions: BindingReferencePair['conditions'], sourceHashes: Record<string, string>) {
  const fixture = factFlowFixture(conditions.seed), proof = proveTopologyBinding(fixture.task)
  const factFlowAudit = auditFactFlow(fixture.task, fixture.network, fixture.checkpoints)
  const run = (topologyMode: 'fixed' | 'adaptive') => {
    const adaptive = topologyMode === 'adaptive', checkpoints = adaptive ? fixture.checkpoints : []
    return { seed: conditions.seed, topologyMode, passed: adaptive, issuedModelCalls: 0,
      policy: 'synthetic-unit-fixture', interpretation: 'Synthetic gate input only.', unavailable: [],
      messages: 0, hops: 0, payloadBytes: 0, maxContextBytes: 0, totalInteractions: 0, totalTransferBytes: 0,
      board: { reads: 0, writes: 0, readBytes: 0, writeBytes: 0 }, contextBytesByNode: {}, manipulation: new ShiftingEvidenceScenario(fixture.task).snapshot(),
      actions: 16, entrySteps: 16, actionsByNode: { entry: 16 }, maxNodeActions: 16,
      topology: { nodes: 8, maxPeers: 2, reachableFromEntry: 8, diameter: 4 }, topologyProof: proof,
      requiredFactCount: proof.requiredFacts.length, obtainedRequiredFacts: adaptive ? proof.requiredFacts : [],
      obtainedRequiredFactCount: adaptive ? proof.requiredFacts.length : 0,
      receivedFacts: adaptive ? proof.requiredFacts.map(row => ({ phase: row.phase, taskId: 'fixture-task', ownerSlot: row.holder,
        fact: fixture.task.phases[row.phase - 1].facts.find(fact => fact.id === row.document)! })) : [],
      factFlowAudit: adaptive ? factFlowAudit : auditFactFlow(fixture.task, fixture.network, []), checkpoints,
      evaluation: ([1, 2] as const).map(phase => ({ phase, passed: adaptive, submitted: adaptive })) } as BindingReferenceRun
  }
  return { factFlowAudit, bindingReference: { conditions, sourceHashes, adaptive: run('adaptive'), fixed: run('fixed') } }
}
