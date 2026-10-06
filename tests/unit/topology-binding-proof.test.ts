import { strict as assert } from 'node:assert'
import test from 'node:test'
import { createShiftingEvidenceTask } from '../../experiments/shifting-evidence-task.ts'

test('BIND-PROOF: all planned seeds are fixture-bound and need more fixed edges than allowed', async () => {
  const path = '../../experiments/topology-binding-proof.ts'
  const proof = await import(path).catch(() => null)
  assert.ok(proof, 'offline topology-binding proof implementation exists')
  for (const seed of [17, 31, 45, 59, 73]) {
    const task = { ...createShiftingEvidenceTask(8, seed, 2), topologyBinding: true }
    const result = proof.proveTopologyBinding(task)
    assert.equal(result.seed, seed)
    assert.equal(result.initialOutdegreeLimit, 2)
    assert.equal(result.requiredFacts.length, 4)
    assert.equal(result.requiredDirectEdges.length, 4)
    assert.equal(result.fixedReachable, false)
    assert.equal(result.exceedsStaticDegree, true)
    assert.equal(proof.verifyTopologyBindingProof(task, result), true)
    assert.equal(proof.verifyTopologyBindingProof({ ...task, seed: seed + 1 }, result), false)
    assert.equal(proof.verifyTopologyBindingProof(task, { ...result, initialOutdegreeLimit: 4 }), false)
  }
})

test('BIND-PROOF: reachable fixtures cannot be admitted, even with a forged unreachable verdict', async () => {
  const path = '../../experiments/topology-binding-proof.ts'
  const proof = await import(path).catch(() => null)
  assert.ok(proof)
  const task = { ...createShiftingEvidenceTask(8, 17, 2), topologyBinding: true }
  for (const phase of task.phases) for (const key of Object.keys(phase.holders)) phase.holders[key] = 1
  const result = proof.proveTopologyBinding(task)
  assert.equal(result.fixedReachable, true)
  assert.equal(result.exceedsStaticDegree, false)
  assert.equal(proof.isComparisonSeed(task, result), false)
  assert.equal(proof.isComparisonSeed(task, { ...result, fixedReachable: false }), false)
})
