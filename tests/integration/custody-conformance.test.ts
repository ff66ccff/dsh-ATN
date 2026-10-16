import assert from 'node:assert/strict'
import test from 'node:test'
import { runCustodyConformance } from '../../conformance/index.mjs'
import { createConformanceAdapter } from '../fixtures/conformance-host.ts'

test('CONFORMANCE-HOST: the example custody host passes the portable contract suite', async () => {
 const result = await runCustodyConformance(createConformanceAdapter())
 assert.equal(result.failed, 0, JSON.stringify(result.failures))
 assert.ok(result.passed >= 40)
})

test('CONFORMANCE-NEGATIVE: unowned allow and asynchronous host fixtures fail with exact contract names', async () => {
 for (const [mode, contract] of [['allow-unowned', 'unheld:start'], ['async', 'held:start']] as const) {
  const result = await runCustodyConformance(createConformanceAdapter(mode))
  assert.ok(result.failed > 0)
  assert.ok(result.failures.some((failure: { contract: string }) => failure.contract === contract), JSON.stringify(result))
 }
})
