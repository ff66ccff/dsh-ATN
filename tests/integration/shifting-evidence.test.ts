import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runShiftingReference } from '../../experiments/shifting-evidence-reference.ts'
import { runShiftingEvidence } from '../../experiments/shifting-evidence-run.ts'
import { ScriptedModel } from '../fixtures/kernel.ts'
import { ShiftingMailScript } from '../../experiments/shifting-evidence-script.ts'

test('explicit observed-token thresholds support 4m, reject above 8m, and leave the CLI default at 400k', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-shifting-token-threshold-'))
  const options = { model: { id: 'deepseek-v4.1-flash', name: 'Idle script', api: 'test', catalogFree: false,
    referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  mode: 'fixed' as const, directory: join(scratch, 'explicit'), agents: 8, seed: 17, chainLength: 2,
  perNodeSteps: 32, maxCalls: 256, maxOutputTokens: 4096, timeoutMs: 30000, observedTokenLimit: 4_000_000 }
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx/esm', 'experiments/shifting-evidence-run.ts',
      '--models', 'space-bunny-free', '--modes', 'fixed', '--out', join(scratch, 'defaults')], { cwd: process.cwd() })
    const dryRun = JSON.parse(stdout)
    assert.equal(dryRun.execute, false)
    assert.equal(dryRun.limits.observedTokenLimit, 400_000)
    assert.equal(dryRun.limits.perNodeSteps, 16)
    assert.equal(dryRun.limits.maxCalls, 128)
    assert.equal(dryRun.limits.maxOutputTokens, 2048)
    assert.equal(dryRun.limits.autoAdvance, false)
    const report = await runShiftingEvidence(options, { adapter: new ScriptedModel() })
    assert.equal(report.conditions.observedTokenLimit, 4_000_000)
    assert.equal(report.conditions.perNodeSteps, 32)
    assert.equal(report.stopReason, 'phase-1-quiescence')
    const manifest = JSON.parse(await readFile(join(options.directory, 'manifest.json'), 'utf8'))
    assert.equal(manifest.limits.observedTokenLimit, 4_000_000)
    await assert.rejects(() => runShiftingEvidence({ ...options, directory: join(scratch, 'invalid'), observedTokenLimit: 8_000_001 },
      { adapter: new ScriptedModel() }), /Invalid bounded observedTokenLimit/)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('same-bound hub synthesis is feasible through real fixed ring mail for both changing chain phases', async () => {
  for (const agents of [8, 16]) {
    const report = await runShiftingReference({ agents, steps: 16, maxCalls: agents * 16, seed: 17 })
    assert.equal(report.passed, true)
    assert.equal(report.issuedModelCalls, 0)
    assert.equal(report.topology.nodes, agents)
    assert.equal(report.topology.maxPeers, 2)
    assert.equal(report.topology.diameter, agents / 2)
    assert.equal(report.topology.reachableFromEntry, agents)
    assert.ok(report.maxNodeActions <= 16)
    assert.ok(report.actions <= agents * 16)
    assert.ok(report.messages > agents)
    assert.equal(report.messages, report.hops)
    assert.ok(Object.values(report.manipulation.checks).every(Boolean))
    assert.equal(report.manipulation.deniedReads, 0)
    assert.equal(report.board.reads, 0)
    assert.equal(report.totalInteractions, report.messages)
    assert.equal(report.totalTransferBytes, report.payloadBytes)
  }
})

test('fixed scripted policy solves from rendered ACL evidence and metered mail without automatic phase advance', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-shifting-calibration-'))
  try {
    const report = await runShiftingEvidence({ model: { id: 'deepseek-v4.1-flash', name: 'Script only', api: 'test', catalogFree: false,
      referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    mode: 'fixed', directory: join(scratch, 'run'), agents: 8, seed: 17, chainLength: 2,
    // This checks solving and ACL behavior, not machine-dependent polling cost.
    perNodeSteps: 48, maxCalls: 384, maxOutputTokens: 1536, timeoutMs: 60000, observedTokenLimit: 400000 }, { adapter: new ShiftingMailScript(500) })
    assert.equal(report.passed, true, JSON.stringify({ stopReason: report.stopReason,
      phase1Submitted: report.phase1Submitted, phase1Correct: report.phase1Correct,
      phase2Submitted: report.phase2Submitted, phase2Correct: report.phase2Correct,
      protocol: report.protocol, failures: report.failures }))
    assert.deepEqual([report.phase1Submitted, report.phase1Correct, report.phase2Submitted, report.phase2Correct], [true, true, true, true])
    assert.equal(report.manipulation.automaticAdvanceOccurred, false)
    assert.equal(report.conditions.autoAdvance, false)
    assert.equal(report.meanInputTokensPerCall, null, 'scripted decisions do not invent provider input tokens')
    assert.ok(report.metrics!.callCosts.length > 0)
    assert.ok(report.atnMessages > 0)
    assert.deepEqual(report.atnBoard, { reads: 0, writes: 0, readBytes: 0, writeBytes: 0 })
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('runner leaves phase 1 unsubmitted by default, and explicitly labels opt-in automatic advance', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-shifting-auto-advance-'))
  try {
    for (const autoAdvance of [false, true]) {
      const report = await runShiftingEvidence({ model: { id: 'deepseek-v4.1-flash', name: 'Idle script', api: 'test', catalogFree: false,
        referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      mode: 'fixed', directory: join(scratch, String(autoAdvance)), agents: 8, seed: 17, chainLength: 2, autoAdvance,
      perNodeSteps: 20, maxCalls: 160, maxOutputTokens: 1536, timeoutMs: 30000, observedTokenLimit: 400000 }, { adapter: new ScriptedModel() })
      assert.equal(report.phase1Submitted, false)
      assert.equal(report.submissionDisciplineFailure, true)
      assert.equal(report.solvingFailure, false)
      assert.equal(report.manipulation.automaticAdvanceOccurred, autoAdvance)
      assert.equal(report.manipulation.phase, autoAdvance ? 2 : 1)
      assert.equal(report.stopReason, autoAdvance ? 'phase-2-quiescence' : 'phase-1-quiescence')
    }
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('runner completes both phase receipts through real tools without a provider, labels oracle failures and preserves artifacts', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-shifting-runner-'))
  const sent = new Set<string>()
  const phase2Workers = new Set<string>()
  const phase2Notices = new Set<string>()
  let markWorkerEntered!: () => void, markPhase2Started!: () => void, markWorkerObservedPhase2!: () => void
  const workerEntered = new Promise<void>(done => { markWorkerEntered = done })
  const phase2Started = new Promise<void>(done => { markPhase2Started = done })
  const workerObservedPhase2 = new Promise<void>(done => { markWorkerObservedPhase2 = done })
  class CheckpointModel extends ScriptedModel {
    override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const session = String(options.sessionId)
      for (const message of options.messages) if (message.role === 'user') for (const block of message.content) {
        if (block.type === 'text' && block.text.startsWith('Host update: PHASE 2 is active.')) phase2Notices.add(block.text)
      }
      const phase2 = JSON.stringify(options.messages).includes('Host update: PHASE 2 is active.')
      const key = `${session}:${phase2 ? 2 : 1}`
      if (session.startsWith('shifting-') && !sent.has(key)) {
        if (phase2) { markPhase2Started(); await workerObservedPhase2 }
        else await workerEntered
        sent.add(key)
        this.enqueue(session, [{ tool: 'submit_checkpoint', args: { phase: phase2 ? 2 : 1, answer: '{}' } }])
      } else if (!session.startsWith('shifting-')) {
        if (phase2) { phase2Workers.add(session); markWorkerObservedPhase2() }
        else { markWorkerEntered(); await phase2Started }
        // Keep workers in ordinary tool loops until the host steers the phase
        // change, rather than depending on next-turn followup delivery.
        if (!phase2 || !sent.has(key)) {
          sent.add(key); this.enqueue(session, [{ tool: 'read_evidence', args: { id: 'mine' } }])
        }
      }
      yield* super.stream(options)
    }
  }
  const adapter = new CheckpointModel()
  const options = { model: { id: 'deepseek-v4.1-flash', name: 'Scripted test', api: 'test', catalogFree: false,
    referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  mode: 'adaptive' as const, directory: join(scratch, 'run'), agents: 8, seed: 17,
  perNodeSteps: 16, maxCalls: 128, maxOutputTokens: 1536, timeoutMs: 30_000, observedTokenLimit: 400_000 }
  try {
    const report = await runShiftingEvidence(options, { adapter })
    assert.equal(report.execution, 'scripted-test')
    assert.equal(report.stopReason, 'phase-2-submitted')
    assert.equal(report.cleanup, 'released')
    assert.equal(report.passed, false, 'receipt is not a correctness signal')
    assert.deepEqual(report.evaluation.map(row => row.submitted), [true, true])
    assert.ok(report.issuedModelCalls < 128)
    assert.ok(phase2Workers.size > 0, 'a running worker receives phase change before its original turn ends')
    assert.ok(phase2Notices.size > 0)
    for (const notice of phase2Notices) {
      assert.match(notice, /entry.*root.*two.*task.*review.*checkpoint/i)
      assert.match(notice, /helpers.*publish.*once.*respond.*relay/i)
      assert.match(notice, /explicitly assigned.*fragment/i)
      assert.match(notice, /no assigned work.*end.*turn.*wait/i)
      assert.match(notice, /only the entry.*submit/i)
    }
    assert.equal(report.checkpointObligations.length, 2)
    assert.ok(report.checkpointObligations.some(row => row.openTasks > 0))
    assert.ok(report.protocolAfterCleanup)
    const prior = await readFile(join(options.directory, 'report.json'), 'utf8')
    await assert.rejects(runShiftingEvidence(options, { adapter }), /EEXIST/)
    assert.equal(await readFile(join(options.directory, 'report.json'), 'utf8'), prior)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})
