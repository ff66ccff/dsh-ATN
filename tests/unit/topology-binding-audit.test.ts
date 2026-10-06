import { strict as assert } from 'node:assert'
import test from 'node:test'
import { auditFactFlow, referenceCostRatios } from '../../experiments/topology-binding-audit.ts'
import { factFlowFixture } from '../fixtures/binding-evidence.ts'

test('BIND-FLOW: every answer fact has an exact owner, directed request and delivered result before submission', () => {
  const { task, network, checkpoints } = factFlowFixture()
  const audit = auditFactFlow(task, network, checkpoints)
  assert.equal(audit.passed, true)
  assert.equal(audit.auditedFacts, 4)
  assert.equal(audit.submittedCheckpoints, 2)
  assert.ok(audit.facts.every(row => row.directPeers.includes(row.ownerNodeId)))
  const unknown = structuredClone(network)
  delete unknown.mails['result-mail-0']
  assert.equal(auditFactFlow(task, unknown, checkpoints).passed, false)
  const wrongOwner = structuredClone(network)
  wrongOwner.mails['result-mail-0'].fromId = 'node-1'
  assert.equal(auditFactFlow(task, wrongOwner, checkpoints).passed, false)
})

test('BIND-FLOW: queued, late, non-direct and fabricated facts never acquire provenance from later events', () => {
  const { task, network, checkpoints } = factFlowFixture()
  for (const mutation of [
    (copy: typeof network) => { copy.mails['result-mail-0'].status = 'queued' },
    (copy: typeof network) => { copy.mails['result-mail-0'].settledAt = 1001 },
    (copy: typeof network) => { copy.rewireHistory![0].nextPeers = ['node-1'] },
    (copy: typeof network) => { copy.rewireHistory![0].id = 'rewire-101' },
    (copy: typeof network) => { copy.tasks['task-100'].result!.summary = '{}' },
  ]) {
    const copy = structuredClone(network); mutation(copy)
    assert.equal(auditFactFlow(task, copy, checkpoints).passed, false)
  }
  const forged = JSON.parse(checkpoints[0].answer); forged.chain[0].proof = 'guessed'
  assert.equal(auditFactFlow(task, network, [{ ...checkpoints[0], answer: JSON.stringify(forged) }]).passed, false)
  assert.equal(auditFactFlow(task, network, [{ ...checkpoints[0], answer: '{}' }]).passed, false)
  const noAnswer = auditFactFlow(task, network, [])
  assert.equal(noAnswer.passed, true)
  assert.equal(noAnswer.noSubmission, true)
  assert.equal(noAnswer.auditedFacts, 0)
})

test('BIND-COST: zero-reference model calls have no finite multiplier; other costs use the same topology', () => {
  const ratios = referenceCostRatios({ issuedModelCalls: 90, atnTotalInteractions: 60, atnTotalTransferBytes: 1000, entrySteps: 30 },
    { topologyMode: 'fixed', issuedModelCalls: 0, totalInteractions: 20, totalTransferBytes: 500, entrySteps: 10 })
  assert.equal(ratios.topology, 'fixed')
  assert.equal(ratios.modelCalls.multiple, null)
  assert.equal(ratios.modelCalls.status, 'undefined-zero-reference')
  assert.equal(ratios.interactions.multiple, 3)
  assert.equal(ratios.transferBytes.multiple, 2)
  assert.equal(ratios.entrySteps.multiple, 3)
})
