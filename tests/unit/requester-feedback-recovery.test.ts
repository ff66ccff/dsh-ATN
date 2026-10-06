/** Regression for choosing usable comparable evidence among several contracts. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { evaluateCumulativeRequesterRewire, recordRequesterFeedback } from '../../src/requester-feedback.ts'
import type { NetworkRecord, RequesterFeedback } from '../../src/schema.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'

test('RECOVERY-EDGE-CONTRACT: a pending contract cannot hide another fully comparable M=2 contract', () => {
  let record: NetworkRecord = makeChain(['A', 'B', 'C'])
  record = { ...record, limits: { ...record.limits, requesterMinSamples: 2 } }
  const rate = (id: string, holder: string, comparisonKey: string, status: RequesterFeedback['status']) => {
    const task = makeTask(id, { requesterId: 'A', holderId: holder, status: 'completed', settledBy: holder,
      createdAt: 10, settledAt: 20, result: { summary: 'Submitted evidence', evidence: ['artifact:proof'] } })
    record = { ...record, tasks: { ...record.tasks, [id]: task } }
    record = recordRequesterFeedback(record, 'A', { taskId: id, status, comparisonKey,
      summary: 'Reviewed this contract', evidence: ['check:contract'] }, 30).record
  }

  // Both keys have the same full terminal coverage. Alphabetical order must not
  // override whether the contract actually meets all evidence requirements.
  for (const key of ['a', 'z']) {
    for (let i = 0; i < 2; i++) {
      rate(`${key}-old-${i}`, 'B', key, 'rejected')
      rate(`${key}-new-${i}`, 'C', key, 'accepted')
    }
  }
  rate('a-pending', 'B', 'a', 'needs-more')

  const edges = record.requesterEdges!
  for (const key of ['a', 'z']) {
    assert.equal(edges.find(edge => edge.holderId === 'B' && edge.comparisonKey === key)!.sampleCount, 2)
    assert.equal(edges.find(edge => edge.holderId === 'C' && edge.comparisonKey === key)!.sampleCount, 2)
  }
  assert.equal(edges.find(edge => edge.holderId === 'B' && edge.comparisonKey === 'a')!.needsMore, 1)

  const evaluation = evaluateCumulativeRequesterRewire(record,
    { requesterId: 'A', previousPeers: ['B'], nextPeers: ['C'] }, 40)
  assert.equal(evaluation.minimumSamples, 2)
  assert.equal(evaluation.comparisonKey, 'z', 'select the complete contract instead of the alphabetically first pending contract')
  assert.equal(evaluation.verdict, 'observed-improvement')
  assert.deepEqual(evaluation.reasons, [])
  assert.equal(evaluation.baseline.rejected, 2)
  assert.equal(evaluation.candidate.accepted, 2)
  assert.equal(evaluation.baseline.needsMore, 0)
  assert.equal(evaluation.delta.acceptanceRate, 1)
  assert.equal(evaluation.causalClaim, false)
})
