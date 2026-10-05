/**
 * Unanimous document review: full-approval requirement, rejection, silence,
 * expiry, stale bases, frozen approver lists and idempotent retries.
 * @module dsh-atn/tests/unit/proposals
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { castVote, expireProposals, openProposal, pendingVotesFor, ProposalError } from '../../src/proposals.ts'
import { currentGoal } from '../../src/domain.ts'
import { makeChain, makeNode, testGoal } from '../fixtures/network.ts'
import type { GoalDocument, NetworkRecord } from '../../src/schema.ts'

const replacement: GoalDocument = {
  ...testGoal,
  plan: 'Ship the minimal bundle and record commands for review.',
}

/**
 * A - B - C - D - E chain.
 * C's frozen approver list is A, B, D, E: four members.
 */
function fourApprovers(): NetworkRecord {
  return makeChain(['A', 'B', 'C', 'D', 'E'])
}

test('VOTE-01: three approvals out of a four-member list do not commit', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: 'first', now: 0 })
  assert.deepEqual(opened.proposal.voters, ['A', 'B', 'D', 'E'])

  let record = opened.record
  record = castVote(record, { proposalId: opened.proposal.id, voterId: 'B', approve: true, reason: null, now: 1 }).record
  record = castVote(record, { proposalId: opened.proposal.id, voterId: 'A', approve: true, reason: null, now: 1 }).record
  const three = castVote(record, { proposalId: opened.proposal.id, voterId: 'D', approve: true, reason: null, now: 1 })
  assert.equal(three.proposal.status, 'pending', 'three of four is not enough')
  assert.equal(three.record.goalHistory.length, 1)

  const four = castVote(three.record, { proposalId: opened.proposal.id, voterId: 'E', approve: true, reason: null, now: 2 })
  assert.equal(four.proposal.status, 'committed')
  assert.equal(currentGoal(four.record).version, 2, 'exactly one new version appears')
  assert.equal(four.record.goalHistory.length, 2)
})

test('a proposer is not one of its own approvers', () => {
  const network = fourApprovers()
  const { proposal } = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  assert.ok(!proposal.voters.includes('C'))
})

test('VOTE-02: a single rejection kills the proposal and the document stays at the old version', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  const rejected = castVote(opened.record, { proposalId: opened.proposal.id, voterId: 'B', approve: false, reason: 'not now', now: 1 })
  assert.equal(rejected.proposal.status, 'rejected')
  assert.equal(rejected.record.goalHistory.length, 1)
  assert.deepEqual(currentGoal(rejected.record).document, testGoal)
})

test('VOTE-02: silence never approves, and a late vote after the deadline cannot rescue a proposal', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  let record = opened.record
  record = castVote(record, { proposalId: opened.proposal.id, voterId: 'B', approve: true, reason: null, now: 1 }).record
  record = castVote(record, { proposalId: opened.proposal.id, voterId: 'A', approve: true, reason: null, now: 1 }).record
  record = castVote(record, { proposalId: opened.proposal.id, voterId: 'D', approve: true, reason: null, now: 1 }).record

  const afterDeadline = opened.proposal.deadlineAt + 1
  const expired = expireProposals(record, afterDeadline)
  assert.equal(expired.proposals[opened.proposal.id]!.status, 'expired')
  assert.equal(expired.goalHistory.length, 1)

  assert.throws(
    () => castVote(expired, { proposalId: opened.proposal.id, voterId: 'E', approve: true, reason: null, now: afterDeadline + 1 }),
    (error: unknown) => error instanceof ProposalError && error.code === 'not-pending',
  )
})

test('VOTE-03: reshaping the topology after a vote does not move that vote to another proposal', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  let record = castVote(opened.record, { proposalId: opened.proposal.id, voterId: 'B', approve: true, reason: null, now: 1 }).record
  // A neighbour retires, so the live topology no longer matches the frozen list.
  record = { ...record, nodes: { ...record.nodes, A: { ...record.nodes['A']!, lifecycle: 'draining' as const }, X: makeNode('X', { creatorId: 'C' }) } }

  assert.throws(
    () => castVote(record, { proposalId: opened.proposal.id, voterId: 'X', approve: true, reason: null, now: 2 }),
    (error: unknown) => error instanceof ProposalError && error.code === 'not-a-voter',
  )
  assert.deepEqual(record.proposals[opened.proposal.id]!.voters, ['A', 'B', 'D', 'E'], 'the frozen list is untouched')
})

test('VOTE-04: a draining node can still vote on an old proposal but cannot open a new one', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  const withDraining = {
    ...opened.record,
    nodes: {
      ...opened.record.nodes,
      B: { ...opened.record.nodes['B']!, lifecycle: 'draining' as const },
      C: { ...opened.record.nodes['C']!, lifecycle: 'draining' as const },
    },
  }

  const vote = castVote(withDraining, { proposalId: opened.proposal.id, voterId: 'B', approve: true, reason: null, now: 1 })
  assert.equal(vote.proposal.votes.length, 1, 'an old obligation stays votable')

  assert.throws(
    () => openProposal(vote.record, { proposerId: 'C', document: replacement, rationale: '', now: 2 }),
    (error: unknown) => error instanceof ProposalError && error.code === 'proposer-not-active',
  )
})

test('VOTE-04: a replacement node that fills the vacated slot cannot vote on the old proposal', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  // X becomes an active neighbour of C by the current topology but was not on the frozen list.
  opened.record.nodes['X'] = makeNode('X', { creatorId: 'C' })
  assert.throws(
    () => castVote(opened.record, { proposalId: opened.proposal.id, voterId: 'X', approve: true, reason: null, now: 1 }),
    (error: unknown) => error instanceof ProposalError && error.code === 'not-a-voter',
  )
})

test('VOTE-05: a voter that has left the current neighbourhood can still cast its frozen vote', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  const retired = { ...opened.record, nodes: { ...opened.record.nodes, B: { ...opened.record.nodes['B']!, lifecycle: 'retired' as const } } }
  const vote = castVote(retired, { proposalId: opened.proposal.id, voterId: 'B', approve: true, reason: null, now: 1 })
  assert.equal(vote.proposal.votes.length, 1, 'the historical approver list authorizes the vote')
})

test('VOTE-06: two proposals on the same base cannot both commit', () => {
  const network = fourApprovers()
  const first = openProposal(network, { proposerId: 'C', document: replacement, rationale: 'one', now: 0 })
  const second = openProposal(first.record, { proposerId: 'D', document: { ...replacement, plan: 'Other approach' }, rationale: 'two', now: 0 })

  let record = second.record
  for (const voter of first.proposal.voters) {
    record = castVote(record, { proposalId: first.proposal.id, voterId: voter, approve: true, reason: null, now: 1 }).record
  }
  assert.equal(record.proposals[first.proposal.id]!.status, 'committed')
  assert.equal(currentGoal(record).version, 2)

  for (const voter of second.proposal.voters) {
    record = castVote(record, { proposalId: second.proposal.id, voterId: voter, approve: true, reason: null, now: 2 }).record
  }
  assert.equal(record.proposals[second.proposal.id]!.status, 'stale', 'the loser is stale, not committed')
  assert.equal(currentGoal(record).version, 2, 'the newest version is still the single committed one')
})

test('VOTE-07: a repeated identical vote adds neither a vote nor a revision', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  const once = castVote(opened.record, { proposalId: opened.proposal.id, voterId: 'B', approve: true, reason: null, now: 1 })
  const twice = castVote(once.record, { proposalId: opened.proposal.id, voterId: 'B', approve: true, reason: null, now: 2 })
  assert.equal(twice.idempotent, true)
  assert.equal(twice.proposal.votes.length, 1)
  assert.equal(twice.record.goalHistory.length, 1)

  assert.throws(
    () => castVote(once.record, { proposalId: opened.proposal.id, voterId: 'B', approve: false, reason: 'changed my mind', now: 3 }),
    (error: unknown) => error instanceof ProposalError && error.code === 'already-voted-differently',
  )
})

test('VOTE-08: closing the network takes precedence over a late final approval', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  let record = opened.record
  record = castVote(record, { proposalId: opened.proposal.id, voterId: 'B', approve: true, reason: null, now: 1 }).record
  record = castVote(record, { proposalId: opened.proposal.id, voterId: 'A', approve: true, reason: null, now: 1 }).record
  record = castVote(record, { proposalId: opened.proposal.id, voterId: 'D', approve: true, reason: null, now: 1 }).record
  // The network closes between the third and the final vote.
  record = { ...record, status: 'stopped' as const }

  const late = castVote(record, { proposalId: opened.proposal.id, voterId: 'E', approve: true, reason: null, now: 2 })
  assert.equal(late.proposal.status, 'cancelled', 'the closed network wins over the final approval')
  assert.equal(late.record.goalHistory.length, 1, 'a stopped network gains no new version')
})

test('VOTE-07: partial votes survive a restart because they are stored on the proposal', () => {
  const network = fourApprovers()
  const opened = openProposal(network, { proposerId: 'C', document: replacement, rationale: '', now: 0 })
  const voted = castVote(opened.record, { proposalId: opened.proposal.id, voterId: 'B', approve: true, reason: null, now: 1 }).record
  assert.equal(pendingVotesFor(voted, 'B').length, 0)
  assert.deepEqual(
    pendingVotesFor(voted, 'A').map((proposal) => proposal.id),
    [opened.proposal.id],
  )
  assert.deepEqual(voted.proposals[opened.proposal.id]!.votes.map((vote) => vote.voterId), ['B'])
})

test('a proposal without any approver is refused instead of auto-passing', () => {
  const lonely = makeChain(['A'])
  assert.throws(
    () => openProposal(lonely, { proposerId: 'A', document: replacement, rationale: '', now: 0 }),
    (error: unknown) => error instanceof ProposalError && error.code === 'no-approvers',
  )
})
