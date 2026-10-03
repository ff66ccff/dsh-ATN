/**
 * Lifecycle: first-successful-child selection, draining obligations, and the
 * recovery decision for a node whose creation never finished.
 * @module dsh-atn/tests/unit/lifecycle
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import {
  canRelease,
  failProvisioning,
  LifecycleError,
  outstandingObligations,
  planRecovery,
  publishNode,
  requestDrain,
  retireSettledNodes,
} from '../../src/lifecycle.ts'
import { createTask, settleTask } from '../../src/tasks.ts'
import { openProposal } from '../../src/proposals.ts'
import { makeChain, makeNode } from '../fixtures/network.ts'

test('TOPO-03: only the first successfully published child claims the selected-child slot', () => {
  const base = makeChain(['A'])
  const withFirst = {
    ...base,
    nodes: {
      A: base.nodes['A']!,
      B: makeNode('B', { creatorId: 'A', creationState: 'pending', lifecycle: 'provisioning' }),
      X: makeNode('X', { creatorId: 'A', creationState: 'pending', lifecycle: 'provisioning' }),
    },
  }

  // X finishes provisioning first and wins the slot.
  const publishedX = publishNode(withFirst, 'session-X', 1)
  assert.equal(publishedX.record.nodes['A']!.selectedChildId, 'X')

  // B publishing later must not steal it.
  const publishedB = publishNode(publishedX.record, 'session-B', 2)
  assert.equal(publishedB.record.nodes['A']!.selectedChildId, 'X')
  assert.equal(publishedB.record.nodes['B']!.creationState, 'published')
})

test('TOPO-03: a failed creation does not occupy the selected-child slot', () => {
  const base = makeChain(['A'])
  const withPending = {
    ...base,
    nodes: {
      A: base.nodes['A']!,
      B: makeNode('B', { creatorId: 'A', creationState: 'pending', lifecycle: 'provisioning' }),
    },
  }
  const failed = failProvisioning(withPending, 'session-B', 'preset could not be composed')
  assert.equal(failed.nodes['A']!.selectedChildId, null, 'a failed creation leaves the slot empty')
  assert.equal(failed.nodes['B']!.creationState, 'failed')
  assert.equal(failed.nodes['B']!.note, 'preset could not be composed')
})

test('AGENT-04: a provisioning node is not published twice', () => {
  const base = makeChain(['A'])
  const withPending = {
    ...base,
    nodes: { A: base.nodes['A']!, B: makeNode('B', { creatorId: 'A', creationState: 'pending', lifecycle: 'provisioning' }) },
  }
  const once = publishNode(withPending, 'session-B', 1)
  const twice = publishNode(once.record, 'session-B', 2)
  assert.equal(twice.record.nodes['A']!.selectedChildId, 'B')
  assert.equal(Object.keys(twice.record.nodes).length, 2, 'no second node is created for the same session')
})

test('LIFE-02: a draining node keeps its old task and its already assigned vote, and leaves the topology', () => {
  const network = makeChain(['A', 'B', 'C'])
  const created = createTask(network, { holderId: 'B', requesterId: 'A', description: 'old work', context: '', now: 0 })
  const proposal = openProposal(created.record, {
    proposerId: 'A',
    document: { objective: 'x', successCriteria: 'y', constraints: 'z' },
    rationale: '',
    now: 0,
  })
  const draining = requestDrain(proposal.record, 'B', 'winding down')

  assert.equal(draining.nodes['B']!.lifecycle, 'draining')
  assert.equal(draining.nodes['C']!.creatorId, 'B', 'the birth origin is preserved after draining')
  const obligations = outstandingObligations(draining, 'B')
  assert.deepEqual(obligations.tasks, [created.taskId])
  assert.deepEqual(obligations.proposals, [proposal.proposal.id])
  assert.equal(canRelease(draining, 'B'), false)
})

test('LIFE-02: a draining node is released only after its task and vote are settled', () => {
  const network = makeChain(['A', 'B', 'C'])
  const created = createTask(network, { holderId: 'B', requesterId: 'A', description: 'old work', context: '', now: 0 })
  const proposal = openProposal(created.record, {
    proposerId: 'A',
    document: { objective: 'x', successCriteria: 'y', constraints: 'z' },
    rationale: '',
    now: 0,
  })
  let record = requestDrain(proposal.record, 'B', 'winding down')
  assert.equal(retireSettledNodes(record, 1).nodes['B']!.lifecycle, 'draining', 'still holds a task')

  record = settleTask(record, created.taskId, 'B', { summary: 'done', evidence: [] }, 2).record
  assert.equal(retireSettledNodes(record, 3).nodes['B']!.lifecycle, 'draining', 'still owes its vote')

  const voted = {
    ...record,
    proposals: {
      ...record.proposals,
      [proposal.proposal.id]: {
        ...record.proposals[proposal.proposal.id]!,
        votes: [{ voterId: 'B', approve: true, reason: null, at: 4 }],
      },
    },
  }
  const retired = retireSettledNodes(voted, 5)
  assert.equal(retired.nodes['B']!.lifecycle, 'retired')
  assert.equal(retired.nodes['B']!.leaseDeadlineAt, null)
})

test('LIFE-04: a node that already voted does not wait for the other approvers', () => {
  const network = makeChain(['A', 'B', 'C'])
  const proposal = openProposal(network, {
    proposerId: 'A',
    document: { objective: 'x', successCriteria: 'y', constraints: 'z' },
    rationale: '',
    now: 0,
  })
  const voted = {
    ...proposal.record,
    proposals: {
      ...proposal.record.proposals,
      [proposal.proposal.id]: {
        ...proposal.record.proposals[proposal.proposal.id]!,
        votes: [{ voterId: 'B', approve: true, reason: null, at: 1 }],
      },
    },
    nodes: { ...proposal.record.nodes, B: { ...proposal.record.nodes['B']!, lifecycle: 'draining' as const } },
  }
  assert.equal(canRelease(voted, 'B'), true, 'a persisted vote is not an outstanding obligation')
})

test('LIFE-02: an active node is not retired by the automatic pass', () => {
  const network = makeChain(['A', 'B'])
  assert.equal(retireSettledNodes(network, 1).nodes['A']!.lifecycle, 'active')
})

test('a terminal node cannot request retirement again', () => {
  const network = makeChain(['A'])
  const retired = { ...network, nodes: { A: { ...network.nodes['A']!, lifecycle: 'retired' as const } } }
  assert.throws(
    () => requestDrain(retired, 'A', 'again'),
    (error: unknown) => error instanceof LifecycleError && error.code === 'terminal',
  )
})

test('RECOVER-02: a provisioning node with no persisted session is failed, not silently republished', () => {
  const base = makeChain(['A'])
  const network = {
    ...base,
    nodes: { A: base.nodes['A']!, B: makeNode('B', { creatorId: 'A', creationState: 'pending', lifecycle: 'provisioning' }) },
  }
  const decisions = planRecovery(network, () => false)
  assert.deepEqual(
    decisions.map((decision) => [decision.nodeId, decision.action]),
    [
      ['A', 'resume'],
      ['B', 'fail'],
    ],
  )
})

test('RECOVER-02: a provisioning node whose session was persisted is rebuilt on that session', () => {
  const base = makeChain(['A'])
  const network = {
    ...base,
    nodes: { A: base.nodes['A']!, B: makeNode('B', { creatorId: 'A', creationState: 'pending', lifecycle: 'provisioning' }) },
  }
  const decisions = planRecovery(network, (sessionId) => sessionId === 'session-B')
  assert.equal(decisions[1]!.action, 'resume')
})

test('RECOVER-01: retired and failed nodes are never revived, and a terminal network stays terminal', () => {
  const base = makeChain(['A', 'B'])
  const network = {
    ...base,
    status: 'stopped' as const,
    nodes: { ...base.nodes, B: { ...base.nodes['B']!, lifecycle: 'retired' as const } },
  }
  const decisions = planRecovery(network, () => true)
  assert.deepEqual(decisions.map((decision) => decision.action), ['leave', 'leave'])
})
