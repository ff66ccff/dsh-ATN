import assert from 'node:assert/strict'
import test from 'node:test'
import { RefusalCounters, REFUSAL_COUNT_MAX, REFUSAL_NETWORK_MAX } from '../../src/refusal-counters.ts'
test('FLEET-COUNTERS: fixed buckets saturate, arbitrary strings do not persist, network memory is bounded', () => {
 const counters = new RefusalCounters()
 for (let n = 0; n < REFUSAL_COUNT_MAX + 2; n++) counters.record('a', 'ref-unresolved')
 assert.equal(counters.snapshot('a').buckets['ref-unresolved'], REFUSAL_COUNT_MAX)
 counters.record('a', 'PRIVATE_PAYLOAD_AS_CODE')
 assert.equal(counters.snapshot('a').buckets.other, 1)
 assert.ok(!JSON.stringify(counters.snapshot('a')).includes('PRIVATE_PAYLOAD_AS_CODE'))
 for (let n = 0; n < REFUSAL_NETWORK_MAX; n++) counters.record(`n${n}`, 'async-policy')
 assert.equal(counters.snapshot('a').total, 0)
 assert.equal(counters.snapshot('n63').total, 1)
})
