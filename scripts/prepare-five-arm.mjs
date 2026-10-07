/** Freeze the pre-specified design and archive sources before the Desktop carrier starts. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { shiftingSourceHashes } from '../experiments/shifting-evidence-run.ts'
import { SHIFTING_ARMS } from '../experiments/shifting-evidence-protocol.ts'
import { STATIC_WIDE_POLICY } from '../experiments/static-wide-topology.ts'

const root = resolve('.artifacts/five-arm'), snapshot = join(root, 'source')
await mkdir(snapshot)
const sourceHashes = await shiftingSourceHashes()
for (const file of Object.keys(sourceHashes)) {
  const destination = resolve(snapshot, 'experiments', file)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(resolve('experiments', file), destination)
}
const brief = 'docs/FOUR_ARM_COMPARISON_REVISED_BRIEF.md'
await copyFile(resolve(brief), join(snapshot, 'FOUR_ARM_COMPARISON_REVISED_BRIEF.md'))
await writeFile(join(snapshot, 'source-hashes.json'), JSON.stringify(sourceHashes, null, 2) + '\n')
const evidence = 'experiments/results/four-arm-admission-and-cost-20261006.json'
const prior = JSON.parse(await readFile(resolve(evidence), 'utf8'))
const options = { directory: resolve('.artifacts/experiments/five-arm-deepseek-comparison-20261006'),
  models: ['deepseek-v4.1-flash'], modes: [...SHIFTING_ARMS], purpose: 'comparison', repeats: 5, seed: 17,
  agents: 8, chainLength: 2, topologyBinding: true, perNodeSteps: 48, maxCalls: 384,
  maxOutputTokens: 4096, observedTokenLimit: 8_000_000, timeoutMs: 600_000,
  profile: 'desktop-five-arm-validation', sourceProfile: 'desktop' }
const design = { frozenAt: new Date().toISOString(), modes: SHIFTING_ARMS, seeds: [17, 31, 45, 59, 73],
  repeatsPerArm: 5, plannedRuns: 25, options, sourceHashes, staticWidePolicy: STATIC_WIDE_POLICY,
  brief: { path: brief, sha256: createHash('sha256').update(await readFile(resolve(brief))).digest('hex') },
  modelEligibilityEvidence: { path: evidence, sha256: createHash('sha256').update(await readFile(resolve(evidence))).digest('hex'),
    model: 'deepseek-v4.1-flash', historicalProbeCompletion: prior.probe.runs.filter(run => run.phase1Correct && run.phase2Correct).length + '/' + prior.probe.runs.length,
    use: 'Historical routing and demonstrated completion only; neither a current-source success estimate nor a comparison admission gate.' },
  excludedModels: ['longcat-2.5-preview-free'], primaryMetric: 'model calls per two-phase completed run',
  secondaryMetricMethod: 'Wilson 95% completion intervals, exact paired McNemar with Holm correction over ten pairs',
  efficiencyInterval: 'Student t 95%; conditional on completion; failed consumption separate',
  noOutcomeDependentRepeats: true, causalClaim: false }
await writeFile(join(root, 'design.json'), JSON.stringify(design, null, 2) + '\n')
await writeFile(join(root, 'comparison-config.json'), JSON.stringify({ output: join(root, 'desktop-comparison-20261006'),
  bridgePath: resolve('experiments/shifting-evidence-profile-run.ts'), carrierDeadlineMs: 255 * 60_000, options }, null, 2) + '\n')
console.log(JSON.stringify({ plannedRuns: 25, sourceFiles: Object.keys(sourceHashes).length, modes: SHIFTING_ARMS,
  directory: options.directory, snapshot }))
