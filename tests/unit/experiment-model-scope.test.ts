import { strict as assert } from 'node:assert'
import test from 'node:test'
import { assertAllowedPilotModel, type PilotModel } from '../../experiments/provider.ts'

const free: PilotModel = { id: 'live-free', name: 'Free', api: 'openai-completions', catalogFree: true,
  referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }

test('MODEL-SCOPE: only catalog-free models and exact authorized DeepSeek V4.1 Flash id are admitted', () => {
  assert.doesNotThrow(() => assertAllowedPilotModel(free))
  assert.doesNotThrow(() => assertAllowedPilotModel({ ...free, id: 'deepseek-v4.1-flash', catalogFree: false,
    referenceCostPerMillion: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 } }))
  for (const candidate of [
    { ...free, id: 'deepseek-v4-flash', catalogFree: false },
    { ...free, id: 'muse-spark-1.3-contributor', catalogFree: false },
    { ...free, id: 'muse-spark-other', catalogFree: false },
    { ...free, referenceCostPerMillion: { ...free.referenceCostPerMillion, input: 0.01 } },
    { ...free, referenceCostPerMillion: { ...free.referenceCostPerMillion, input: Number.NaN } },
  ]) assert.throws(() => assertAllowedPilotModel(candidate), /outside the authorized/)
})
