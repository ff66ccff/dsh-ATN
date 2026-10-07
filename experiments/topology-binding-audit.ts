/** Positive provenance and reference gates; violation counters never establish binding. */
import { isDeepStrictEqual } from 'node:util'
import type { NetworkRecord } from '../src/schema.ts'
import type { EvidenceFact, ShiftingEvidenceTask } from './shifting-evidence-task.ts'
import { createShiftingEvidenceTask, evaluateChain, validateRequestedEvidence } from './shifting-evidence-task.ts'
import { isComparisonSeed, proveTopologyBinding, verifyTopologyBindingProof } from './topology-binding-proof.ts'
import type { runShiftingReference } from './shifting-evidence-reference.ts'
import { selectStaticWidePeers, STATIC_WIDE_POLICY } from './static-wide-topology.ts'

export interface FactCheckpoint { phase: number; at: number; answer: string }
function parse(text: string | undefined): any { try { return JSON.parse(text ?? '') } catch { return null } }
const sequence = (id: string) => Number(id.match(/-(\d+)$/)?.[1] ?? NaN)

/** Audit the answer that was actually submitted, including incorrect/stale facts. */
export function auditFactFlow(task: ShiftingEvidenceTask, record: NetworkRecord, checkpoints: readonly FactCheckpoint[], initialEntryPeers?: readonly string[]) {
  const nodes = Object.values(record.nodes)
  const entrySlot = nodes.findIndex(node => node.id === record.entryNodeId)
  const violations: Array<{ phase: number; document: string | null; reason: string }> = []
  const facts: Array<{ phase: number; key: string; document: string; ownerSlot: number; ownerNodeId: string;
    taskId: string; requestMailId: string; resultMailId: string; deliveredAt: number; directPeers: string[] }> = []
  const initialPeers = initialEntryPeers ?? [nodes[(entrySlot - 1 + nodes.length) % nodes.length]?.id, nodes[(entrySlot + 1) % nodes.length]?.id]
  for (const checkpoint of checkpoints) {
    const answer = parse(checkpoint.answer)
    if (![1, 2].includes(checkpoint.phase) || !Number.isSafeInteger(checkpoint.at) || checkpoint.at < 0 ||
      !answer || answer.phase !== checkpoint.phase || !Array.isArray(answer.chain) || answer.chain.length === 0 || typeof answer.terminal !== 'string') {
      violations.push({ phase: checkpoint.phase, document: null, reason: 'invalid-checkpoint' }); continue
    }
    const phase = task.phases[checkpoint.phase - 1]
    for (const [index, row] of answer.chain.entries()) {
      const fact: EvidenceFact | undefined = [...phase.facts, ...phase.staleFacts].find(fact => fact.id === row?.document &&
        fact.key === row?.key && fact.proof === row?.proof && (index !== answer.chain.length - 1 || fact.terminal === answer.terminal))
      const ownerSlot = fact && (phase.facts.some(value => value.id === fact.id) ? phase.holders[fact.key] : phase.staleHolders[fact.key])
      const owner = ownerSlot === undefined ? undefined : nodes[ownerSlot]
      let witness: typeof facts[number] | undefined
      if (fact && owner && entrySlot === 0) for (const resultTask of Object.values(record.tasks)) {
        const request = parse(resultTask.description)
        if (resultTask.requesterId !== record.entryNodeId || resultTask.holderId !== owner.id || resultTask.status !== 'completed' ||
          (resultTask.settledBy !== null && resultTask.settledBy !== owner.id) || request?.phase !== checkpoint.phase || request?.key !== fact.key ||
          Object.keys(request).sort().join() !== 'key,phase' || !isDeepStrictEqual(parse(resultTask.result?.summary), fact) ||
          !isDeepStrictEqual(resultTask.result?.evidence, [fact.id]) || resultTask.settledAt === null || resultTask.settledAt > checkpoint.at) continue
        const taskSequence = sequence(resultTask.id)
        if (!Number.isSafeInteger(taskSequence)) continue
        // IDs share the network's atomic sequence, so same-millisecond rewires
        // cannot be confused with changes committed after a request.
        const rewires = (record.rewireHistory ?? []).filter(row => row.nodeId === record.entryNodeId &&
          Number.isSafeInteger(sequence(row.id)) && sequence(row.id) < taskSequence).sort((a, b) => sequence(a.id) - sequence(b.id))
        const directPeers = rewires.at(-1)?.nextPeers ?? initialPeers
        if (!directPeers.includes(owner.id)) continue
        const requestMail = Object.values(record.mails).find(mail => mail.kind === 'task' && mail.taskId === resultTask.id &&
          mail.fromId === record.entryNodeId && mail.toId === owner.id && isDeepStrictEqual(parse(mail.body), request) &&
          mail.status === 'delivered' && mail.settledAt !== null && mail.settledAt <= resultTask.settledAt!)
        const resultMail = Object.values(record.mails).find(mail => mail.kind === 'result' && mail.taskId === resultTask.id &&
          mail.fromId === owner.id && mail.toId === record.entryNodeId &&
          (isDeepStrictEqual(parse(mail.body), fact) || mail.body === 'Local evidence.') && mail.status === 'delivered' &&
          mail.settledAt !== null && mail.settledAt <= checkpoint.at)
        if (requestMail && resultMail) { witness = { phase: checkpoint.phase, key: fact.key, document: fact.id,
          ownerSlot: ownerSlot!, ownerNodeId: owner.id, taskId: resultTask.id, requestMailId: requestMail.id,
          resultMailId: resultMail.id, deliveredAt: resultMail.settledAt!, directPeers: [...directPeers] }; break }
      }
      if (witness) facts.push(witness)
      else violations.push({ phase: checkpoint.phase, document: typeof row?.document === 'string' ? row.document : null,
        reason: 'no-exact-owner-direct-delivery-before-checkpoint' })
    }
  }
  return { version: 1, passed: violations.length === 0, submittedCheckpoints: checkpoints.length,
    auditedFacts: facts.length, facts, violations, noSubmission: checkpoints.length === 0,
    interpretation: 'Provenance only. No submission has no asserted facts; it remains a failed completion. Correctness is scored separately.' }
}
export type FactFlowAudit = ReturnType<typeof auditFactFlow>
export type BindingReferenceRun = Awaited<ReturnType<typeof runShiftingReference>>
export interface BindingReferencePair {
  conditions: { agents: number; seed: number; chainLength: number; topologyBinding: true; perNodeSteps: number; maxCalls: number; timeoutMs: number }
  sourceHashes: Record<string, string>; adaptive: BindingReferenceRun; fixed: BindingReferenceRun; 'fixed-wide'?: BindingReferenceRun
}

/** Recompute fixture and obtained facts; do not trust a saved `confirmed` flag. */
export function bindingReferenceGate(pair: BindingReferencePair | null | undefined,
  expected: { conditions: { seed: number; [key: string]: unknown }; sourceHashes: Record<string, string> }) {
  try {
    if (!pair || !isDeepStrictEqual(pair.sourceHashes, expected.sourceHashes) ||
      !Object.entries(pair.conditions).every(([key, value]) => expected.conditions[key] === value)) return false
    const { agents, seed, chainLength, perNodeSteps, maxCalls, timeoutMs, topologyBinding } = pair.conditions
    if (topologyBinding !== true || ![perNodeSteps, maxCalls, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0)) return false
    const task = createShiftingEvidenceTask(agents, seed, chainLength, true), proof = proveTopologyBinding(task)
    for (const mode of ['adaptive', 'fixed'] as const) {
      const run = pair[mode]
      if (run.seed !== seed || run.topologyMode !== mode || run.issuedModelCalls !== 0 || !isComparisonSeed(task, run.topologyProof) ||
        run.actions > maxCalls || run.maxNodeActions > perNodeSteps || run.requiredFactCount !== proof.requiredFacts.length ||
        run.factFlowAudit?.passed !== true || run.topology.nodes !== agents || run.topology.maxPeers !== 2 ||
        !Number.isSafeInteger(run.entrySteps) || run.entrySteps < 0 || run.entrySteps > perNodeSteps ||
        !Number.isSafeInteger(run.actions) || run.actions !== Object.values(run.actionsByNode).reduce((sum, count) => sum + count, 0) ||
        run.maxNodeActions !== Math.max(...Object.values(run.actionsByNode))) return false
      const obtained = proof.requiredFacts.filter(row => run.receivedFacts.some(received => received.phase === row.phase &&
        received.ownerSlot === row.holder && isDeepStrictEqual(received.fact, task.phases[row.phase - 1].facts.find(fact => fact.id === row.document)) &&
        validateRequestedEvidence(received.fact, { phase: row.phase, key: row.key }).status === 'accepted'))
      const evaluation = ([1, 2] as const).map(phase => evaluateChain(task, phase, run.checkpoints.find(row => row.phase === phase)?.answer))
      if (!isDeepStrictEqual(obtained, run.obtainedRequiredFacts) || run.obtainedRequiredFactCount !== obtained.length ||
        !isDeepStrictEqual(evaluation, run.evaluation) || run.passed !== evaluation.every(row => row.passed)) return false
      if (mode === 'adaptive' ? !run.passed || obtained.length !== proof.requiredFacts.length : run.passed || obtained.length >= proof.requiredFacts.length) return false
    }
    if (pair['fixed-wide']) {
      const run = pair['fixed-wide'], selection = run.staticSelection
      if (!selection || !isDeepStrictEqual(selection.peers, selectStaticWidePeers(selection.publicNodeIds)) ||
        !isDeepStrictEqual(Object.fromEntries(Object.keys(STATIC_WIDE_POLICY).map(key => [key, selection[key as keyof typeof selection]])), STATIC_WIDE_POLICY) ||
        !isDeepStrictEqual(run.initialPeerIds, selection.peers) || run.topology.maxPeers !== 4 || run.topology.nodes !== agents ||
        run.seed !== seed || run.topologyMode !== 'fixed-wide' || run.issuedModelCalls !== 0 || run.maxNodeActions > perNodeSteps ||
        run.actions > maxCalls || run.factFlowAudit?.passed !== true || !isComparisonSeed(task, run.topologyProof) ||
        !verifyTopologyBindingProof(task, run.staticTopologyProof, { entrySlot: 0, maxCollaborationPeers: 4, initialPeers: [agents - 1, 1, 2, 3] })) return false
      const obtained = proof.requiredFacts.filter(row => run.receivedFacts.some(received => received.phase === row.phase &&
        received.ownerSlot === row.holder && isDeepStrictEqual(received.fact, task.phases[row.phase - 1].facts.find(fact => fact.id === row.document))))
      const evaluation = ([1, 2] as const).map(phase => evaluateChain(task, phase, run.checkpoints.find(row => row.phase === phase)?.answer))
      if (!isDeepStrictEqual(obtained, run.obtainedRequiredFacts) || obtained.length !== run.obtainedRequiredFactCount ||
        !isDeepStrictEqual(evaluation, run.evaluation) || run.passed !== evaluation.every(row => row.passed)) return false
    }
    return true
  } catch { return false }
}

/** A zero model-call denominator is undefined, never Infinity or an invented multiplier. */
export function referenceCostRatios(actual: { issuedModelCalls: number; atnTotalInteractions: number; atnTotalTransferBytes: number; entrySteps: number | null },
  reference: Pick<BindingReferenceRun, 'issuedModelCalls' | 'totalInteractions' | 'totalTransferBytes' | 'entrySteps' | 'topologyMode'>) {
  const ratio = (value: number | null, baseline: number) => ({ actual: value, reference: baseline,
    multiple: value !== null && baseline > 0 ? value / baseline : null,
    status: baseline === 0 ? 'undefined-zero-reference' : value === null ? 'unknown-actual' : 'defined' })
  return { topology: reference.topologyMode, modelCalls: ratio(actual.issuedModelCalls, reference.issuedModelCalls),
    interactions: ratio(actual.atnTotalInteractions, reference.totalInteractions),
    transferBytes: ratio(actual.atnTotalTransferBytes, reference.totalTransferBytes), entrySteps: ratio(actual.entrySteps, reference.entrySteps),
    interpretation: 'Model coordination overhead relative to the same-topology constructive policy; not topology benefit. The fixed reference is incomplete.' }
}
