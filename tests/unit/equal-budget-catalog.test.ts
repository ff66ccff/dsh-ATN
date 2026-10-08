import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { checkEqualBudgetModelCatalog } from '../../experiments/provider.ts'

test('round 11 catalog prerequisite retains available, missing and failed checks without inference', async t => {
  const root = await mkdtemp(join(tmpdir(), 'equal-budget-catalog-'))
  t.after(async () => { assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep)); await rm(root, { recursive: true, force: true }) })
  const model = { id: 'deepseek-v4.1-flash', name: 'Fixture', api: 'test', catalogFree: false,
    referenceCostPerMillion: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 } }
  const snapshot = { checkedAt: '2026-10-08T00:00:00.000Z', provider: 'dsh-opencode-go', models: [model] }
  const available = await checkEqualBudgetModelCatalog(join(root, 'available.json'), async () => snapshot)
  assert.equal(available.status, 'available')
  assert.deepEqual(available.catalog, snapshot)
  assert.equal(available.readOnly, true)
  assert.equal(available.issuedModelCalls, 0)
  assert.equal(available.causalClaim, false)
  const missing = await checkEqualBudgetModelCatalog(join(root, 'missing.json'), async () => ({ ...snapshot, models: [] }))
  assert.equal(missing.status, 'unavailable')
  assert.equal(missing.failure, 'target-model-not-visible')
  const failedPath = join(root, 'failed.json')
  const failed = await checkEqualBudgetModelCatalog(failedPath, async () => { throw new Error('secret-fixture-must-not-be-recorded') })
  assert.equal(failed.status, 'unavailable')
  assert.equal(failed.failure, 'catalog-request-failed')
  assert.equal(failed.catalog, null)
  const encoded = await readFile(failedPath, 'utf8')
  assert.deepEqual(JSON.parse(encoded), failed)
  assert.ok(!encoded.includes('secret-fixture'))
  await assert.rejects(checkEqualBudgetModelCatalog(failedPath, async () => snapshot), /EEXIST/)
  assert.equal(await readFile(failedPath, 'utf8'), encoded, 'existing prerequisite records cannot be overwritten')
})
