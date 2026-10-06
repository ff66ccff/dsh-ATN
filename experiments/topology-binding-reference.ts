/** Constructive adaptive/fixed counterfactuals, zero provider calls. */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { runShiftingReference } from './shifting-evidence-reference.ts'
import { bindingReferenceGate, type BindingReferencePair } from './topology-binding-audit.ts'

export async function runBindingReferencePair(conditions: BindingReferencePair['conditions'], sourceHashes: Record<string, string>): Promise<BindingReferencePair> {
  const options = { agents: conditions.agents, seed: conditions.seed, chainLength: conditions.chainLength,
    topologyBinding: true, steps: conditions.perNodeSteps, maxCalls: conditions.maxCalls, timeoutMs: conditions.timeoutMs }
  const adaptive = await runShiftingReference({ ...options, topology: 'adaptive' })
  const fixed = await runShiftingReference({ ...options, topology: 'fixed' })
  const pair = { conditions, sourceHashes, adaptive, fixed }
  if (!bindingReferenceGate(pair, { conditions, sourceHashes })) throw new Error('Constructive binding confirmation failed: require adaptive completion with every required fact and fixed failure with missing required facts')
  return pair
}

async function main() {
  const { values } = parseArgs({ options: { seeds: { type: 'string', default: '17,31,45,59,73' },
    out: { type: 'string', default: 'experiments/results/four-arm-reference-20261006.json' } } })
  const { shiftingSourceHashes } = await import('./shifting-evidence-run.ts')
  const sourceHashes = await shiftingSourceHashes(), runs: BindingReferencePair[] = []
  for (const seed of values.seeds.split(',').map(Number)) {
    const conditions: BindingReferencePair['conditions'] = { agents: 8, seed, chainLength: 2, topologyBinding: true,
      perNodeSteps: 48, maxCalls: 384, timeoutMs: 600_000 }
    const pair = await runBindingReferencePair(conditions, sourceHashes); runs.push(pair)
    console.log(JSON.stringify({ seed, adaptive: { passed: pair.adaptive.passed, facts: pair.adaptive.obtainedRequiredFactCount,
      entrySteps: pair.adaptive.entrySteps }, fixed: { passed: pair.fixed.passed, facts: pair.fixed.obtainedRequiredFactCount,
      entrySteps: pair.fixed.entrySteps }, confirmed: true }))
  }
  await mkdir(dirname(resolve(values.out)), { recursive: true })
  await writeFile(resolve(values.out), JSON.stringify({ version: 1, issuedModelCalls: 0, sourceHashes, runs,
    bindingConfirmed: runs.length >= 5 && runs.every(pair => bindingReferenceGate(pair, pair)), causalClaim: false }, null, 2) + '\n')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
