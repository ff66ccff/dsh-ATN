/** Portable black-box host conformance. No repository internals or test-fixture imports. */
import assert from 'node:assert/strict'
export const CHANNELS = ['start', 'spawn', 'send.task', 'send.note', 'send.result', 'status.review', 'status.claim', 'status.rewire', 'finish.node', 'finish.network', 'propose', 'vote', 'renew', 'publish']
export const REFUSAL_CODES = ['evidence-not-owned', 'not-task-holder', 'metadata-only', 'fact-requests-and-owner-results-only', 'extra-transport-fields', 'invalid-fact-request', 'fixed-edge-required', 'invalid-setup-receipt', 'invalid-owner-result', 'async-policy', 'ref-unresolved', 'ref-not-owned', 'ref-not-visible', 'rationale-missing-ref', 'custody-unavailable', 'substrate-full']
export const CASES = [
 ...CHANNELS.flatMap(channel => [
  { contract: `held:${channel}`, channel, held: true },
  { contract: `unheld:${channel}`, channel, held: false, code: 'evidence-not-owned' },
 ]),
 ...['messageId', 'dependsOn', 'retryOf'].map(field => ({ contract: `transport:${field}`, field, code: 'evidence-not-owned' })),
 ...Object.entries({ 'msg-existing': null, 'msg-future': 'ref-unresolved', 'msg-self': 'ref-unresolved',
  'task-visible': null, 'task-hidden': 'ref-not-visible', 'task-missing': 'ref-unresolved',
  'artifact-owned': null, 'artifact-unowned': 'ref-not-owned', 'artifact-no-policy': 'custody-unavailable',
  'rationale': 'rationale-missing-ref', 'capacity': 'substrate-full',
  'read-policy-missing': null, 'read-policy-throw': 'custody-unavailable', 'read-policy-async': 'async-policy',
  'read-policy-hidden': 'ref-unresolved',
 }).map(([contract, code]) => ({ contract, ...(code === null ? {} : { code }) })),
]

/** Adapter ports must dispatch real public APIs and report actual durable/model/session state. */
export async function runCustodyConformance(adapter) {
 const failures = [], results = []
 try {
  assert.deepEqual([...adapter.vocabulary.channels], CHANNELS, '14 outbound channels and their order')
  assert.deepEqual([...adapter.vocabulary.codes], REFUSAL_CODES, '16 public refusal names and their order')
 } catch (error) { failures.push({ contract: 'public-vocabulary', message: error.message }) }
 for (const specification of CASES) {
  let fixture
  try {
   fixture = await adapter.open(specification)
   const before = await fixture.snapshot()
   if (specification.code) {
    await assert.rejects(() => fixture.exercise(), { code: specification.code }, specification.contract)
    assert.deepEqual(await fixture.snapshot(), before, `${specification.contract}: refusal atomicity (durable data, IDs, messages, weights, steps, mail, writes, sessions, agents, model requests)`)
   } else await fixture.exercise()
   results.push({ contract: specification.contract, passed: true })
  } catch (error) {
   failures.push({ contract: specification.contract, message: error.message })
   results.push({ contract: specification.contract, passed: false })
  } finally {
   try { await fixture?.close() } catch (error) { failures.push({ contract: `${specification.contract}:cleanup`, message: error.message }) }
  }
 }
 return { passed: results.filter(row => row.passed).length, failed: failures.length, failures, results }
}
