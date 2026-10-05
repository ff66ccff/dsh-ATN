import { strict as assert } from 'node:assert'
import test from 'node:test'
import { runReference } from '../../experiments/reference-run.ts'
import { REFERENCE_POLICIES } from '../../experiments/reference-policy.ts'

test('reference policies deliver corrected aggregates with zero model requests', async () => {
  const results = []
  for (const policy of REFERENCE_POLICIES) {
    const result = await runReference({ policy })
    assert.equal(result.delivered, true, `${policy}: ${result.failure}`)
    assert.equal(result.issuedModelCalls, 0)
    assert.equal(result.aggregateOnly, true)
    assert.equal(result.manipulation.valid, true)
    assert.equal(result.manipulation.outcomeChecks.failedShardRecovered, true)
    results.push(result)
  }
  const [hub, gossip, tree, adaptive] = results
  assert.ok(hub.messages * 1.5 < gossip.messages)
  assert.ok(hub.maxContextBytes < gossip.maxContextBytes)
  assert.ok(tree.maxContextBytes < gossip.maxContextBytes)
  assert.ok(adaptive.rewires > 0)
})

test('reference hub is deterministic and supports the second task variant', async () => {
  const first = await runReference({ policy: 'hub', task: 'shift-ledger-2' })
  const second = await runReference({ policy: 'hub', task: 'shift-ledger-2' })
  assert.equal(first.delivered, true, first.failure ?? '')
  assert.equal(second.delivered, true, second.failure ?? '')
  for (const key of ['messages', 'hops', 'payloadBytes', 'maxContextBytes', 'answer'] as const) assert.equal(first[key], second[key])
})
