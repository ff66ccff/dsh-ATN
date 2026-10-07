/** Freeze a reviewable study only after an offline, reachable design is selected. */
import { parseArgs } from 'node:util'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, join, dirname } from 'node:path'
import { simplificationPower } from '../experiments/simplification-statistics.ts'
import { simplificationSeeds, runSimplificationReferences } from '../experiments/simplification-reference.ts'
import { SIMPLIFICATION_ARMS } from '../experiments/simplification-arms.ts'
import { assertSimplificationDesign, registeredSimplificationArms, SIMPLIFICATION_COST_CRITERION } from '../experiments/simplification-protocol.ts'
import { shiftingSourceHashes } from '../experiments/shifting-evidence-run.ts'

const { values } = parseArgs({ options: { n: { type: 'string' }, delta: { type: 'string' }, criterion: { type: 'string', default: 'corrected' },
  rationale: { type: 'string' }, evidence: { type: 'string' }, arms: { type: 'string', default: SIMPLIFICATION_ARMS.join(',') },
  'allow-low-power': { type: 'boolean', default: false }, root: { type: 'string', default: '.artifacts/simplification/registered' },
  'previous-design': { type: 'string', default: '.artifacts/five-arm/design.json' } } })
if (values.criterion !== 'corrected') throw new Error('Only the revised lower-bound criterion may be registered')
if (!values.n || !values.delta || !values.rationale?.trim() || !values.evidence?.trim()) throw new Error('Explicit maintainer --delta, --n, --rationale and --evidence are required before registration')
const n = Number(values.n), margin = Number(values.delta), power = simplificationPower(n, margin), seeds = simplificationSeeds(n)
const modes = registeredSimplificationArms({ modes: values.arms.split(',') })
if (!power.readyToRun) throw new Error(`Unreachable ${100 * margin}pp design; increase n before any live run (both the exact best-case floor and the registered 95% score interval must exclude delta)`)
if (power.lowPowerAcknowledgementRequired && !values['allow-low-power']) throw new Error('Below 80% planning power; a pre-run budget decision is required (--allow-low-power records it)')
const sourceHashes = await shiftingSourceHashes(), prior = JSON.parse(await readFile(resolve(values['previous-design']), 'utf8'))
const mutable = new Set(['shifting-evidence-run.ts', 'shifting-evidence-profile-run.ts', 'shifting-evidence-reference.ts',
  'shifting-evidence-protocol.ts', '../package.json'])
const freezeChecks = Object.fromEntries(Object.entries(prior.sourceHashes).filter(([file]) => !mutable.has(file))
  .map(([file, expected]) => [file, sourceHashes[file] === expected]))
if (!Object.values(freezeChecks).every(Boolean)) throw new Error('Frozen task/ACL/fixture/runtime/lockfile changed since the five-arm baseline')
const priorOptions = prior.options
const conditions = { agents: 8, chainLength: 2, topologyBinding: true, perNodeSteps: 48, maxCalls: 384,
  maxOutputTokens: 4096, timeoutMs: 600_000, observedTokenLimit: 8_000_000, autoAdvance: false }
if (Object.entries(conditions).some(([key, value]) => key !== 'autoAdvance' && priorOptions[key] !== value) ||
  JSON.stringify(priorOptions.models) !== JSON.stringify(['deepseek-v4.1-flash'])) throw new Error('Frozen live experiment conditions do not match the baseline')
const root = resolve(values.root)
await mkdir(root, { recursive: false })
const testStartedAt = new Date().toISOString()
const criterionOutput = execFileSync(process.execPath, ['--import', 'tsx/esm', '--test', 'tests/unit/simplification-statistics.test.ts'], { encoding: 'utf8', timeout: 60_000 })
await writeFile(join(root, 'criterion-tests.txt'), criterionOutput, { flag: 'wx' })
const criterionValidation = { passed: true, startedAt: testStartedAt, completedAt: new Date().toISOString(),
  requiredCases: ['SIMPLIFICATION-BRIEF-REJECT', 'SIMPLIFICATION-BRIEF-ACCEPT'], issuedModelCalls: 0 }
if (!criterionValidation.requiredCases.every(name => criterionOutput.includes(name))) throw new Error('Required revised-brief criterion tests were not executed')
await writeFile(join(root, 'criterion-validation.json'), JSON.stringify(criterionValidation, null, 2) + '\n', { flag: 'wx' })
await writeFile(join(root, 'power.json'), JSON.stringify(power, null, 2) + '\n', { flag: 'wx' })
const references = await runSimplificationReferences(seeds)
await writeFile(join(root, 'reference.json'), JSON.stringify(references, null, 2) + '\n', { flag: 'wx' })
if (!references.passed) throw new Error('Constructive ablation reference failed; fix configuration before running')
const design = { frozenAt: new Date().toISOString(), seeds, model: 'deepseek-v4.1-flash', sourceHashes, conditions,
  criterion: values.criterion, margin, lowPowerAcknowledged: values['allow-low-power'], power,
  maintainerDecision: { selectedBy: 'maintainer', rationale: values.rationale, evidence: values.evidence },
  costCriterion: SIMPLIFICATION_COST_CRITERION,
  modes, untestedArms: SIMPLIFICATION_ARMS.filter(mode => !modes.includes(mode)), plannedRuns: n * modes.length,
  referencePassed: true, referencePath: join(root, 'reference.json'), criterionValidationPath: join(root, 'criterion-validation.json'), freezeChecks,
  baselineDesign: values['previous-design'], primaryMetric: 'all-run coordination cost (including failures)',
  completionMetric: 'report-only completion; lower 95% bound > -delta is required for any noninferiority claim',
  interaction: 'minimal versus adaptive; removal requires the joint ablation to pass',
  failurePolicy: 'Keep every failure and exception; no outcome-dependent retries or replacements.',
  unknownUsagePolicy: 'Never zero; preserve null and known/unknown coverage.', causalClaim: false, benefitClaim: 'not-claimed' }
assertSimplificationDesign(design)
const snapshot = join(root, 'source')
for (const file of Object.keys(sourceHashes)) {
  const destination = resolve(snapshot, 'experiments', file)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(resolve('experiments', file), destination)
}
await copyFile(resolve('docs/SIMPLIFICATION_STUDY_BRIEF.md'), join(snapshot, 'SIMPLIFICATION_STUDY_BRIEF.md'))
await writeFile(join(root, 'design.json'), JSON.stringify(design, null, 2) + '\n', { flag: 'wx' })
const options = { ...conditions, seed: seeds[0], repeats: n, directory: join(root, 'runs'), models: [design.model],
  modes, purpose: 'comparison', profile: 'desktop-simplification-validation',
  sourceProfile: 'desktop', studyDesign: join(root, 'design.json') }
await writeFile(join(root, 'comparison-config.json'), JSON.stringify({ output: join(root, 'desktop-comparison'),
  bridgePath: resolve('experiments/shifting-evidence-profile-run.ts'), carrierDeadlineMs: (n * modes.length * 11 + 10) * 60_000,
  options }, null, 2) + '\n', { flag: 'wx' })
console.log(JSON.stringify({ registered: true, root, plannedRuns: n * modes.length, seeds, sourceFiles: Object.keys(sourceHashes).length,
  power: power.nonInferiority.power, referencePassed: references.passed,
  briefHash: createHash('sha256').update(await readFile(resolve('docs/SIMPLIFICATION_STUDY_BRIEF.md'))).digest('hex'), causalClaim: false }))
