/** Reconcile raw live sessions, durable submissions, proof fixtures and source identities. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, dirname, relative } from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { createShiftingEvidenceTask, evaluateCheckpoints, BINDING_SETUP_TASK } from '../experiments/shifting-evidence-task.ts'
import { proveTopologyBinding, verifyTopologyBindingProof } from '../experiments/topology-binding-proof.ts'
import { summarizeAdaptiveProbe, summarizeShiftingRuns } from '../experiments/shifting-evidence-protocol.ts'
import { auditFactFlow, bindingReferenceGate, referenceCostRatios } from '../experiments/topology-binding-audit.ts'

const { values } = parseArgs({ options: { probe: { type: 'string' }, comparison: { type: 'string' },
  'comparison-bootstrap': { type: 'string' },
  bootstrap: { type: 'string' }, out: { type: 'string', default: 'experiments/results/topology-binding-probe-20261006.json' } } })
if (!values.probe) throw new Error('--probe is required')
const hash = value => createHash('sha256').update(value).digest('hex')
const portable = file => relative(process.cwd(), resolve(file)).replaceAll('\\', '/')
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null } }
async function json(file) { return JSON.parse(await readFile(file, 'utf8')) }
async function source(file) { return { path: portable(file), sha256: hash(await readFile(file)) } }
async function walk(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(row =>
  row.isDirectory() ? walk(join(dir, row.name)) : [join(dir, row.name)]))).flat() }
const count = (rows, key) => rows.reduce((totals, row) => { const value = key(row); totals[value] = (totals[value] ?? 0) + 1; return totals }, {})
async function reconcile(original) {
  const directory = resolve(original.directory), report = await json(join(directory, 'report.json'))
  if (report.runId !== original.runId) throw new Error('Run identity differs from batch')
  const task = createShiftingEvidenceTask(report.conditions.agents, report.seed, report.conditions.chainLength, true)
  const stored = await json(join(directory, 'storage/atn_networks.json'))
  const network = Object.values(stored.tables.networks).find(row => row?.nodes)
  if (!network) throw new Error('Missing durable network')
  const nodes = Object.values(network.nodes), submissions = new Map(report.attempts.map(row => [row.phase, row.answer]))
  const evaluation = evaluateCheckpoints(task, submissions)
  const rawRewires = [], rawOwnerRefusals = [], toolSets = new Set(), routes = new Set(), permissions = new Set()
  const sessions = new Set(), denied = [], rawCalls = [], readViolations = []
  let invalidHeaders = 0
  const expectedTools = ['atn_board', 'atn_finish', 'atn_send', 'atn_spawn', 'atn_start', 'atn_status', 'read_evidence', 'submit_checkpoint']
  for (const file of (await walk(join(directory, 'sessions'))).filter(file => file.endsWith('session.v4.jsonl'))) {
    const events = (await readFile(file, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    const sessionId = events.find(event => event.type === 'session')?.id
    const slot = nodes.findIndex(node => node.sessionId === sessionId)
    if (slot < 0) throw new Error('Unknown live session')
    const calls = new Map()
    permissions.add(hash(JSON.stringify(events.filter(event => ['sandbox/mode', 'approval/policy', 'permission/preset'].includes(event.type))
      .map(event => ({ type: event.type, data: event.data })))))
    for (const event of events) {
      if (event.type === 'request/header') {
        sessions.add(sessionId)
        const header = event.data.header
        if (header.config.provider !== 'dsh-opencode-go' || header.config.model !== report.model ||
          !(header.config.maxTokens > 0 && header.config.maxTokens <= report.conditions.maxOutputTokens) ||
          !isDeepStrictEqual(header.tools.map(tool => tool.name).sort(), expectedTools)) invalidHeaders++
        toolSets.add(hash(JSON.stringify(header.tools.slice().sort((a, b) => a.name.localeCompare(b.name)))))
        routes.add(hash(JSON.stringify(header.config)))
      }
      if (event.type === 'tool/call') {
        const call = { name: event.data.name, args: parse(event.data.arguments), id: event.data.callId, sessionId }
        calls.set(call.id, call); rawCalls.push(call)
        if (call.name === 'atn_status' && call.args?.rewire !== undefined) rawRewires.push(call)
      }
      if (event.type !== 'tool/result') continue
      const message = event.data.message, call = calls.get(message.toolCallId)
      if (!call) continue
      call.isError = message.isError === true
      call.completed = true
      const texts = message.content.filter(block => block.type === 'text').map(block => block.text)
      const value = texts.map(parse).find(value => value && typeof value === 'object')
      if (call.isError) {
        const code = ['evidence-not-owned', 'metadata-only', 'invalid-fact-request', 'invalid-owner-result',
          'fact-requests-and-owner-results-only', 'extra-transport-fields', 'fixed-edge-required']
          .find(code => texts.some(text => text.includes(code))) ?? 'other-tool-error'
        denied.push({ tool: call.name, code })
        if (call.name === 'atn_send' && code === 'evidence-not-owned') rawOwnerRefusals.push({ sessionId, callId: call.id, code })
      }
      if (call.name === 'atn_status' && call.args?.rewire !== undefined) call.rewireId = value?.rewire?.rewireId ?? null
      if (call.name === 'read_evidence' && !call.isError) {
        const phase = task.phases[value.phase - 1]
        for (const fact of value.documents) {
          const current = phase.facts.find(row => row.id === fact.id), stale = phase.staleFacts.find(row => row.id === fact.id)
          if (!(current && phase.holders[current.key] === slot && isDeepStrictEqual(current, fact)) &&
            !(stale && phase.staleHolders[stale.key] === slot && isDeepStrictEqual(stale, fact))) readViolations.push({ slot, document: fact.id })
        }
      }
    }
  }
  const commits = network.rewireHistory ?? []
  const rawRewireCounts = { statusRewireCalls: rawRewires.length,
    successfulRewires: rawRewires.filter(call => commits.some(row => row.id === call.rewireId && !isDeepStrictEqual([...row.previousPeers].sort(), [...row.nextPeers].sort()))).length,
    unchangedRewires: rawRewires.filter(call => commits.some(row => row.id === call.rewireId && isDeepStrictEqual([...row.previousPeers].sort(), [...row.nextPeers].sort()))).length,
    blockedRewires: rawRewires.filter(call => call.isError).length,
    pendingRewires: rawRewires.filter(call => call.isError !== true && !commits.some(row => row.id === call.rewireId)).length }
  const differingSources = []
  for (const [file, expected] of Object.entries(report.sourceHashes)) if (hash(await readFile(resolve('experiments', file))) !== expected) differingSources.push(file)
  const recorded = report.protocol.rewireTelemetry
  const factFlowAudit = auditFactFlow(task, network, report.attempts)
  const ownerResultViolations = Object.values(network.mails).filter(mail => mail.kind === 'result').filter(mail => {
    const resultTask = network.tasks[mail.taskId]
    if (resultTask?.description === BINDING_SETUP_TASK) return resultTask.holderId !== mail.fromId || resultTask.requesterId !== mail.toId ||
      resultTask.result?.summary !== '{"ready":true}' || mail.body !== '{"ready":true}' || resultTask.result?.evidence.length !== 0
    const request = parse(resultTask?.description), fact = parse(resultTask?.result?.summary)
    const phase = task.phases[(request?.phase ?? 0) - 1], holder = nodes.findIndex(node => node.id === mail.fromId)
    if (!phase || !fact || holder < 0 || resultTask.holderId !== mail.fromId || resultTask.requesterId !== mail.toId || fact.key !== request.key) return true
    const local = [...phase.facts.filter(row => phase.holders[row.key] === holder),
      ...phase.staleFacts.filter(row => phase.staleHolders[row.key] === holder)]
    return !local.some(row => isDeepStrictEqual(row, fact))
  }).map(mail => mail.id)
  const checks = { runIdentity: true, sourceMatchesCurrent: differingSources.length === 0,
    checkpointEvaluationMatches: ['phase1Correct', 'phase2Correct', 'phase1Submitted', 'phase2Submitted', 'passed'].every(key => evaluation[key] === report[key]),
    checkpointCallsMatchRaw: isDeepStrictEqual(report.attempts.map(row => ({ phase: row.phase, answer: row.answer })),
      rawCalls.filter(call => call.name === 'submit_checkpoint' && call.completed && !call.isError).map(call => ({ phase: call.args.phase, answer: call.args.answer }))),
    positiveFactFlow: factFlowAudit.passed,
    factFlowMatchesReport: isDeepStrictEqual(factFlowAudit, report.factFlowAudit),
    constructiveBindingConfirmed: bindingReferenceGate(report.bindingReference, report),
    structuralProofVerified: verifyTopologyBindingProof(task, report.topologyProof),
    rewireCountsMatchRaw: Object.entries(rawRewireCounts).every(([key, value]) => recorded[key] === value),
    ownerRefusalsMatchRaw: report.topologyBinding.refusedResults === rawOwnerRefusals.length,
    localReadAcl: readViolations.length === 0, ownerResultsOnly: ownerResultViolations.length === 0,
    exactHeaders: invalidHeaders === 0, sameModelAndPermissions: routes.size === 1 && permissions.size === 1,
    sameToolSchemas: toolSets.size === 1, everyNodeHasActualHeader: sessions.size === report.conditions.agents,
    nodeStepCountsMatchStorage: report.protocol.stepUse.every(row => network.nodes[row.id]?.stepsUsed === row.stepsUsed) }
  return { ...report, factFlowAudit, directory: portable(directory), report: await source(join(directory, 'report.json')),
    rawAudit: { checks, passed: Object.values(checks).every(Boolean), differingSources, rawRewireCounts,
      ownerRefusals: rawOwnerRefusals, toolErrorsByCode: count(denied, row => row.code),
      toolCallsByName: count(rawCalls, row => row.name), nodeSteps: report.protocol.stepUse,
      durableRequesterRatings: count(Object.values(network.tasks).filter(row => row.localFeedback), row => row.localFeedback.status) } }
}
async function batch(path) {
  if (!path) return null
  const file = join(resolve(path), 'batch.json'), raw = await json(file)
  return { source: await source(file), planned: raw.planned, complete: raw.completed.length === raw.planned,
    runs: await Promise.all(raw.completed.map(reconcile)) }
}
const probe = await batch(values.probe), comparison = await batch(values.comparison)
const trim = summary => ({ ...summary, runs: undefined, ...(summary.probe ? { probe: { ...summary.probe, runs: undefined } } : {}) })
const compact = run => ({ runId: run.runId, mode: run.mode, purpose: run.purpose, model: run.model, seed: run.seed,
  execution: run.execution, startedAt: run.startedAt, completedAt: run.completedAt, directory: run.directory, report: run.report,
  conditions: run.conditions, sourceHashes: run.sourceHashes, providerProvenance: run.providerProvenance,
  phase1Submitted: run.phase1Submitted, phase1Correct: run.phase1Correct, phase2Submitted: run.phase2Submitted,
  phase2Correct: run.phase2Correct, passed: run.passed, stopReason: run.stopReason, cleanup: run.cleanup,
  issuedModelCalls: run.issuedModelCalls, topologyProof: run.topologyProof, topologyBinding: run.topologyBinding,
  factFlowAudit: run.factFlowAudit, comparisonEligible: run.comparisonEligible, entrySteps: run.entrySteps,
  atnTotalInteractions: run.atnTotalInteractions, atnTotalTransferBytes: run.atnTotalTransferBytes, atnMessages: run.atnMessages,
  costRelativeToReference: run.costRelativeToReference, budget: run.budget, failures: run.failures,
  requesterFeedback: run.protocol.requesterFeedback, rewireTelemetry: run.protocol.rewireTelemetry,
  stepHeadroom: run.protocol.stepHeadroom, rawAudit: run.rawAudit })
const summary = summarizeAdaptiveProbe(probe.runs)
const comparisonSummary = summarizeShiftingRuns(comparison?.runs ?? [], probe.runs)
async function bootstrapAudit(path) { return path ? {
  source: await source(join(resolve(path), 'profile-bootstrap.json')),
  integrity: await json(join(resolve(path), 'user-profile-integrity-final.json')),
  completion: await json(join(resolve(path), 'observer-completion.json')),
  installedIdentity: await json(join(resolve(path), 'installed-llm-marker.json')),
} : null }
const bootstrap = await bootstrapAudit(values.bootstrap), comparisonBootstrap = await bootstrapAudit(values['comparison-bootstrap'])
const unmet = []
if (!summary.capabilityGatePassed) unmet.push('adaptive probe below 4/5 two-phase correctness or model ineligible')
if (!summary.discovery.passed) unmet.push(`rewire discoverability: ${summary.discovery.status}`)
if (!summary.stepHeadroomPassed) unmet.push('adaptive probe exceeds 80% node-step headroom')
if (!probe.runs.every(run => run.topologyProof?.conclusion === 'unreachable' && run.rawAudit.checks.structuralProofVerified)) unmet.push('structural proof missing or invalid')
if (!summary.bindingReferenceGatePassed) unmet.push('constructive adaptive/fixed binding confirmation missing or invalid')
if (!summary.factFlowAuditGatePassed || (comparison?.runs ?? []).some(run => !run.factFlowAudit.passed)) unmet.push('positive fact-flow audit missing or failed')
if (!comparisonSummary.feedbackVarianceGatePassed) unmet.push('comparison data has no rejected reviews')
if (!comparisonSummary.everyArmRepeated) unmet.push('four comparison arms have not each completed >=5 runs')
if (!comparisonSummary.stepHeadroom.withinLimit) unmet.push('comparison step headroom not verified for all arms')
const auditPassed = probe.runs.every(run => run.rawAudit.passed) && (comparison?.runs ?? []).every(run => run.rawAudit.passed)
const armCosts = ['adaptive', 'fixed', 'no-feedback', 'no-board'].map(mode => {
  const rows = (comparison?.runs ?? []).filter(run => run.mode === mode)
  if (!rows.length) return { mode, repeats: 0, cost: null }
  const actual = { issuedModelCalls: rows.reduce((sum, row) => sum + row.issuedModelCalls, 0),
    atnTotalInteractions: rows.reduce((sum, row) => sum + row.atnTotalInteractions, 0),
    atnTotalTransferBytes: rows.reduce((sum, row) => sum + row.atnTotalTransferBytes, 0),
    entrySteps: rows.every(row => row.entrySteps !== null) ? rows.reduce((sum, row) => sum + row.entrySteps, 0) : null }
  const reference = { topologyMode: mode === 'fixed' ? 'fixed' : 'adaptive', issuedModelCalls: 0,
    totalInteractions: rows.reduce((sum, row) => sum + row.reference.totalInteractions, 0),
    totalTransferBytes: rows.reduce((sum, row) => sum + row.reference.totalTransferBytes, 0),
    entrySteps: rows.reduce((sum, row) => sum + row.reference.entrySteps, 0) }
  const add = field => rows.reduce((sum, row) => sum + row.protocol.requesterFeedback[field], 0)
  return { mode, repeats: rows.length, cost: referenceCostRatios(actual, reference),
    accepted: add('accepted'), rejected: add('rejected'),
    rewireAttempts: rows.reduce((sum, row) => sum + row.protocol.rewireTelemetry.statusRewireCalls, 0),
    rewireSuccessful: rows.reduce((sum, row) => sum + row.protocol.rewireTelemetry.successfulRewires, 0),
    rewireBlocked: rows.reduce((sum, row) => sum + row.protocol.rewireTelemetry.blockedRewires, 0),
    maxNodeStepRatio: Math.max(...rows.map(row => row.protocol.stepHeadroom.maxNodeStepRatio)),
    unknownUsageCalls: rows.reduce((sum, row) => sum + (row.metrics?.totals?.tokens?.totalTokens?.unknownCalls ?? 0), 0) }
})
const output = { version: 2, reconciledAt: new Date().toISOString(), auditPassed, bootstrap, comparisonBootstrap, armCosts,
  adaptiveProbe: { source: probe.source, planned: probe.planned, complete: probe.complete, summary: trim(summary), runs: probe.runs.map(compact) },
  comparison: comparison ? { source: comparison.source, complete: comparison.complete, summary: trim(comparisonSummary), runs: comparison.runs.map(compact) } : null,
  gates: trim(comparisonSummary), unmet, mayInterpretTopology: auditPassed && comparisonSummary.mayInterpretTopology,
  causalClaim: false, benefitClaim: comparisonSummary.benefitClaim,
  interpretation: 'Fixed structural impossibility is task design. Adaptive benefit requires consistent superiority over both non-fixed controls after all comparison gates pass. Cost ratios describe coordination overhead only; no causal estimate.' }
await mkdir(dirname(resolve(values.out)), { recursive: true })
await writeFile(resolve(values.out), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ output: portable(values.out), auditPassed, adaptive: { repeats: summary.repeats,
  correct: summary.correct, rewires: summary.rewireCounts, discovery: summary.discovery, stepHeadroomPassed: summary.stepHeadroomPassed },
  unmet, mayInterpretTopology: output.mayInterpretTopology }))
