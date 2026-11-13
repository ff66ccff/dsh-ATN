/** Host-frozen context shaping of incidental peer cards, not an evidence read ACL. */
import { MAX_KNOWLEDGE_ITEMS, MAX_KNOWLEDGE_TEXT_LENGTH, type NetworkRecord } from './schema.ts'
import type { NetworkOutboundPolicy } from './information-boundary.ts'
import { summarizeKnowledge } from './knowledge.ts'
import { summarizeLocalFeedback } from './local-feedback.ts'
import { summarizeRequesterFeedback } from './requester-feedback.ts'
import { summarizeVerifiedFeedback } from './verified-feedback.ts'

export type PeerDisclosure = NonNullable<NetworkRecord['limits']['peerDisclosure']>

export interface MinimalPeerSummary {
  readonly id: string
  readonly lifecycle: string
}

export interface FullPeerSummary extends MinimalPeerSummary {
  readonly openTasks: number
  readonly pendingVotes: number
  readonly taskSummaries: readonly string[]
  readonly recentResults: readonly string[]
  readonly verifiedFeedback: ReturnType<typeof summarizeVerifiedFeedback>
  readonly requesterFeedback: ReturnType<typeof summarizeRequesterFeedback>
  readonly knowledgeFingerprint: ReturnType<typeof summarizeKnowledge>
  readonly telemetry: ReturnType<typeof summarizeLocalFeedback>
}

export type OutcomeCategory = 'unobserved' | 'pending' | 'positive-only' | 'negative-only' | 'mixed'

export interface CoarsePeerSummary extends MinimalPeerSummary {
  readonly topics?: readonly string[]
  readonly availability: 'occupied' | 'no-current-obligations'
  readonly outcomes: { readonly requester: OutcomeCategory; readonly host: OutcomeCategory }
}

export type PeerSummary = FullPeerSummary | CoarsePeerSummary | MinimalPeerSummary

function outcomeCategory(positive: number, negative: number, pending: number): OutcomeCategory {
  const states = [positive > 0, negative > 0, pending > 0].filter(Boolean).length
  if (states > 1) return 'mixed'
  if (positive > 0) return 'positive-only'
  if (negative > 0) return 'negative-only'
  return pending > 0 ? 'pending' : 'unobserved'
}

function trustedTopics(record: NetworkRecord, peerId: string, policy?: NetworkOutboundPolicy): string[] {
  if (policy?.custody === undefined || policy.describeArtifact === undefined) return []
  const topics = [...policy.custody(peerId, record)].flatMap(id => policy.describeArtifact!(id, record).topics ?? [])
  return [...new Set(topics)].filter(topic => topic.trim().length > 0 && topic.length <= MAX_KNOWLEDGE_TEXT_LENGTH)
    .sort().slice(0, MAX_KNOWLEDGE_ITEMS)
}

export function isFullPeerSummary(peer: PeerSummary): peer is FullPeerSummary {
  return 'telemetry' in peer
}

/** Absence is legacy full even after host configuration changes or recovery. */
export function peerDisclosureMode(record: NetworkRecord): PeerDisclosure {
  return record.limits.peerDisclosure ?? 'full'
}

/** Build an allowlist response without changing any durable host facts. */
export function projectPeerSummary(record: NetworkRecord, peerId: string, observerId: string,
  policy?: NetworkOutboundPolicy, now: number = Date.now()): PeerSummary {
  const peer = record.nodes[peerId]!
  const identity = { id: peer.id, lifecycle: peer.lifecycle }
  if (peerDisclosureMode(record) === 'minimal') return identity
  const held = Object.values(record.tasks).filter(task => task.holderId === peerId)
  const ongoing = held.filter(task => task.status === 'open')
  const pendingVotes = Object.values(record.proposals).filter(proposal => proposal.status === 'pending' &&
    proposal.voters.includes(peerId) && !proposal.votes.some(vote => vote.voterId === peerId)).length
  const requester = summarizeRequesterFeedback(record, peerId, { observerId })
  const host = summarizeVerifiedFeedback(record, peerId, { observerId })
  if (peerDisclosureMode(record) === 'coarse') {
    const topics = trustedTopics(record, peerId, policy)
    return {
      ...identity,
      ...(topics.length === 0 ? {} : { topics }),
      availability: ongoing.length + pendingVotes > 0 ? 'occupied' : 'no-current-obligations',
      outcomes: {
        requester: outcomeCategory(requester.accepted, requester.rejected, requester.needsMore + requester.unrated + requester.openTasks),
        host: outcomeCategory(host.passed, host.failed, host.unverified + host.openTasks),
      },
    }
  }
  const recent = held.filter(task => task.status !== 'open')
    .sort((left, right) => (right.settledAt ?? 0) - (left.settledAt ?? 0) || right.id.localeCompare(left.id))
  return {
    ...identity,
    openTasks: ongoing.length,
    pendingVotes,
    taskSummaries: [...ongoing, ...recent].slice(0, 3).map(task => task.description.slice(0, 240)),
    recentResults: recent.slice(0, 2).map(task => `[${task.status}] ${task.result?.summary ?? task.description}`.slice(0, 240)),
    verifiedFeedback: host,
    requesterFeedback: requester,
    knowledgeFingerprint: summarizeKnowledge(record, peerId, policy),
    telemetry: summarizeLocalFeedback(record, peerId, { observerId, now }),
  }
}
