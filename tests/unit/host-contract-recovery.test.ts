/** Automatic host evidence must search all contracts before choosing a one-sided fallback. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { recordRequesterFeedback, selectRequesterRewireSamples } from '../../src/requester-feedback.ts'
import { validateTaskResult } from '../../src/tasks.ts'
import { evaluateRewireEvidence } from '../../src/verified-feedback.ts'
import type { NetworkRecord } from '../../src/schema.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'

test('RECOVERY-HOST-CONTRACT: a newer baseline-only contract cannot hide complete host evidence', () => {
  let record: NetworkRecord = makeChain(['A', 'B', 'C'])
  record = { ...record, limits: { ...record.limits, requesterMinSamples: 2 } }
  const rate = (id: string, holderId: string, comparisonKey: string, checkedAt: number) => {
    const accepted = holderId === 'C'
    const task = makeTask(id, { requesterId: 'A', holderId, status: 'completed', settledBy: holderId,
      createdAt: 10, settledAt: 20, result: { summary: accepted ? 'correct' : 'incorrect', evidence: ['artifact:answer'] } })
    record = { ...record, tasks: { ...record.tasks, [id]: task } }
    record = recordRequesterFeedback(record, 'A', { taskId: id, status: accepted ? 'accepted' : 'rejected',
      comparisonKey, summary: 'Checked the same contract.', evidence: ['requester-check'] }, checkedAt).record
    record = validateTaskResult(record, id, { id: 'fixture-oracle', validate: () => ({
      passed: accepted, summary: 'Independent oracle result.', evidence: ['host-check'],
      metrics: { comparisonKey, cost: 1, costUnit: 'fixture-unit' },
    }) }, checkedAt).record
  }
  for (let index = 0; index < 2; index++) {
    rate(`old-match-${index}`, 'B', 'matched-contract', 30)
    rate(`new-match-${index}`, 'C', 'matched-contract', 30)
  }
  rate('newer-baseline-only', 'B', 'unmatched-new-contract', 40)
  const edges = { requesterId: 'A', previousPeers: ['B'], nextPeers: ['C'] }
  const expected = { baselineTaskIds: ['old-match-0', 'old-match-1'], candidateTaskIds: ['new-match-0', 'new-match-1'] }
  // Establish that the ignored older samples really satisfy the stronger host gate.
  const explicit = evaluateRewireEvidence(record, { ...edges, ...expected })
  assert.equal(explicit.verdict, 'observed-improvement')
  assert.deepEqual(explicit.reasons, [])
  assert.equal(explicit.delta.passRate, 1)
  assert.equal(explicit.causalClaim, false)

  const selected = selectRequesterRewireSamples(record, edges)
  assert.deepEqual(selected, expected, 'a baseline-only fallback must wait until all bilateral contracts have been checked')
  const automatic = evaluateRewireEvidence(record, { ...edges, ...selected })
  assert.equal(automatic.verdict, 'observed-improvement')
  assert.equal(automatic.comparisonKey, 'matched-contract')
  assert.equal(automatic.baseline.failed, 2)
  assert.equal(automatic.candidate.passed, 2)
  assert.equal(automatic.causalClaim, false)

  const baselineOnly = { ...record, tasks: Object.fromEntries(Object.entries(record.tasks).filter(([, task]) => task.holderId === 'B')) }
  assert.deepEqual(selectRequesterRewireSamples(baselineOnly, edges), {
    baselineTaskIds: ['newer-baseline-only'], candidateTaskIds: [],
  }, 'genuinely unobserved new edges still retain the newest available removed-edge evidence')
})
