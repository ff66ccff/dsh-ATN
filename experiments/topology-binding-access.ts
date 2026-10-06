/** Closed evidence transport for revision 3. Same policy for every live node. */
import type { AtnRuntime } from '../src/runtime.ts'
import { AtnRefusal } from '../src/runtime.ts'
import { BINDING_SETUP_TASK, type ShiftingEvidenceScenario } from './shifting-evidence-task.ts'

export interface BindingRefusal { phase: number; sender: string; to: string; kind: string; taskId: string | null; code: string }
export function parseFactRequest(text: string): { phase: 1 | 2; key: string } {
  let value: unknown
  try { value = JSON.parse(text) } catch { /* Refuse all free prose requests. */ }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join() !== 'key,phase' ||
    !('phase' in value) || (value.phase !== 1 && value.phase !== 2) ||
    !('key' in value) || typeof value.key !== 'string' || !/^key-\d{2}$/.test(value.key)) {
    throw new AtnRefusal('invalid-fact-request', 'invalid-fact-request: body must be JSON {"phase":1|2,"key":"key-NN"}; no relay instructions or extra fields')
  }
  return { phase: value.phase, key: value.key }
}

export function installTopologyBindingAccess(atn: AtnRuntime, networkId: string, scenario: ShiftingEvidenceScenario,
  fixedPeers?: Readonly<Record<string, readonly string[]>>) {
  const refusals: BindingRefusal[] = []
  atn.installSendPolicy(networkId, (record, sender, input) => {
    try {
      if (input.kind === 'note') throw new AtnRefusal('fact-requests-and-owner-results-only', 'fact-requests-and-owner-results-only: notes cannot transport evidence')
      if (input.messageId !== undefined || input.dependsOn !== undefined || input.retryOf !== undefined) {
        throw new AtnRefusal('extra-transport-fields', 'extra-transport-fields: omit optional mail identities and dependency references in this experiment')
      }
      if (input.kind === 'task') {
        parseFactRequest(input.body)
        if (fixedPeers && sender.id !== input.to && !fixedPeers[sender.id]?.includes(input.to)) {
          throw new AtnRefusal('fixed-edge-required', 'fixed-edge-required: topology repair cannot grant a new fact channel outside the initial fixed ring')
        }
        if (input.summary !== undefined || (input.evidence?.length ?? 0) > 0) throw new AtnRefusal('invalid-fact-request', 'invalid-fact-request: no result payload on a request')
        return
      }
      const task = record.tasks[input.taskId ?? '']
      if (!task || task.holderId !== sender.id || task.requesterId !== input.to) throw new AtnRefusal('not-task-holder', 'Only the actual task holder may answer its requester')
      if (task.description === BINDING_SETUP_TASK) {
        if (input.body !== '{"ready":true}' || input.summary !== '{"ready":true}' || input.evidence?.length !== 0 || input.outcome === 'failed') {
          throw new AtnRefusal('invalid-setup-receipt', 'invalid-setup-receipt: initialization accepts only the fixed {"ready":true} receipt with empty evidence; facts must use a direct fact task')
        }
        return
      }
      const request = parseFactRequest(task.description)
      let fact: unknown
      try { fact = JSON.parse(input.summary ?? '') } catch { /* Non-evidence submissions are explicitly refused. */ }
      if (!scenario.ownsEvidence(sender.sessionId, fact)) {
        throw new AtnRefusal('evidence-not-owned', `evidence-not-owned: node ${sender.id} does not hold this exact local snapshot; forwarding another owner's result is forbidden`)
      }
      const owned = fact as { id: string; key: string }
      if (owned.key !== request.key || (input.body !== input.summary && input.body !== 'Local evidence.') ||
        input.evidence?.length !== 1 || input.evidence[0] !== owned.id || input.outcome === 'failed') {
        throw new AtnRefusal('invalid-owner-result', 'invalid-owner-result: return the requested exact local fact JSON in summary/body and its single document id as evidence')
      }
    } catch (error) {
      refusals.push({ phase: scenario.phase, sender: sender.id, to: input.to, kind: input.kind,
        taskId: input.taskId ?? null, code: error instanceof AtnRefusal ? error.code : 'binding-error' })
      throw error
    }
  })
  return { snapshot: () => ({ enforced: true, refusedResults: refusals.filter(row => row.code === 'evidence-not-owned').length,
    refusals: structuredClone(refusals) }) }
}
