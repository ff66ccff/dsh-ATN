/**
 * Unanimous shared-document review.
 *
 * A proposal freezes its base version, its replacement body and its approver
 * list at creation time. Approval needs every frozen approver's explicit,
 * recorded consent; a rejection, silence or a deadline expiry never commits.
 * Votes stay bound to the proposal they were cast on, so rewriting the body or
 * reshaping the topology cannot reuse them.
 * @module dsh-atn/proposals
 */
import { currentGoal, allocateId, LimitExceededError, NetworkStoreError } from './domain.ts'
import { utf8Bytes } from './config.ts'
import { changedContractFields, governanceVoters } from './governance.ts'
import type { GoalDocument, NetworkRecord, ProposalId, ProposalRecord, VoteRecord } from './schema.ts'

/** Why a proposal operation was refused. */
export type ProposalErrorCode =
  | 'unknown-proposal'
  | 'duplicate-id'
  | 'not-pending'
  | 'no-approvers'
  | 'not-a-voter'
  | 'already-voted-differently'
  | 'document-too-large'
  | 'network-closed'
  | 'proposer-not-active'
  | 'protected-goal'

/** Raised when a proposal operation violates the recorded rules. */
export class ProposalError extends Error {
  /** Machine-readable cause. */
  readonly code: ProposalErrorCode

  /**
   * @param code - Machine-readable cause.
   * @param message - Human-readable detail.
   */
  constructor(code: ProposalErrorCode, message: string) {
    super(message)
    this.name = 'ProposalError'
    this.code = code
  }
}

/** Input for opening one proposal. */
export interface OpenProposalInput {
  /** Node opening the proposal. */
  readonly proposerId: string
  /** Full replacement document, fixed from here on. */
  readonly document: GoalDocument
  /** Why the change is proposed. */
  readonly rationale: string
  /** Creation timestamp (epoch ms). */
  readonly now: number
  /** Stable id chosen by the caller; falls back to the network counter. */
  readonly id?: ProposalId
}

/**
 * Open one immutable proposal and freeze its approver list.
 *
 * @param record - Current network record.
 * @param input - Proposer, replacement document and rationale.
 * @returns The updated record and the new proposal.
 * @throws ProposalError when the network is closed, the proposer cannot propose, or there are no approvers.
 * @throws LimitExceededError when the cumulative proposal bound is reached.
 */
export function openProposal(record: NetworkRecord, input: OpenProposalInput): { record: NetworkRecord; proposal: ProposalRecord } {
  if (record.status !== 'open') {
    throw new ProposalError('network-closed', `network ${record.id} is ${record.status}`)
  }
  const proposer = record.nodes[input.proposerId]
  if (proposer === undefined) {
    throw new NetworkStoreError('missing', `proposer ${input.proposerId} is not part of network ${record.id}`)
  }
  if (proposer.lifecycle !== 'active' || proposer.creationState !== 'published') {
    throw new ProposalError('proposer-not-active', `node ${input.proposerId} is ${proposer.lifecycle} and cannot propose`)
  }

  const changed = changedContractFields(record, input.document)
  if (changed.length > 0) {
    throw new ProposalError('protected-goal', `a proposal cannot change the startup contract (${changed.join(', ')}); revise only the plan`)
  }
  if (Object.keys(record.proposals).length >= record.limits.maxProposals) {
    throw new LimitExceededError('maxProposals', `network ${record.id} already recorded ${record.limits.maxProposals} proposals`)
  }
  const size = utf8Bytes(JSON.stringify(input.document))
  if (size > record.limits.maxDocumentBytes) {
    throw new ProposalError(
      'document-too-large',
      `document is ${size} bytes, above the ${record.limits.maxDocumentBytes} byte bound`,
    )
  }

  const base = currentGoal(record)
  const voters = governanceVoters(record, input.proposerId)
  if (voters.length === 0) {
    throw new ProposalError('no-approvers', `node ${input.proposerId} has no active approvers and cannot change the shared document`)
  }

  const allocated = input.id === undefined ? allocateId(record, 'proposal') : { id: input.id, next: record }
  if (input.id !== undefined && record.proposals[input.id] !== undefined) {
    throw new ProposalError('duplicate-id', `proposal ${input.id} already exists in network ${record.id}`)
  }
  const proposalId = allocated.id
  const proposal: ProposalRecord = {
    id: proposalId,
    proposerId: input.proposerId,
    baseVersion: base.version,
    document: { ...input.document },
    rationale: input.rationale,
    voters,
    votes: [],
    status: 'pending',
    deadlineAt: Math.min(input.now + record.limits.proposalDeadlineMs, record.deadlineAt),
    createdAt: input.now,
    settledAt: null,
    committedVersion: null,
    note: null,
  }
  return {
    record: { ...allocated.next, proposals: { ...allocated.next.proposals, [proposalId]: proposal } },
    proposal,
  }
}

/** Input for casting one vote. */
export interface CastVoteInput {
  /** Proposal being voted on. */
  readonly proposalId: ProposalId
  /** Real voter identity, resolved from the live agent. */
  readonly voterId: string
  /** Explicit consent (`true`) or dissent (`false`). */
  readonly approve: boolean
  /** Optional rationale. */
  readonly reason: string | null
  /** Vote timestamp (epoch ms). */
  readonly now: number
}

/** Result of casting a vote. */
export interface CastVoteResult {
  /** Network record after the vote and any resulting resolution. */
  readonly record: NetworkRecord
  /** Proposal state after the vote. */
  readonly proposal: ProposalRecord
  /** `true` when the identical vote was already recorded, so nothing was written. */
  readonly idempotent: boolean
}

/**
 * Record one voter's explicit decision and resolve the proposal if it is now decided.
 *
 * @param record - Current network record.
 * @param input - Proposal, voter and decision.
 * @returns The updated record and the resolved proposal.
 * @throws ProposalError when the proposal is not pending, the voter is not on the frozen list, or the vote contradicts an earlier one.
 */
export function castVote(record: NetworkRecord, input: CastVoteInput): CastVoteResult {
  const proposal = record.proposals[input.proposalId]
  if (proposal === undefined) {
    throw new ProposalError('unknown-proposal', `proposal ${input.proposalId} is not part of network ${record.id}`)
  }
  if (proposal.status !== 'pending') {
    throw new ProposalError('not-pending', `proposal ${proposal.id} is already ${proposal.status}`)
  }
  if (!proposal.voters.includes(input.voterId)) {
    throw new ProposalError(
      'not-a-voter',
      `node ${input.voterId} is not on the frozen approver list of proposal ${proposal.id}`,
    )
  }
  const existing = proposal.votes.find((vote) => vote.voterId === input.voterId)
  if (existing !== undefined) {
    if (existing.approve === input.approve) {
      // An identical retry is idempotent: it must not add a second vote or a
      // second revision. The proposal is read back from the record the caller
      // holds, never from a snapshot captured before earlier mutations.
      return { record, proposal: record.proposals[input.proposalId]!, idempotent: true }
    }
    throw new ProposalError(
      'already-voted-differently',
      `node ${input.voterId} already voted ${existing.approve ? 'approve' : 'reject'} on proposal ${proposal.id}`,
    )
  }

  const vote: VoteRecord = {
    voterId: input.voterId,
    approve: input.approve,
    reason: input.reason,
    at: input.now,
  }
  const voted: ProposalRecord = { ...proposal, votes: [...proposal.votes, vote] }
  const withVote: NetworkRecord = { ...record, proposals: { ...record.proposals, [voted.id]: voted } }
  return { ...resolveProposal(withVote, voted.id, input.now), idempotent: false }
}

/**
 * Resolve a pending proposal from its recorded votes, the deadline and the
 * current goal version, committing the replacement document when every frozen
 * approver agreed.
 *
 * @param record - Current network record, already carrying the proposal's votes.
 * @param proposalId - Proposal to resolve.
 * @param now - Evaluation timestamp (epoch ms).
 * @returns The updated record and the proposal's state.
 */
export function resolveProposal(record: NetworkRecord, proposalId: ProposalId, now: number): { record: NetworkRecord; proposal: ProposalRecord } {
  const proposal = record.proposals[proposalId]
  if (proposal === undefined) {
    throw new ProposalError('unknown-proposal', `proposal ${proposalId} is not part of network ${record.id}`)
  }
  if (proposal.status !== 'pending') return { record, proposal }

  const settle = (status: ProposalRecord['status'], note: string, committedVersion: number | null): NetworkRecord => ({
    ...record,
    proposals: {
      ...record.proposals,
      [proposalId]: { ...proposal, status, note, settledAt: now, committedVersion },
    },
  })

  // Pre-upgrade proposals keep their frozen electorate and votes, but a
  // previously legal contract replacement cannot bypass the current guard.
  // Empty historical lists are never allowed to pass by vacuous unanimity.
  const changed = changedContractFields(record, proposal.document)
  if (changed.length > 0 || proposal.voters.length === 0) {
    const note = changed.length > 0
      ? `proposal changes the protected startup contract (${changed.join(', ')})`
      : 'proposal has no frozen approvers'
    const next = settle('cancelled', note, null)
    return { record: next, proposal: next.proposals[proposalId]! }
  }

  if (proposal.votes.some((vote) => !vote.approve)) {
    return { record: settle('rejected', 'at least one approver rejected the proposal', null), proposal: { ...proposal, status: 'rejected', note: 'at least one approver rejected the proposal', settledAt: now, committedVersion: null } }
  }

  const approved = new Set(proposal.votes.filter((vote) => vote.approve).map((vote) => vote.voterId))
  const unanimous = proposal.voters.every((voter) => approved.has(voter))
  if (!unanimous) {
    if (now >= proposal.deadlineAt) {
      const note = 'the proposal deadline passed without every approver consenting'
      return { record: settle('expired', note, null), proposal: { ...proposal, status: 'expired', note, settledAt: now, committedVersion: null } }
    }
    return { record, proposal }
  }

  // Final commit checks share one atomic update: open network, live deadline, unchanged base version.
  if (record.status !== 'open') {
    const note = `network became ${record.status} before the last approval committed`
    return { record: settle('cancelled', note, null), proposal: { ...proposal, status: 'cancelled', note, settledAt: now, committedVersion: null } }
  }
  if (now >= proposal.deadlineAt) {
    const note = 'the proposal deadline passed before the last approval committed'
    return { record: settle('expired', note, null), proposal: { ...proposal, status: 'expired', note, settledAt: now, committedVersion: null } }
  }
  const base = currentGoal(record)
  if (base.version !== proposal.baseVersion) {
    const note = `goal version moved from ${proposal.baseVersion} to ${base.version} while the proposal was pending`
    return { record: settle('stale', note, null), proposal: { ...proposal, status: 'stale', note, settledAt: now, committedVersion: null } }
  }

  const version = base.version + 1
  const next: NetworkRecord = {
    ...record,
    goalHistory: [
      ...record.goalHistory,
      { version, document: proposal.document, proposedBy: proposal.proposerId, approvedBy: [...proposal.voters], committedAt: now },
    ],
    proposals: {
      ...record.proposals,
      [proposalId]: { ...proposal, status: 'committed', note: null, settledAt: now, committedVersion: version },
    },
  }
  return { record: next, proposal: next.proposals[proposalId]! }
}

/**
 * Expire every pending proposal whose deadline has passed.
 *
 * @param record - Current network record.
 * @param now - Evaluation timestamp (epoch ms).
 * @returns The updated record.
 */
export function expireProposals(record: NetworkRecord, now: number): NetworkRecord {
  let next = record
  for (const proposal of Object.values(record.proposals)) {
    if (proposal.status !== 'pending' || now < proposal.deadlineAt) continue
    next = resolveProposal(next, proposal.id, now).record
  }
  return next
}

/**
 * Cancel every pending proposal, used when the network stops or the shared
 * document can no longer be changed.
 *
 * @param record - Current network record.
 * @param note - Why the proposals were cancelled.
 * @param now - Cancellation timestamp (epoch ms).
 * @returns The updated record.
 */
export function cancelPendingProposals(record: NetworkRecord, note: string, now: number): NetworkRecord {
  const proposals = { ...record.proposals }
  for (const proposal of Object.values(proposals)) {
    if (proposal.status !== 'pending') continue
    proposals[proposal.id] = { ...proposal, status: 'cancelled', note, settledAt: now, committedVersion: null }
  }
  return { ...record, proposals }
}

/**
 * List the proposals one node still owes a vote on.
 *
 * @param record - Current network record.
 * @param nodeId - Potential voter.
 * @returns Pending proposals naming that node on their frozen approver list.
 */
export function pendingVotesFor(record: NetworkRecord, nodeId: string): ProposalRecord[] {
  return Object.values(record.proposals).filter(
    (proposal) => proposal.status === 'pending' && proposal.voters.includes(nodeId) && !proposal.votes.some((vote) => vote.voterId === nodeId),
  )
}

/**
 * List every pending proposal.
 *
 * @param record - Current network record.
 * @returns Pending proposals in creation order.
 */
export function pendingProposals(record: NetworkRecord): ProposalRecord[] {
  return Object.values(record.proposals)
    .filter((proposal) => proposal.status === 'pending')
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}
