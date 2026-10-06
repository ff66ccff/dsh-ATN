/** Bounded self-reported discovery hints, with separately sourced outcome counts. */
import {
  knowledgeFingerprintSchema, type KnowledgeFingerprint, type NetworkRecord,
} from './schema.ts'
import { summarizeRequesterFeedback } from './requester-feedback.ts'
import { summarizeVerifiedFeedback } from './verified-feedback.ts'

/** Each publication replaces the entire prior index; empty arrays clear a field. */
export type PublishKnowledgeInput = Omit<KnowledgeFingerprint, 'updatedAt'>

export class KnowledgeError extends Error {
  constructor(
    readonly code: 'not-open' | 'unknown-node' | 'not-active' | 'invalid-knowledge',
    message: string,
  ) {
    super(message)
    this.name = 'KnowledgeError'
  }
}

export interface KnowledgeSummary extends PublishKnowledgeInput {
  /** Only the descriptive arrays above are self-reported. They never prove correctness. */
  source: 'self-reported'
  updatedAt: number | null
  /** Runtime-derived unfinished obligations, not a self-published availability claim. */
  currentLoad: number
  /** Requester opinions from recent eligible submissions; independent of host verification. */
  requesterAccepted: number
  requesterRejected: number
  requesterNeedsMore: number
  requesterAcceptanceRate: number | null
  requesterTaskIds: string[]
  requesterOmittedTasks: number
  /** Host verdicts from the bounded verified-feedback sample. */
  hostPassed: number
  hostFailed: number
  hostTaskIds: string[]
  hostOmittedTasks: number
}

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
}

function deduplicate(items: string[]): string[] {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = normalize(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Publish only the authenticated caller's index. The runtime supplies nodeId and
 * time and commits this transform atomically. No mail, task, step or wakeup is
 * created; this is an index update, not a request to another agent.
 */
export function publishKnowledge(
  record: NetworkRecord,
  nodeId: string,
  input: PublishKnowledgeInput,
  now: number,
): NetworkRecord {
  if (record.status !== 'open' || now >= record.deadlineAt) {
    throw new KnowledgeError('not-open', 'knowledge publication requires an open network')
  }
  const node = record.nodes[nodeId]
  if (node === undefined) throw new KnowledgeError('unknown-node', `node ${nodeId} is not part of the network`)
  if (node.lifecycle !== 'active' || node.creationState !== 'published') {
    throw new KnowledgeError('not-active', 'only an active published node may publish knowledge')
  }
  const parsed = knowledgeFingerprintSchema.safeParse({ ...input, updatedAt: now })
  if (!parsed.success) throw new KnowledgeError('invalid-knowledge', parsed.error.message)
  const fingerprint = {
    ...parsed.data,
    documents: deduplicate(parsed.data.documents),
    topics: deduplicate(parsed.data.topics),
    contributions: deduplicate(parsed.data.contributions),
  }
  const prior = node.knowledgeFingerprint
  if (prior !== undefined && (['documents', 'topics', 'contributions'] as const).every(key =>
    prior[key].length === fingerprint[key].length && prior[key].every((value, index) => value === fingerprint[key][index]))) {
    return record
  }
  return { ...record, nodes: { ...record.nodes, [nodeId]: { ...node, knowledgeFingerprint: fingerprint } } }
}

/** Declarations and observed outcomes stay separate; legacy nodes have an empty index. */
export function summarizeKnowledge(record: NetworkRecord, nodeId: string): KnowledgeSummary {
  const fingerprint = record.nodes[nodeId]?.knowledgeFingerprint
  const entries = (record.whiteboard?.entries ?? []).filter(entry => entry.authorId === nodeId)
  const requester = summarizeRequesterFeedback(record, nodeId)
  const verified = summarizeVerifiedFeedback(record, nodeId)
  return {
    source: 'self-reported',
    documents: deduplicate([...entries.flatMap(entry => entry.documents ?? []), ...(fingerprint?.documents ?? [])]).slice(0, 16),
    topics: deduplicate([...entries.flatMap(entry => entry.topics), ...(fingerprint?.topics ?? [])]).slice(0, 16),
    contributions: deduplicate([...entries.map(entry => entry.key), ...(fingerprint?.contributions ?? [])]).slice(0, 16),
    updatedAt: entries.length === 0 ? fingerprint?.updatedAt ?? null : Math.max(...entries.map(entry => entry.updatedAt), fingerprint?.updatedAt ?? 0),
    currentLoad: Object.values(record.tasks).filter(task => task.holderId === nodeId && task.status === 'open').length,
    requesterAccepted: requester.accepted,
    requesterRejected: requester.rejected,
    requesterNeedsMore: requester.needsMore,
    requesterAcceptanceRate: requester.acceptanceRate,
    requesterTaskIds: [...requester.taskIds],
    requesterOmittedTasks: requester.omittedTasks,
    hostPassed: verified.passed,
    hostFailed: verified.failed,
    hostTaskIds: [...verified.taskIds],
    hostOmittedTasks: verified.omittedTasks,
  }
}

/**
 * Relevance only: distinct query terms and a phrase match, never declaration
 * frequency or an unverified popularity claim. Runtime ranking can use actual
 * requester feedback and current load to break ties. Task context remains a
 * fallback for legacy nodes that have never published an index.
 */
export function scoreKnowledgeQuery(record: NetworkRecord, nodeId: string, query: string): number {
  const node = record.nodes[nodeId]
  const needle = normalize(query)
  if (node === undefined || needle.length === 0) return 0
  if (needle === '*') return 1
  const terms = [...new Set(needle.split(' '))]
  const fingerprint = node.knowledgeFingerprint
  const entries = (record.whiteboard?.entries ?? []).filter(entry => entry.authorId === nodeId)
  const declared = [...entries.flatMap(entry => [entry.key, ...entry.topics, ...(entry.documents ?? [])]),
    ...(fingerprint === undefined ? [] : [...fingerprint.documents, ...fingerprint.topics, ...fingerprint.contributions])].map(normalize)
  const fallback = [nodeId, ...Object.values(record.tasks).filter(task => task.holderId === nodeId)
    .flatMap(task => [task.description, task.context, task.result?.summary ?? '']), ...entries.map(entry => entry.body)].map(normalize)
  const declaredHits = terms.filter(term => declared.some(text => text.includes(term))).length
  const fallbackHits = terms.filter(term => fallback.some(text => text.includes(term))).length
  const phraseBonus = declared.some(text => text.includes(needle)) ? terms.length * 2 : 0
  return declaredHits * 2 + phraseBonus + fallbackHits
}
