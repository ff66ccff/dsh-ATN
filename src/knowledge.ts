/** Bounded host custody metadata, with separately sourced outcome counts. */
import {
  MAX_KNOWLEDGE_ITEMS, MAX_KNOWLEDGE_TEXT_LENGTH, type KnowledgeFingerprint, type NetworkRecord,
} from './schema.ts'
import { summarizeRequesterFeedback } from './requester-feedback.ts'
import { summarizeVerifiedFeedback } from './verified-feedback.ts'
import type { NetworkOutboundPolicy } from './information-boundary.ts'

/** Trusted host metadata; never an agent publication input. */
export type KnowledgeMetadata = Pick<KnowledgeFingerprint, 'documents' | 'topics' | 'contributions'>

export interface KnowledgeSummary extends KnowledgeMetadata {
  source: 'host-custody'
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

function bounded(items: readonly string[]): string[] {
  return [...new Set(items)].filter(item => item.trim().length > 0 && item.length <= MAX_KNOWLEDGE_TEXT_LENGTH)
    .sort().slice(0, MAX_KNOWLEDGE_ITEMS)
}

function metadata(record: NetworkRecord, nodeId: string, policy?: NetworkOutboundPolicy): KnowledgeMetadata {
  if (policy?.custody !== undefined) {
    const documents = bounded([...policy.custody(nodeId, record)])
    const topics = bounded(documents.flatMap(id => policy.describeArtifact?.(id, record).topics ??
      id.split(/[\s/.:_-]+/).filter(Boolean)))
    return { documents, topics, contributions: [] }
  }
  const saved = record.nodes[nodeId]?.knowledgeFingerprint
  // Unmarked pre-0.5 self-reports never become custody assertions on upgrade.
  return saved?.source === 'host-custody'
    ? { documents: [...saved.documents], topics: [...saved.topics], contributions: [] }
    : { documents: [], topics: [], contributions: [] }
}

/** Identical custody projections retain their timestamps and do not wake peers. */
export function refreshKnowledge(record: NetworkRecord, policy: NetworkOutboundPolicy | undefined, now: number): NetworkRecord {
  if (policy?.custody === undefined) return record
  const nodes = { ...record.nodes }
  let changed = false
  for (const node of Object.values(nodes)) {
    const next = metadata(record, node.id, policy)
    const prior = node.knowledgeFingerprint
    if (prior?.source === 'host-custody' && (['documents', 'topics', 'contributions'] as const).every(key =>
      JSON.stringify(prior[key]) === JSON.stringify(next[key]))) continue
    nodes[node.id] = { ...node, knowledgeFingerprint: { ...next, source: 'host-custody', updatedAt: now } }
    changed = true
  }
  return changed ? { ...record, nodes } : record
}

/** Custody metadata and observed outcomes stay separate. */
export function summarizeKnowledge(record: NetworkRecord, nodeId: string, policy?: NetworkOutboundPolicy): KnowledgeSummary {
  const requester = summarizeRequesterFeedback(record, nodeId)
  const verified = summarizeVerifiedFeedback(record, nodeId)
  return {
    source: 'host-custody', ...metadata(record, nodeId, policy),
    updatedAt: record.nodes[nodeId]?.knowledgeFingerprint?.source === 'host-custody'
      ? record.nodes[nodeId]!.knowledgeFingerprint!.updatedAt : null,
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
 * Same distinct-term/phrase weights; configured custody excludes agent-authored
 * task text. Unconfigured legacy networks retain their task-text fallback.
 */
export function scoreKnowledgeQuery(record: NetworkRecord, nodeId: string, query: string, policy?: NetworkOutboundPolicy): number {
  const node = record.nodes[nodeId]
  const needle = normalize(query)
  if (node === undefined || needle.length === 0) return 0
  if (needle === '*') return 1
  const terms = [...new Set(needle.split(' '))]
  const index = metadata(record, nodeId, policy)
  const declared = [...index.documents, ...index.topics, ...index.contributions].map(normalize)
  const fallback = [nodeId, ...(policy?.custody !== undefined || node.knowledgeFingerprint?.source === 'host-custody' ? [] :
    Object.values(record.tasks).filter(task => task.holderId === nodeId)
      .flatMap(task => [task.description, task.context, task.result?.summary ?? '']))].map(normalize)
  const declaredHits = terms.filter(term => declared.some(text => text.includes(term))).length
  const fallbackHits = terms.filter(term => fallback.some(text => text.includes(term))).length
  const phraseBonus = declared.some(text => text.includes(needle)) ? terms.length * 2 : 0
  return declaredHits * 2 + phraseBonus + fallbackHits
}
