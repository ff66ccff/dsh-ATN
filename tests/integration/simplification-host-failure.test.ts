import { strict as assert } from 'node:assert'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { simplificationPower } from '../../experiments/simplification-statistics.ts'
import { SIMPLIFICATION_COST_CRITERION } from '../../experiments/simplification-protocol.ts'

test('SIMPLIFICATION-HOST-FAILURE: missing manifests and failed bootstrap audits retain evidence without admitting removal', async t => {
  const base = resolve('.artifacts/simplification/host-failure-tests')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, 'case-'))
  t.after(async () => {
    assert.ok(resolve(root).startsWith(base + sep))
    await rm(root, { recursive: true, force: true })
  })
  const power = simplificationPower(14), frozenAt = new Date().toISOString()
  const conditions = { agents: 8, chainLength: 2, topologyBinding: true, perNodeSteps: 48, maxCalls: 384,
    maxOutputTokens: 4096, timeoutMs: 600000, observedTokenLimit: 8000000, autoAdvance: false }
  const design = { frozenAt, power, conditions, seeds: Array.from({ length: 14 }, (_, i) => 17 + i * 14),
    model: 'deepseek-v4.1-flash', sourceHashes: { fixture: 'same' }, criterion: 'corrected', margin: .25, lowPowerAcknowledged: true,
    maintainerDecision: { selectedBy: 'maintainer', rationale: 'test pre-run tolerance and budget', evidence: 'test fixture' },
    costCriterion: SIMPLIFICATION_COST_CRITERION }
  const directory = join(root, 'run'), designPath = join(root, 'design.json'), output = join(root, 'audit.json')
  await mkdir(directory)
  const report = { runId: 'failed-host', directory, mode: 'no-board', seed: 17, conditions: { ...conditions, seed: 17 },
    model: design.model, execution: 'live-provider', purpose: 'comparison', sourceHashes: design.sourceHashes,
    startedAt: Date.parse(frozenAt) + 1, completedAt: Date.parse(frozenAt) + 2,
    passed: false, phase1Submitted: false, phase2Submitted: false, phase1Correct: false, phase2Correct: false,
    submissionDisciplineFailure: false, solvingFailure: false, stopReason: 'host-error:Error',
    issuedModelCalls: 0, atnTotalInteractions: 0, atnTotalTransferBytes: 0, entrySteps: null, metrics: null, protocol: null,
    mechanisms: { requesterFeedback: true, sharedBoard: false },
    reference: { topologyMode: 'no-board', passed: true, issuedModelCalls: 0, obtainedRequiredFactCount: 4,
      requiredFactCount: 4, requesterRatings: 6, board: { reads: 0, writes: 0 }, factFlowAudit: { passed: true } },
    factFlowAudit: { version: 1, passed: true, submittedCheckpoints: 0, auditedFacts: 0, facts: [], violations: [], noSubmission: true } }
  await writeFile(designPath, JSON.stringify(design))
  await writeFile(join(root, 'batch.json'), JSON.stringify({ planned: 56, completed: [report] }))
  await writeFile(join(directory, 'report.json'), JSON.stringify(report))
  const args = ['--import', 'tsx/esm', 'scripts/summarize-topology-binding.mjs', '--comparison', root,
    '--study-design', designPath, '--out', output]
  await promisify(execFile)(process.execPath, args, { cwd: process.cwd(), timeout: 30000 })
  const audit = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(audit.summary.observedRuns, 1)
  assert.equal(audit.summary.failedRunsRetained, 1)
  assert.equal(audit.auditPassed, false)
  assert.equal(audit.comparison.runs[0].hostExceptionAuditIncomplete, true)
  assert.equal(audit.comparison.runs[0].atnTotalInteractions, null)
  assert.equal(audit.summary.arms.find((row: any) => row.mode === 'no-board').allConsumption.interactions.unknownRuns, 1)
  assert.ok(audit.summary.recommendations.every((row: any) => row.defaultAction === '保留'))
  const bootstrap = join(root, 'bootstrap')
  await mkdir(bootstrap)
  await writeFile(join(bootstrap, 'user-profile-integrity-final.json'), JSON.stringify({ unchanged: false,
    before: { 'cordis.patch.yml': 'before' }, after: { 'cordis.patch.yml': 'changed' } }))
  await writeFile(join(bootstrap, 'observer-completion.json'), JSON.stringify({ completed: false, exitCode: 1 }))
  await assert.rejects(promisify(execFile)(process.execPath, [...args, '--comparison-bootstrap', bootstrap],
    { cwd: process.cwd(), timeout: 30000 }))
  const retained = JSON.parse(await readFile(output, 'utf8'))
  assert.equal(retained.summary.observedRuns, 1)
  assert.equal(retained.comparisonBootstrap.integrity.unchanged, false)
  assert.equal(retained.bootstrapPassed, false)
  assert.equal(retained.auditPassed, false)
  assert.equal(retained.summary.readyForDecision, false)
  assert.ok(retained.summary.comparisons.every((row: any) => row.nonInferiorityPassed === false))
  assert.ok(retained.summary.recommendations.every((row: any) => row.defaultAction === '保留' && row.conclusion === '不确定'))
  await writeFile(join(directory, 'report.json'), JSON.stringify({ ...report, passed: true }))
  await assert.rejects(promisify(execFile)(process.execPath, args, { cwd: process.cwd(), timeout: 30000 }))
})
