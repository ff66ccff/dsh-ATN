/** Final admission and same-topology costs; no provider installation or inference. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, relative } from 'node:path'
import { parseArgs, isDeepStrictEqual } from 'node:util'
import { shiftingSourceHashes } from '../experiments/shifting-evidence-run.ts'
import { assertTopologyComparisonPreflight, summarizeAdaptiveProbe, SHIFTING_ARMS } from '../experiments/shifting-evidence-protocol.ts'
import { referenceCostRatios, bindingReferenceGate } from '../experiments/topology-binding-audit.ts'
const { values } = parseArgs({ options: { probe: { type: 'string' }, audit: { type: 'string' }, reference: { type: 'string' },
  out: { type: 'string', default: 'experiments/results/four-arm-admission-and-cost-20261006.json' } } })
if (!values.probe || !values.audit || !values.reference) throw new Error('--probe, --audit and --reference are required')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const portable = path => relative(process.cwd(), resolve(path)).replaceAll('\\', '/')
const provenance = async path => ({ path: portable(path), sha256: createHash('sha256').update(await readFile(path)).digest('hex') })
const batch = await json(join(values.probe, 'batch.json')), plan = await json(join(values.probe, 'plan.json'))
const audit = await json(values.audit), reference = await json(values.reference), hashes = await shiftingSourceHashes()
if (!isDeepStrictEqual(hashes, plan.sourceHashes) || audit.auditPassed !== true || !audit.adaptiveProbe.complete ||
  !isDeepStrictEqual(batch.completed.map(row => row.runId), audit.adaptiveProbe.runs.map(row => row.runId))) throw new Error('Missing complete matching current-source raw audit')
const summary = summarizeAdaptiveProbe(batch.completed), seeds = reference.runs.map(row => row.conditions.seed)
const bindingConfirmed = reference.runs.length >= 5 && isDeepStrictEqual(reference.sourceHashes, hashes) &&
  isDeepStrictEqual([...seeds].sort((a, b) => a - b), batch.completed.map(row => row.seed).sort((a, b) => a - b)) &&
  reference.runs.every(pair => bindingReferenceGate(pair, { conditions: { ...plan.conditions, seed: pair.conditions.seed }, sourceHashes: hashes }))
let admission = { passed: false, error: null }
try {
  assertTopologyComparisonPreflight(batch.completed, { model: plan.selectedModels[0].id, conditions: plan.conditions, sourceHashes: hashes }, seeds)
  admission.passed = true
} catch (error) { admission.error = error.message }
const sum = (rows, value) => rows.reduce((total, row) => total + value(row), 0)
const referenceTotals = topology => ({ topologyMode: topology, issuedModelCalls: 0,
  totalInteractions: sum(reference.runs, pair => pair[topology].totalInteractions),
  totalTransferBytes: sum(reference.runs, pair => pair[topology].totalTransferBytes),
  entrySteps: sum(reference.runs, pair => pair[topology].entrySteps) })
const costs = { issuedModelCalls: sum(batch.completed, row => row.issuedModelCalls),
  atnTotalInteractions: sum(batch.completed, row => row.atnTotalInteractions), atnTotalTransferBytes: sum(batch.completed, row => row.atnTotalTransferBytes),
  entrySteps: batch.completed.every(row => row.entrySteps !== null) ? sum(batch.completed, row => row.entrySteps) : null }
const probeCosts = referenceCostRatios(costs, referenceTotals('adaptive'))
const runs = batch.completed.map(row => ({ runId: row.runId, seed: row.seed, stopReason: row.stopReason, cleanup: row.cleanup,
  phase1Submitted: row.phase1Submitted, phase1Correct: row.phase1Correct, phase2Submitted: row.phase2Submitted, phase2Correct: row.phase2Correct,
  issuedModelCalls: row.issuedModelCalls, entrySteps: row.entrySteps, communication: { messages: row.atnMessages,
    interactions: row.atnTotalInteractions, bytes: row.atnTotalTransferBytes }, costRelativeToReference: row.costRelativeToReference,
  requesterFeedback: row.protocol.requesterFeedback, rewires: row.protocol.rewireTelemetry, stepHeadroom: row.protocol.stepHeadroom,
  factFlowAudit: row.factFlowAudit, failures: row.failures, modelObservation: row.metrics.totals,
  coverage: row.metrics.coverage, report: portable(join(row.directory, 'report.json')) }))
const output = { version: 1, finalizedAt: new Date().toISOString(), issuedNewModelCalls: 0,
  sources: { probe: await provenance(join(values.probe, 'batch.json')), audit: await provenance(values.audit), reference: await provenance(values.reference) },
  sourceHashes: hashes, comparisonAdmission: admission, bindingConfirmed,
  gates: { constructiveBinding: bindingConfirmed, structuralProof: batch.completed.every(row => audit.adaptiveProbe.runs.find(run => run.runId === row.runId)?.rawAudit.checks.structuralProofVerified),
    probeCapability: { completion: summary.completion, statement: 'Completion is an interval report, never a small-sample admission gate.' },
    probeDiscovery: summary.discovery, probeHeadroom: summary.stepHeadroomPassed, positiveFactFlow: summary.factFlowAuditGatePassed,
    comparisonRepeats: { passed: false, observed: 0, requiredPerArm: 5 }, comparisonRejected: { passed: false, observed: null }, comparisonHeadroom: { passed: false, observed: null } },
  probe: { runs, costs: probeCosts, phase1SubmittedRate: sum(batch.completed, row => Number(row.phase1Submitted)) / batch.completed.length,
    phase2SubmittedRate: sum(batch.completed, row => Number(row.phase2Submitted)) / batch.completed.length,
    accepted: sum(batch.completed, row => row.protocol.requesterFeedback.accepted), rejected: sum(batch.completed, row => row.protocol.requesterFeedback.rejected),
    maxNodeStepRatio: Math.max(...batch.completed.map(row => row.protocol.stepHeadroom.maxNodeStepRatio)),
    unknownUsage: { totalTokens: sum(batch.completed, row => row.metrics.totals.tokens.totalTokens.unknownCalls),
      inputTokens: sum(batch.completed, row => row.metrics.totals.tokens.inputTokens.unknownCalls),
      cacheReadTokens: sum(batch.completed, row => row.metrics.totals.tokens.cacheReadTokens.unknownCalls),
      cacheWriteTokens: sum(batch.completed, row => row.metrics.totals.tokens.cacheWriteTokens.unknownCalls),
      referenceCost: sum(batch.completed, row => row.metrics.totals.cost.unknownCalls) } },
  referenceTotals: { adaptive: referenceTotals('adaptive'), fixed: referenceTotals('fixed') },
  comparisonArms: SHIFTING_ARMS.map(mode => ({ mode, repeats: 0, execution: 'not-executed', metrics: null, costMultiples: null,
    baselineTopology: mode === 'fixed' ? 'fixed' : 'adaptive', reason: admission.passed ? 'not-collected-by-this-script'
      : 'comparison-preflight-failed' })),
  mayInterpretTopology: false, causalClaim: false, benefitClaim: 'not-supported',
  interpretation: `Constructive binding ${bindingConfirmed ? 'holds' : 'is unconfirmed'}. The same-source adaptive probe is ${summary.correct}/${summary.repeats}. ${admission.passed ? 'Preflight passes, but this script has no comparison data.' : 'No comparison is admitted.'} Fixed structural failure is task design. Probe cost ratios include all failures and indicate coordination overhead only; comparison-arm costs remain unmeasured.` }
await mkdir(dirname(resolve(values.out)), { recursive: true })
await writeFile(resolve(values.out), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ out: portable(values.out), admission, bindingConfirmed, probeCosts,
  unknownUsage: output.probe.unknownUsage, accepted: output.probe.accepted, rejected: output.probe.rejected, maxNodeStepRatio: output.probe.maxNodeStepRatio,
  referenceTotals: output.referenceTotals }))
