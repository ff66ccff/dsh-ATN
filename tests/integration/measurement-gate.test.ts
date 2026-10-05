/** All feasibility checks run offline before a provider or experiment directory. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { limitsFromConfig } from '../../src/config.ts'
import { assertReferenceFeasible, topologyRuntimeConfig, type MeasurementLimits } from '../../experiments/measurement-gate.ts'
import { runPilot, type RunOptions } from '../../experiments/run.ts'

const limits: MeasurementLimits = { maxAgents: 8, perNodeSteps: 16, maxCalls: 128, timeoutMs: 180_000 }

test('MEASUREMENT-GATE-01: all main task and recovery configurations fit the exact runtime limits', async () => {
  for (const task of ['shift-ledger-1', 'shift-ledger-2'] as const) {
    for (const recoveryMode of ['self-organized', 'preassigned-backup'] as const) {
      const configuration = { ...limits, recoveryMode }
      const result = await assertReferenceFeasible(task, configuration)
      assert.equal(result.delivered, true, `${task}/${recoveryMode}: ${result.failure}`)
      assert.equal(result.issuedModelCalls, 0)
      assert.equal(result.stepProxyEnforced, true)
      assert.equal(result.manipulation.valid, true)
      assert.ok(result.actions <= limits.maxCalls)
      assert.ok(result.maxNodeActions <= 16)
      assert.ok(Object.values(result.actionsByNode).every(actions => actions <= 16))
      assert.deepEqual(result.limits, limitsFromConfig(topologyRuntimeConfig(configuration)))
    }
  }
})

test('MEASUREMENT-GATE-02: insufficient node steps or global actions refuse the run', async () => {
  await assert.rejects(assertReferenceFeasible('shift-ledger-1', { ...limits, perNodeSteps: 1 }), /Reference gate refused.*reference-step-limit/)
  await assert.rejects(assertReferenceFeasible('shift-ledger-1', { ...limits, maxCalls: 1 }), /Reference gate refused.*reference-action-limit/)
  await assert.rejects(assertReferenceFeasible('no-reference-task', limits), /no deterministic reference/)
})

test('MEASUREMENT-GATE-03: runPilot rejects infeasible or uncalibrated ATN before artifacts and provider network access', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-gate-before-provider-'))
  const originalFetch = globalThis.fetch
  let fetches = 0
  globalThis.fetch = async () => { fetches++; throw new Error('Provider network access is forbidden in this test') }
  try {
    const options: RunOptions = { mode: 'atn-adaptive', task: 'shift-ledger-1', directory: join(scratch, 'run'),
      model: { id: 'offline-gate-test', name: 'offline', api: 'unavailable', catalogFree: true,
        referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      maxAgents: 8, perNodeSteps: 16, maxCalls: 128, maxOutputTokens: 8192,
      observedTokenLimit: null, timeoutMs: 180_000, calibration: true }
    await assert.rejects(runPilot({ ...options, perNodeSteps: 1 }), /Reference gate refused/)
    await assert.rejects(access(options.directory), { code: 'ENOENT' })
    await assert.rejects(runPilot({ ...options, maxCalls: 1 }), /Reference gate refused/)
    await assert.rejects(access(options.directory), { code: 'ENOENT' })
    await assert.rejects(runPilot({ ...options, maxCalls: 127 }), /Global call safety cap must cover/)
    await assert.rejects(access(options.directory), { code: 'ENOENT' })
    await assert.rejects(runPilot({ ...options, calibration: false, calibrationSamples: [] }), /Missing matching.*calibration/)
    await assert.rejects(access(options.directory), { code: 'ENOENT' })
    assert.equal(fetches, 0)
  } finally {
    globalThis.fetch = originalFetch
    await rm(scratch, { recursive: true, force: true })
  }
})
