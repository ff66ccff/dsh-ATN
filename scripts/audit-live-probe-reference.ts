/** Zero-provider audit of brief section 7.2. Does not authorize a live run. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { runShiftingReference } from '../experiments/shifting-evidence-reference.ts'
import { shiftingSourceHashes } from '../experiments/shifting-evidence-run.ts'

const out = resolve(process.argv[2] ?? '.artifacts/live-probe-feasibility/20261015')
await mkdir(out, { recursive: true })
const archive = resolve('docs/execution-evidence/agy-model-20261015')
const plan = JSON.parse(await readFile(join(archive, 'plan.json'), 'utf8'))
assert.equal(plan.model.id, 'gemini-3.8-flash-tiered')
assert.equal(plan.reasoningEffort, 'medium')
const before = await shiftingSourceHashes()
const original = await readFile(resolve('experiments/shifting-evidence-reference.ts'), 'utf8')
const needle = 'if (mechanisms.requesterFeedback) {'
assert.equal(original.split(needle).length - 1, 2)
// Keep adaptive mechanisms enabled. Only this constructive policy chooses not
// to rate replies; no ACL, schema, result validation or runtime is changed.
const variant = original.replaceAll(needle, 'if (false && mechanisms.requesterFeedback) {')
await writeFile(join(out, 'reference-without-ratings.ts.txt'), variant)
const temporary = resolve('experiments', `.live-probe-reference-audit-${randomUUID()}.ts`)
await writeFile(temporary, variant, { flag: 'wx' })
const results = []
try {
  const alternate = await import(pathToFileURL(temporary).href)
  for (const seed of plan.seeds as number[]) {
    const conditions = { agents: 8, chainLength: 2, seed, steps: 12, maxCalls: 96,
      timeoutMs: 120000, topology: 'adaptive' as const }
    const baseline = await runShiftingReference(conditions)
    const counterexample = await alternate.runShiftingReference(conditions) as typeof baseline
    for (const row of [baseline, counterexample]) {
      assert.equal(row.passed, true)
      assert.equal(row.issuedModelCalls, 0)
      assert.equal(row.topologyMode, 'adaptive')
    }
    assert.deepEqual(counterexample.mechanisms, baseline.mechanisms)
    assert.deepEqual(counterexample.topology, baseline.topology)
    assert.equal(baseline.actions, 60)
    assert.equal(baseline.maxNodeActions, 8)
    assert.ok(counterexample.actions < baseline.actions)
    assert.ok(counterexample.maxNodeActions < baseline.maxNodeActions)
    const compact = (row: typeof baseline) => ({ passed: row.passed, issuedModelCalls: row.issuedModelCalls,
      actions: row.actions, maxNodeActions: row.maxNodeActions, requesterRatings: row.requesterRatings,
      mechanisms: row.mechanisms, topology: row.topology, evaluation: row.evaluation })
    results.push({ seed, baseline: compact(baseline), counterexample: compact(counterexample) })
  }
} finally {
  await unlink(temporary)
}
const after = await shiftingSourceHashes()
assert.ok(isDeepStrictEqual(before, after), 'Audit must not change hashed source files')
const hashes = Object.entries(after).map(([file, current]) => ({ file, current,
  archived: plan.sourceHashes[file], matchesArchive: current === plan.sourceHashes[file] }))
const historical = []
for (const seed of plan.seeds as number[]) {
  const report = JSON.parse(await readFile(join(archive, `seed-${seed}-report.json`), 'utf8'))
  historical.push({ seed, stopReason: report.stopReason, cleanup: report.cleanup,
    totals: report.metrics.totals, failures: report.failures })
}
const report = { status: 'stopped', stopCondition: 'LIVE_PROBE_FEASIBILITY_BRIEF.md section 7.2',
  provider: 'agy', model: plan.model.id, reasoningEffort: plan.reasoningEffort,
  newLiveModelCalls: 0, referenceModelCalls: 0,
  interpretation: '60/8 count a constructive policy, not a proven strict lower bound. The alternate policy is an audit witness only, not a replacement bound or live-model success. It preserves runtime legality and answer validation; it does not claim prompt/protocol compliance or that 46 calls suffice for a live model.',
  results, hashes, sourceHashesUnchangedDuringAudit: true,
  telemetryIsArchived: Object.hasOwn(plan.sourceHashes, 'telemetry.ts'),
  alternateSourceSha256: createHash('sha256').update(variant).digest('hex'), historical }
await writeFile(join(out, 'reference-audit.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ status: report.status, stopCondition: report.stopCondition,
  newLiveModelCalls: 0, results, sourceHashesUnchangedDuringAudit: true,
  archiveMismatches: hashes.filter(row => !row.matchesArchive), output: join(out, 'reference-audit.json') }, null, 2))
