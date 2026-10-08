/** Fixed/adaptive feasibility and step-headroom scan. No provider credentials or calls are installed. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { runShiftingEvidence } from './shifting-evidence-run.ts'
import { ShiftingMailScript } from './shifting-evidence-script.ts'
import { summarizeShiftingRuns } from './shifting-evidence-protocol.ts'

export async function runShiftingCalibration(options: { directory: string; repeats?: number; chainLengths?: number[]; steps?: number[] }) {
  const repeats = options.repeats ?? 5
  const chainLengths = options.chainLengths ?? [2, 3, 4], steps = options.steps ?? [20, 32, 48]
  if (!Number.isSafeInteger(repeats) || repeats < 5) throw new Error('Calibration requires at least five repeats per configuration')
  const root = resolve(options.directory)
  await mkdir(dirname(root), { recursive: true }); await mkdir(root)
  const model = { id: 'deepseek-v4.1-flash', name: 'Scripted adapter; this label does not invoke DeepSeek', api: 'scripted', catalogFree: false,
    referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  const configs = chainLengths.flatMap(chainLength => steps.map(perNodeSteps => ({ chainLength, perNodeSteps })))
    .sort((a, b) => a.chainLength - b.chainLength || a.perNodeSteps - b.perNodeSteps)
  // Freeze the complete grid, seeds and ordering before observing the first result.
  const plan = { version: 2, execution: 'scripted-test', repeats, seeds: Array.from({ length: repeats }, (_, i) => 17 + i * 14),
    arms: ['fixed', 'adaptive'] as const,
    configurations: configs, selection: 'Legacy deterministic configuration scan: lowest chainLength, then lowest perNodeSteps with >=5 fixed/adaptive observations and every measured node <=80% of its step budget. No small-sample completion threshold.',
    limits: { agents: 8, maxOutputTokens: 1536, timeoutMs: 30000, observedTokenLimit: 400000, autoAdvance: false },
    maxCalls: 'agents * perNodeSteps, explicitly matched to node allocations', providerCalls: 0,
    interpretation: 'Deterministic policy feasibility through real tools and ACLs. Not a real-model calibration or topology-effect comparison.', causalClaim: false }
  await writeFile(join(root, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
  const configurations: Array<ReturnType<typeof summarizeShiftingRuns> & { chainLength: number; perNodeSteps: number; directories: string[] }> = []
  for (const configuration of configs) {
    const reports = []
    for (const mode of plan.arms) for (const seed of plan.seeds) {
      const directory = join(root, `chain-${configuration.chainLength}-steps-${configuration.perNodeSteps}-${mode}-seed-${seed}`)
      const report = await runShiftingEvidence({ ...plan.limits, ...configuration, seed, model, mode,
        maxCalls: plan.limits.agents * configuration.perNodeSteps, directory }, { adapter: new ShiftingMailScript() })
      reports.push({ ...report, directory, reportSha256: createHash('sha256').update(await readFile(join(directory, 'report.json'))).digest('hex') })
    }
    const summary = summarizeShiftingRuns(reports)
    configurations.push({ ...configuration, ...summary, directories: reports.map(report => report.directory) })
    await writeFile(join(root, 'scan.json'), JSON.stringify({ plan, configurations, complete: false }, null, 2) + '\n')
    console.log(JSON.stringify({ ...configuration, completed: reports.length, fixedCorrect: summary.arms.find(arm => arm.mode === 'fixed')!.correct,
      adaptiveCorrect: summary.arms.find(arm => arm.mode === 'adaptive')!.correct, eligible: summary.calibrationGatePassed,
      stepRatios: summary.stepHeadroom.arms.filter(arm => plan.arms.includes(arm.mode as typeof plan.arms[number]))
        .map(arm => ({ mode: arm.mode, seeds: arm.runs.map(run => ({ seed: run.seed, maxNodeStepRatio: run.maxNodeStepRatio, withinLimit: run.withinLimit })) })) }))
  }
  const selected = configurations.find(configuration => configuration.calibrationGatePassed) ?? null
  const report = { plan, configurations, complete: true,
    selected: selected ? { chainLength: selected.chainLength, perNodeSteps: selected.perNodeSteps,
      runIds: selected.runs.map(run => run.runId), artifacts: selected.directories } : null,
    realModelGatePassed: false, interpretation: plan.interpretation, causalClaim: false }
  await writeFile(join(root, 'scan.json'), JSON.stringify(report, null, 2) + '\n')
  return report
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string', default: '.artifacts/experiments/measurability-calibration-20261005' },
    repeats: { type: 'string', default: '5' } } })
  const report = await runShiftingCalibration({ directory: values.out, repeats: Number(values.repeats) })
  console.log(JSON.stringify({ selected: report.selected, realModelGatePassed: false }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
