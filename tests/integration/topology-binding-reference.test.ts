import { strict as assert } from 'node:assert'
import test from 'node:test'
import { runBindingReferencePair } from '../../experiments/topology-binding-reference.ts'
import { bindingReferenceGate } from '../../experiments/topology-binding-audit.ts'

test('BIND-REFERENCE: all five seeds complete adaptively and miss required facts with fixed edges under the same ACL and budget', async () => {
  for (const seed of [17, 31, 45, 59, 73]) {
    const conditions = { agents: 8, seed, chainLength: 2, topologyBinding: true as const, perNodeSteps: 48, maxCalls: 384, timeoutMs: 600000 }
    const sourceHashes = { fixture: 'same' }, pair = await runBindingReferencePair(conditions, sourceHashes)
    assert.equal(pair.adaptive.passed, true)
    assert.equal(pair.fixed.passed, false)
    assert.equal(pair.adaptive.obtainedRequiredFactCount, 4)
    assert.ok(pair.fixed.obtainedRequiredFactCount < 4)
    for (const run of [pair.adaptive, pair.fixed]) {
      assert.equal(run.issuedModelCalls, 0)
      assert.ok(run.entrySteps <= 48)
      assert.ok(run.messages > 0)
      assert.equal(run.messages, run.hops)
      assert.equal(run.factFlowAudit?.passed, true)
      assert.equal(run.topology.maxPeers, 2)
    }
    assert.equal(bindingReferenceGate(pair, { conditions, sourceHashes }), true)
    assert.equal(bindingReferenceGate({ ...pair, fixed: { ...pair.fixed, passed: true } }, { conditions, sourceHashes }), false)
    assert.equal(bindingReferenceGate({ ...pair, adaptive: { ...pair.adaptive, receivedFacts: [] } }, { conditions, sourceHashes }), false)
    assert.equal(bindingReferenceGate(pair, { conditions: { ...conditions, perNodeSteps: 47 }, sourceHashes }), false)
  }
})
