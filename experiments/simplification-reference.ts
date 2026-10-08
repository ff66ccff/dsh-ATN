/** Verify each actual ablation through the same runtime, fixture and directed ACL. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { SIMPLIFICATION_ARMS, shiftingMechanisms } from './simplification-arms.ts'
import { runShiftingReference } from './shifting-evidence-reference.ts'

export const simplificationSeeds = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('Positive seed count required')
  return Array.from({ length: n }, (_, i) => 17 + i * 14)
}

export async function runSimplificationReferences(seeds: readonly number[]) {
  if (!seeds.length || new Set(seeds).size !== seeds.length || !seeds.every(Number.isSafeInteger)) throw new Error('Unique integer seeds required')
  const rows = []
  for (const seed of seeds) for (const mode of SIMPLIFICATION_ARMS) {
    const reference = await runShiftingReference({ agents: 8, seed, chainLength: 2, topologyBinding: true,
      steps: 48, maxCalls: 384, timeoutMs: 600_000, topology: mode })
    const expected = { ...shiftingMechanisms(mode), sharedBoard: false }
    const checks = { completed: reference.passed, allRequiredFacts: reference.obtainedRequiredFactCount === 4,
      noModelCalls: reference.issuedModelCalls === 0, stepBudget: reference.entrySteps <= 48,
      positiveFactFlow: reference.factFlowAudit?.passed === true,
      requesterAblation: expected.requesterFeedback || reference.requesterRatings === 0,
      boardAblation: expected.sharedBoard || reference.board.reads + reference.board.writes === 0,
      mechanisms: JSON.stringify(reference.mechanisms) === JSON.stringify(expected) }
    rows.push({ mode, seed, checks, configurationPassed: Object.values(checks).every(Boolean), reference })
  }
  const passed = rows.every(row => row.configurationPassed)
  return { version: 2, boardRemoved: true, noBoardAblationApplicable: false,
    generatedAt: new Date().toISOString(), seeds: [...seeds], modes: SIMPLIFICATION_ARMS,
    conditions: { agents: 8, chainLength: 2, topologyBinding: true, perNodeSteps: 48, maxCalls: 384, timeoutMs: 600_000 },
    issuedModelCalls: 0, passed, rows, causalClaim: false,
    interpretation: 'Legacy arm labels are retained for fixture compatibility; all 0.5.0 arms lack the removed board, so a board ablation is no longer applicable. Requester feedback still follows each arm. Host custody metadata and actual direct owner task/results remain available. No live model capability or benefit is asserted.' }
}

async function main() {
  const { values } = parseArgs({ options: { n: { type: 'string', default: '14' }, seeds: { type: 'string' },
    out: { type: 'string', default: 'experiments/results/simplification-reference-20261007.json' } } })
  const result = await runSimplificationReferences(values.seeds ? values.seeds.split(',').map(Number) : simplificationSeeds(Number(values.n)))
  await mkdir(dirname(resolve(values.out)), { recursive: true })
  await writeFile(resolve(values.out), JSON.stringify(result, null, 2) + '\n')
  for (const row of result.rows) console.log(JSON.stringify({ mode: row.mode, seed: row.seed,
    passed: row.configurationPassed, facts: `${row.reference.obtainedRequiredFactCount}/${row.reference.requiredFactCount}`,
    entrySteps: row.reference.entrySteps, modelCalls: row.reference.issuedModelCalls, requesterRatings: row.reference.requesterRatings }))
  if (!result.passed) throw new Error('A rewiring arm reference failed: configuration error, do not start live runs')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
