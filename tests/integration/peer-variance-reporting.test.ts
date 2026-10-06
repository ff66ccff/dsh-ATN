import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runShiftingEvidence } from '../../experiments/shifting-evidence-run.ts'
import { runShiftingCalibration } from '../../experiments/shifting-evidence-calibration.ts'
import { ScriptedModel } from '../fixtures/kernel.ts'

class RewireProbeScript extends ScriptedModel {
  private stage = 0
  private peers: string[] = []
  private self = ''
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const session = String(options.sessionId)
    if (session.startsWith('shifting-')) {
      if (this.stage === 0) this.enqueue(session, [{ tool: 'atn_status', args: { query: '*' } }])
      else if (this.stage === 1) {
        const status = options.messages.filter(message => message.role === 'tool').flatMap(message => message.content)
          .filter(block => block.type === 'text').map(block => {
            try { return JSON.parse(block.text) } catch { return null }
          }).find(value => value?.neighbours && value?.candidates)
        assert.ok(status?.candidates.length, 'probe discovers a legal replacement through read-only status')
        this.self = status.self
        this.peers = [status.neighbours[0], status.candidates[0]]
        this.enqueue(session, [{ tool: 'atn_status', args: { rewire: { peers: this.peers } } }])
      } else if (this.stage === 2) this.enqueue(session, [{ tool: 'atn_status', args: { rewire: { peers: this.peers } } }])
      else if (this.stage === 3) this.enqueue(session, [{ tool: 'atn_status', args: { rewire: { peers: [this.self] } } }])
      else if (this.stage === 4) this.enqueue(session, [{ tool: 'submit_checkpoint', args: { phase: 1, answer: '{}' } }])
      else if (this.stage === 5) this.enqueue(session, [{ tool: 'submit_checkpoint', args: { phase: 2, answer: '{}' } }])
      this.stage++
    }
    yield* super.stream(options)
  }
}

test('CLI separates adaptive probe planning and refuses unprobed live comparisons before any provider work', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-peer-variance-probe-cli-'))
  const execute = promisify(execFile)
  try {
    const { stdout } = await execute(process.execPath, ['--import', 'tsx/esm', 'experiments/shifting-evidence-run.ts',
      '--probe', '--models', 'space-bunny-free', '--out', join(scratch, 'probe')], { cwd: process.cwd() })
    const plan = JSON.parse(stdout)
    assert.equal(plan.purpose, 'adaptive-probe')
    assert.deepEqual(plan.plannedModes, ['adaptive'])
    await assert.rejects(execute(process.execPath, ['--import', 'tsx/esm', 'experiments/shifting-evidence-run.ts',
      '--execute', '--models', 'space-bunny-free', '--modes', 'fixed,adaptive', '--out', join(scratch, 'comparison')],
      { cwd: process.cwd() }), /requires --probe-report/)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('runner audits actual status.rewire attempts, changed successes, same-list commits, refusals and prior query', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-peer-variance-reporting-'))
  try {
    for (const mode of ['adaptive', 'fixed'] as const) {
      const report = await runShiftingEvidence({ model: { id: 'deepseek-v4.1-flash', name: 'Script only', api: 'test', catalogFree: false,
        referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      mode, directory: join(scratch, mode), agents: 8, seed: 17, chainLength: 2,
      perNodeSteps: 20, maxCalls: 160, maxOutputTokens: 1536, timeoutMs: 30000, observedTokenLimit: 400000 },
      { adapter: new RewireProbeScript() })
      const recorded = JSON.parse(await readFile(join(scratch, mode, 'report.json'), 'utf8'))
      const telemetry = recorded.protocol.rewireTelemetry
      assert.ok(telemetry, 'actual status.rewire invocation telemetry is persisted')
      assert.equal(telemetry.statusRewireCalls, 3)
      assert.equal(telemetry.successfulRewires, mode === 'adaptive' ? 1 : 0)
      assert.equal(telemetry.unchangedRewires, mode === 'adaptive' ? 1 : 0)
      assert.equal(telemetry.blockedRewires, mode === 'adaptive' ? 1 : 3)
      assert.equal(telemetry.ablationBlockedRewires, mode === 'fixed' ? 3 : 0)
      assert.equal(telemetry.callsWithPriorStatusQuery, 3)
      assert.equal(telemetry.pendingRewires, 0)
      assert.equal(recorded.protocol.stepHeadroom.maxNodeStepRatio,
        Math.max(...recorded.protocol.stepUse.map((row: any) => row.stepsUsed)) / report.conditions.perNodeSteps)
    }
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('calibration really executes fixed and adaptive at each prespecified seed and records separate step ratios', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-peer-variance-calibration-'))
  try {
    const scan = await runShiftingCalibration({ directory: join(scratch, 'scan'), repeats: 5, chainLengths: [2], steps: [32] })
    const configuration = scan.configurations[0]
    assert.deepEqual(scan.plan.seeds, [17, 31, 45, 59, 73])
    assert.equal(configuration.arms.find(arm => arm.mode === 'fixed')!.repeats, 5)
    assert.equal(configuration.arms.find(arm => arm.mode === 'adaptive')!.repeats, 5)
    for (const mode of ['fixed', 'adaptive']) {
      const measurements = configuration.stepHeadroom.arms.find(arm => arm.mode === mode)!.runs
      assert.deepEqual(measurements.map(row => row.seed), scan.plan.seeds)
      assert.ok(measurements.every(row => row.maxNodeStepRatio !== null))
    }
    assert.equal(scan.selected !== null, configuration.calibrationGatePassed)
    assert.equal(configuration.mayInterpretTopology, false)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})
