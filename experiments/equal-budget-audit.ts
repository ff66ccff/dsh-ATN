/** Positive source-to-submission evidence for every architecture, including forwarded facts. */
import { isDeepStrictEqual } from 'node:util'
import type { EqualBudgetTask } from './equal-budget-task.ts'

export interface EqualBudgetFact {
  id: string
  documentIds: readonly string[]
  /** The complete local result object. Use a shard identity as well as its value. */
  result: unknown
  /** Compact submissions depend on this shard, even though they omit its local values. */
  localResultShard?: string
}
export type EqualBudgetFactEvent = {
  kind: 'read'; seq: number; agent: string; documentId: string
} | {
  kind: 'transport'; seq: number; from: string; to: string
  transport: 'atn' | 'native' | 'independent'; content: string; delivered: boolean
  /** Enqueue/content-capture boundary; seq is delivery. Unknown boundaries cannot prove a fact path. */
  sentSeq?: number
}
export interface EqualBudgetSubmission { seq: number; agent: string; answer: string }
export interface EqualBudgetFactAuditInput {
  documents: readonly { id: string; text: string }[]
  facts: readonly EqualBudgetFact[]
  events: readonly EqualBudgetFactEvent[]
  submission: EqualBudgetSubmission | null
}

/** Actual submitted values only: source provenance is independent of oracle correctness. */
export function buildEqualBudgetAuditFacts(task: EqualBudgetTask, answer: string): EqualBudgetFact[] {
  let parsed: unknown
  try { parsed = JSON.parse(answer) } catch { return [] }
  if (task.compactAnswer && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const value = parsed as Record<string, unknown>
    if (!isBalances(value.mergedNetByAccount) || !Number.isSafeInteger(value.grandTotal)) return []
    return task.shardIds.map(id => ({ id, documentIds: ['policy', `${id}/orders`, `${id}/events`, `${id}/corrections`],
      result: { mergedNetByAccount: value.mergedNetByAccount, grandTotal: value.grandTotal }, localResultShard: id }))
  }
  if (!parsed || typeof parsed !== 'object' || !('shards' in parsed)
    || !parsed.shards || typeof parsed.shards !== 'object' || Array.isArray(parsed.shards)) return []
  const shards = parsed.shards as Record<string, unknown>
  return task.shardIds.filter(id => Object.hasOwn(shards, id) && shards[id] !== null && typeof shards[id] === 'object')
    .map(id => ({ id, documentIds: ['policy', `${id}/orders`, `${id}/events`, `${id}/corrections`], result: { [id]: shards[id] } }))
}
export interface EvidenceStep {
  seq: number; kind: 'read' | 'transport'; agent: string
  from?: string; transport?: 'atn' | 'native' | 'independent'; documentId?: string
}

/** Balanced JSON substrings also cover fenced JSON embedded in ordinary prose. */
function jsonValues(text: string): unknown[] {
  const values: unknown[] = []
  try { values.push(JSON.parse(text)) } catch { /* Embedded JSON follows. */ }
  let start = -1, quoted = false, escaped = false
  const stack: string[] = []
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (start < 0) {
      if (char === '{' || char === '[') { start = index; stack.push(char); quoted = false; escaped = false }
      continue
    }
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === '{' || char === '[') stack.push(char)
    else if (char === '}' || char === ']') {
      if (stack.pop() !== (char === '}' ? '{' : '[')) { start = -1; stack.length = 0; continue }
      if (!stack.length) {
        try { values.push(JSON.parse(text.slice(start, index + 1))) } catch { /* Unrecognized text is not evidence. */ }
        start = -1
      }
    }
  }
  return values
}

function containsResult(value: unknown, result: unknown, depth = 0): boolean {
  if (depth > 20) return false
  if (isDeepStrictEqual(value, result)) return true
  if (typeof value === 'string') return jsonValues(value).some(item => containsResult(item, result, depth + 1))
  if (!value || typeof value !== 'object') return false
  // Extra provenance fields do not erase a complete local result object.
  if (result && typeof result === 'object' && !Array.isArray(result) && !Array.isArray(value)) {
    const entries = Object.entries(result)
    if (entries.length && entries.every(([key, expected]) => Object.hasOwn(value, key)
      && isDeepStrictEqual((value as Record<string, unknown>)[key], expected))) return true
  }
  return Object.values(value).some(item => containsResult(item, result, depth + 1))
}

export function textContainsEqualBudgetResult(text: string, result: unknown): boolean {
  return jsonValues(text).some(value => containsResult(value, result))
}

function isBalances(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), ['A', 'B', 'C', 'D'])
    && Object.values(value).every(balance => Number.isSafeInteger(balance))
}

/** Source access and an explicitly identified complete local balance are required.
 * These values come from observed messages, never from the constructive oracle.
 * The witness proves availability of every merge input, not that the model used it.
 */
function containsShardResult(value: unknown, shard: string, depth = 0): boolean {
  if (depth > 20) return false
  if (typeof value === 'string') return jsonValues(value).some(item => containsShardResult(item, shard, depth + 1))
  if (!value || typeof value !== 'object') return false
  const object = value as Record<string, unknown>
  const local = object[shard]
  if (local && typeof local === 'object' && !Array.isArray(local) && isBalances((local as Record<string, unknown>).netByAccount)) return true
  if ((object.shard === shard || object.shardId === shard) && isBalances(object.netByAccount)) return true
  return Object.values(value).some(item => containsShardResult(item, shard, depth + 1))
}

function textContainsFact(text: string, fact: EqualBudgetFact): boolean {
  return fact.localResultShard
    ? jsonValues(text).some(value => containsShardResult(value, fact.localResultShard!))
    : textContainsEqualBudgetResult(text, fact.result)
}

/**
 * A successful read is evidence of source access. A delivered payload transfers
 * knowledge only when it contains full document text or a complete local result
 * already grounded at the sender. Mere citations, connectivity and send attempts
 * are insufficient. These are observational witnesses, not proof of cognition.
 */
export function auditEqualBudgetFactFlow(input: EqualBudgetFactAuditInput) {
  const violations: string[] = []
  const documents = new Map(input.documents.map(document => [document.id, document.text]))
  if (documents.size !== input.documents.length || input.documents.some(document => !document.id || !document.text)) {
    throw new TypeError('Fact audit needs unique nonempty documents')
  }
  if (new Set(input.facts.map(fact => fact.id)).size !== input.facts.length
    || input.facts.some(fact => !fact.id || !fact.documentIds.length || !fact.result || typeof fact.result !== 'object'
      || fact.documentIds.some(id => !documents.has(id)))) throw new TypeError('Fact audit needs unique grounded local result objects')
  const sequences = new Set<number>()
  for (const event of input.events) {
    if (!Number.isSafeInteger(event.seq) || event.seq < 0 || sequences.has(event.seq)) violations.push('invalid-or-duplicate-event-sequence')
    sequences.add(event.seq)
  }
  if (input.submission && (!Number.isSafeInteger(input.submission.seq) || input.submission.seq < 0
    || sequences.has(input.submission.seq) || !input.submission.agent)) violations.push('invalid-submission-boundary')
  const knowledge = new Map<string, Map<string, EvidenceStep[]>>()
  const factsKnown = new Map<string, Map<string, EvidenceStep[]>>()
  const store = (map: Map<string, Map<string, EvidenceStep[]>>, agent: string) => {
    let current = map.get(agent)
    if (!current) { current = new Map(); map.set(agent, current) }
    return current
  }
  const grounded = (agent: string, fact: EqualBudgetFact, throughSeq = Number.MAX_SAFE_INTEGER): EvidenceStep[] | null => {
    const prior = factsKnown.get(agent)?.get(fact.id)
    if (prior?.every(step => step.seq <= throughSeq)) return prior
    const local = knowledge.get(agent)
    if (!fact.documentIds.every(id => local?.get(id)?.every(step => step.seq <= throughSeq))) return null
    return fact.documentIds.flatMap(id => local!.get(id)!)
  }
  let deliveredTransports = 0, reads = 0, transportSendBoundaryUnknown = 0
  for (const event of [...input.events].sort((a, b) => a.seq - b.seq)) {
    if (input.submission && event.seq >= input.submission.seq) continue
    if (event.kind === 'read') {
      if (!event.agent || !documents.has(event.documentId)) { violations.push('unrecognized-document-read'); continue }
      reads++
      const local = store(knowledge, event.agent)
      if (!local.has(event.documentId)) local.set(event.documentId, [{ seq: event.seq, kind: 'read', agent: event.agent, documentId: event.documentId }])
      continue
    }
    if (!event.delivered) continue
    deliveredTransports++
    if (!event.from || !event.to) { violations.push('unidentified-transport-endpoint'); continue }
    if (event.sentSeq === undefined) { transportSendBoundaryUnknown++; continue }
    if (!Number.isSafeInteger(event.sentSeq) || event.sentSeq < 0 || event.sentSeq > event.seq) {
      violations.push('invalid-transport-send-boundary'); continue
    }
    const step: EvidenceStep = { seq: event.seq, kind: 'transport', agent: event.to, from: event.from, transport: event.transport }
    const source = knowledge.get(event.from)
    const destination = store(knowledge, event.to)
    for (const [id, text] of documents) {
      if (source?.get(id)?.every(step => step.seq <= event.sentSeq!)
        && (event.content.includes(text) || event.content.includes(JSON.stringify(text).slice(1, -1)))) {
        if (!destination.has(id)) destination.set(id, [...source.get(id)!, { ...step, documentId: id }])
      }
    }
    const destinationFacts = store(factsKnown, event.to)
    for (const fact of input.facts) {
      const path = grounded(event.from, fact, event.sentSeq)
      if (path && textContainsFact(event.content, fact) && !destinationFacts.has(fact.id)) {
        destinationFacts.set(fact.id, [...path, step])
      }
    }
  }
  const facts = input.submission ? input.facts.map(fact => {
    const included = textContainsEqualBudgetResult(input.submission!.answer, fact.result)
    const path = grounded(input.submission!.agent, fact)
    if (!included) violations.push(`submitted-result-unrecognized:${fact.id}`)
    if (!path) violations.push(`missing-positive-source-path:${fact.id}`)
    return { id: fact.id, documentIds: [...fact.documentIds], submittedResultRecognized: included,
      grounded: path !== null, path: path ?? [], passed: included && path !== null }
  }) : []
  if (input.submission && input.facts.length === 0) violations.push('no-recognized-submitted-facts')
  return { version: 1 as const, passed: violations.length === 0, noSubmission: input.submission === null,
    positiveCompletionEvidence: input.submission !== null && input.facts.length > 0 && violations.length === 0,
    submittedFacts: input.submission ? input.facts.length : 0, auditedFacts: facts.filter(fact => fact.passed).length,
    documentReads: reads, deliveredTransports, transportSendBoundaryUnknown, facts, violations: [...new Set(violations)],
    interpretation: 'Positive observed source and delivered-content paths only; no inference from shared permissions or network connectivity. Missing or unrecognized witnesses are audit gaps, not evidence of cheating. Submitted values are audited independently of correctness. For compact submissions every shard remains a required dependency: an observed complete, identified local balance may transfer that dependency only after its source documents reached the sender. This shows merge-input availability, not cognitive use or arithmetic correctness.' }
}
