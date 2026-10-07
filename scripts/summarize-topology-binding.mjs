/** Reconcile raw live sessions, durable submissions, proof fixtures and source identities. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, dirname, relative } from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { createShiftingEvidenceTask, evaluateCheckpoints, BINDING_SETUP_TASK } from '../experiments/shifting-evidence-task.ts'
import { proveTopologyBinding, verifyTopologyBindingProof } from '../experiments/topology-binding-proof.ts'
import { summarizeAdaptiveProbe, summarizeShiftingRuns, SHIFTING_ARMS } from '../experiments/shifting-evidence-protocol.ts'
import { selectStaticWidePeers, STATIC_WIDE_POLICY } from '../experiments/static-wide-topology.ts'
import { auditFactFlow, bindingReferenceGate, referenceCostRatios } from '../experiments/topology-binding-audit.ts'
import { shiftingMechanisms } from '../experiments/simplification-arms.ts'
import { summarizeSimplificationRuns } from '../experiments/simplification-protocol.ts'

const { values } = parseArgs({ options: { probe: { type: 'string' }, comparison: { type: 'string' },
  'comparison-bootstrap': { type: 'string' },
  bootstrap: { type: 'string' }, 'study-design': { type: 'string' }, out: { type: 'string', default: 'experiments/results/topology-binding-probe-20261006.json' } } })
if (!values.probe && !values.comparison) throw new Error('--probe or --comparison is required')
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
  if (report.hostInitializationFailure) {
    if (!values['study-design'] || report.passed !== false || report.stopReason !== 'host-carrier-interrupted-initialization' ||
      report.issuedModelCalls !== null || report.atnTotalInteractions !== null || report.metrics !== null ||
      report.rawAudit?.passed !== false || report.interruptionEvidence?.rerun !== false) throw new Error('Malformed retained host exception')
    const events = await readFile(join(directory, 'events.jsonl'))
    if (hash(events) !== report.interruptionEvidence.eventsSha256) throw new Error('Retained interruption evidence changed')
    return { ...report, directory: portable(directory), report: await source(join(directory, 'report.json')) }
  }
  try { await readFile(join(directory, 'manifest.json')) } catch (error) {
    if (error.code !== 'ENOENT' || !values['study-design'] || report.passed !== false ||
      !report.stopReason?.startsWith('host-error:') || report.phase1Submitted || report.phase2Submitted ||
      report.phase1Correct || report.phase2Correct) throw error
    // Missing host-initialization evidence fails the audit, rather than deleting a sample.
    return { ...report, atnTotalInteractions: report.metrics ? report.atnTotalInteractions : null,
      atnTotalTransferBytes: report.metrics ? report.atnTotalTransferBytes : null,
      hostExceptionAuditIncomplete: true, directory: portable(directory), report: await source(join(directory, 'report.json')),
      rawAudit: { passed: false, checks: { manifestAvailable: false }, routeSignatures: [], toolSchemaSignatures: [], permissionSignatures: [],
        interpretation: 'Host initialization failed with no manifest. Retain the failed sample and measured cost; full raw identity audit is unavailable.' } }
  }
  const task = createShiftingEvidenceTask(report.conditions.agents, report.seed, report.conditions.chainLength, true)
  const stored = await json(join(directory, 'storage/atn_networks.json'))
  const network = Object.values(stored.tables.networks).find(row => row?.nodes)
  if (!network) throw new Error('Missing durable network')
  const nodes = Object.values(network.nodes), submissions = new Map(report.attempts.map(row => [row.phase, row.answer]))
  const ids = nodes.map(node => node.id), manifest = await json(join(directory, 'manifest.json'))
  const expectedInitialPeers = report.mode === 'fixed-wide' ? selectStaticWidePeers(ids)
    : Object.fromEntries(ids.map((id, i) => [id, [ids[(i - 1 + ids.length) % ids.length], ids[(i + 1) % ids.length]]]))
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
  const importedCalls = (await readFile(join(directory, 'imported-provider-calls.jsonl'), 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
  const startedCalls = importedCalls.filter(event => event.type === 'imported-call-start')
  const preparedCalls = importedCalls.filter(event => event.type === 'imported-call-prepared')
  const factFlowAudit = auditFactFlow(task, network, report.attempts, expectedInitialPeers[network.entryNodeId])
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
    modelCallCountsMatchRaw: startedCalls.length === report.issuedModelCalls && report.metrics.totals.attempts === report.issuedModelCalls &&
      new Set(startedCalls.map(event => event.callId)).size === startedCalls.length,
    installedProviderIdentity: startedCalls.every(event => event.agentLoopRequest === true && event.provider === 'dsh-opencode-go' && event.model === report.model) &&
      preparedCalls.every(event => event.agentLoopRequest === true && event.sourceAgentLoopRequest === true && event.maxTokens <= report.conditions.maxOutputTokens),
    initialPeersFromPublicRoster: manifest.protocolRevision < 8 || isDeepStrictEqual(expectedInitialPeers, report.initialPeerIds) &&
      isDeepStrictEqual(expectedInitialPeers, manifest.initialPeerIds),
    staticWideSelection: report.mode !== 'fixed-wide' || network.limits.maxCollaborationPeers === 4 && manifest.limits.degree === 4 &&
      isDeepStrictEqual(report.staticSelection, { ...STATIC_WIDE_POLICY, publicNodeIds: ids, peers: expectedInitialPeers }) &&
      isDeepStrictEqual(manifest.staticSelection, report.staticSelection) && commits.length === 0 &&
      verifyTopologyBindingProof(task, report.staticTopologyProof, { entrySlot: 0, maxCollaborationPeers: 4, initialPeers: [ids.length - 1, 1, 2, 3] }) &&
      isDeepStrictEqual(manifest.staticTopologyProof, report.staticTopologyProof),
    rewireCountsMatchRaw: Object.entries(rawRewireCounts).every(([key, value]) => recorded[key] === value),
    ownerRefusalsMatchRaw: report.topologyBinding.refusedResults === rawOwnerRefusals.length,
    localReadAcl: readViolations.length === 0, ownerResultsOnly: ownerResultViolations.length === 0,
    exactHeaders: invalidHeaders === 0, sameModelAndPermissions: routes.size === 1 && permissions.size === 1,
    sameToolSchemas: toolSets.size === 1, everyNodeHasActualHeader: sessions.size === report.conditions.agents,
    nodeStepCountsMatchStorage: report.protocol.stepUse.every(row => network.nodes[row.id]?.stepsUsed === row.stepsUsed),
    mechanismAblations: !report.mechanisms || isDeepStrictEqual(report.mechanisms, shiftingMechanisms(report.mode)) &&
      (report.mechanisms.requesterFeedback || Object.values(network.tasks).every(task => !task.localFeedback)) &&
      (report.mechanisms.sharedBoard || (network.whiteboard?.usage.reads ?? 0) + (network.whiteboard?.usage.writes ?? 0) === 0) }
  return { ...report, factFlowAudit, directory: portable(directory), report: await source(join(directory, 'report.json')),
    rawAudit: { checks, passed: Object.values(checks).every(Boolean), differingSources, rawRewireCounts,
      routeSignatures: [...routes], toolSchemaSignatures: [...toolSets], permissionSignatures: [...permissions],
      ownerRefusals: rawOwnerRefusals, toolErrorsByCode: count(denied, row => row.code),
      toolCallsByName: count(rawCalls, row => row.name), nodeSteps: report.protocol.stepUse,
      importedCallEvents: count(importedCalls, event => event.type),
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
  failureClass: run.failureClass, solvingFailure: run.solvingFailure, submissionDisciplineFailure: run.submissionDisciplineFailure,
  issuedModelCalls: run.issuedModelCalls, topologyProof: run.topologyProof, topologyBinding: run.topologyBinding,
  factFlowAudit: run.factFlowAudit, comparisonEligible: run.comparisonEligible, entrySteps: run.entrySteps,
  atnTotalInteractions: run.atnTotalInteractions, atnTotalTransferBytes: run.atnTotalTransferBytes, atnMessages: run.atnMessages,
  costRelativeToReference: run.costRelativeToReference, budget: run.budget, failures: run.failures,
  metricsTotals: run.metrics?.totals ?? null,
  metrics: run.metrics ? { totals: run.metrics.totals } : null, protocol: run.protocol,
  mechanisms: run.mechanisms, reference: run.reference,
  requesterFeedback: run.protocol?.requesterFeedback ?? null, rewireTelemetry: run.protocol?.rewireTelemetry ?? null,
  stepHeadroom: run.protocol?.stepHeadroom ?? null, hostInitializationFailure: run.hostInitializationFailure ?? false,
  hostExceptionAuditIncomplete: run.hostExceptionAuditIncomplete ?? false,
  interruptionEvidence: run.interruptionEvidence ?? null, rawAudit: run.rawAudit })
const summary = summarizeAdaptiveProbe(probe?.runs ?? [])
if (values['study-design']) {
  if (!comparison || values.probe) throw new Error('Simplification requires a comparison batch only')
  const design = await json(resolve(values['study-design']))
  const studySummary = summarizeSimplificationRuns(comparison.runs, design)
  const crossRunChecks = Object.fromEntries(['routeSignatures', 'toolSchemaSignatures', 'permissionSignatures'].map(key => [key,
    comparison.runs.length > 0 && new Set(comparison.runs.flatMap(run => run.rawAudit[key])).size === 1]))
  const comparisonBootstrap = values['comparison-bootstrap'] ? {
    integrity: await json(join(resolve(values['comparison-bootstrap']), 'user-profile-integrity-final.json')),
    completion: await json(join(resolve(values['comparison-bootstrap']), 'observer-completion.json')),
  } : null
  const bootstrapChecks = comparisonBootstrap ? {
    originalProfileUnchanged: comparisonBootstrap.integrity.unchanged === true,
    carrierCompletion: comparisonBootstrap.completion.completed === true,
  } : null
  const bootstrapPassed = bootstrapChecks ? Object.values(bootstrapChecks).every(Boolean) : null
  const rawAuditPassed = comparison.runs.every(run => run.rawAudit.passed) && Object.values(crossRunChecks).every(Boolean)
  const auditPassed = rawAuditPassed && bootstrapPassed !== false
  if (!auditPassed) {
    studySummary.readyForDecision = false
    for (const row of studySummary.comparisons) {
      row.criterionSupported = false; row.nonInferiorityPassed = false
    }
    for (const row of studySummary.recommendations) {
      row.conclusion = '不确定'; row.defaultAction = '保留'
      row.nonInferiorityPassed = false; row.jointNonInferiorityPassed = false
      row.substantiveCostReduction = false; row.jointSubstantiveCostReduction = false
      row.reason = !rawAuditPassed ? '原始身份、事实流或跨运行一致性审计未通过。'
        : '原桌面profile完整性或宿主载体完成审计未通过。'
    }
  }
  const output = { version: 1, reconciledAt: new Date().toISOString(), auditPassed, rawAuditPassed, crossRunChecks,
    comparisonBootstrap, bootstrapChecks, bootstrapPassed,
    comparison: { source: comparison.source, complete: comparison.complete, runs: comparison.runs.map(compact) },
    summary: studySummary, causalClaim: false, benefitClaim: 'not-claimed' }
  await mkdir(dirname(resolve(values.out)), { recursive: true })
  await writeFile(resolve(values.out), JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify({ output: portable(values.out), auditPassed, observedRuns: comparison.runs.length,
    bootstrapPassed,
    readyForDecision: studySummary.readyForDecision, recommendations: studySummary.recommendations.map(row => ({ mode: row.mode, conclusion: row.conclusion })) }))
  // Preserve all outcomes and failed integrity evidence while still failing the audit command.
  if (bootstrapPassed === false) throw new Error('Original Desktop profile integrity or carrier completion failed; retained results cannot support removal')
} else {
const comparisonSummary = summarizeShiftingRuns(comparison?.runs ?? [], probe?.runs ?? [])
const continuousComparisons = comparisonSummary.comparisons.map(pair => {
  const difference = pair.modelCallDifference
  const status = !difference.interval ? 'no-estimable-paired-efficiency-interval'
    : difference.interval.lower <= 0 && difference.interval.upper >= 0 ? 'not-distinguishable-at-this-sample-size'
      : 'nominal-conditional-interval-excludes-zero'
  return { a: pair.a, b: pair.b, successfulPairs: pair.successfulPairs, difference, status,
    lowerCallArm: status === 'nominal-conditional-interval-excludes-zero' ? difference.mean < 0 ? pair.a : pair.b : null,
    multiplicity: 'Nominal 95% Student t intervals, not multiplicity-adjusted; descriptive and conditional on jointly completed seeds, never a benefit or causal claim.' }
})
async function bootstrapAudit(path) { return path ? {
  source: await source(join(resolve(path), 'profile-bootstrap.json')),
  integrity: await json(join(resolve(path), 'user-profile-integrity-final.json')),
  completion: await json(join(resolve(path), 'observer-completion.json')),
  installedIdentity: await json(join(resolve(path), 'installed-llm-marker.json')),
} : null }
const bootstrap = await bootstrapAudit(values.bootstrap), comparisonBootstrap = await bootstrapAudit(values['comparison-bootstrap'])
const unmet = []
if (!comparisonSummary.structuralProofGatePassed) unmet.push('comparison structural proof missing or invalid')
if (!comparisonSummary.bindingReferenceGatePassed) unmet.push('comparison constructive binding confirmation missing or invalid')
if (!comparisonSummary.factFlowAuditGatePassed) unmet.push('comparison positive fact-flow audit missing or failed')
if (!comparisonSummary.everyArmRepeated) unmet.push('five comparison arms have not each completed >=5 runs')
if (!comparisonSummary.hasComparableSignal) unmet.push('no comparable signal: adaptive has zero two-phase completions')
if (!comparisonSummary.homogeneous) unmet.push('comparison source/model/budget conditions are not homogeneous')
if (!comparisonSummary.matchedSeeds) unmet.push('comparison seeds are not paired in all arms')
if (!comparisonSummary.uniqueRuns) unmet.push('comparison run identities are not unique')
if (!comparisonSummary.validOutcomes || !comparisonSummary.telemetryComplete) unmet.push('comparison outcomes or telemetry are malformed or missing')
const crossRunChecks = Object.fromEntries(['routeSignatures', 'toolSchemaSignatures', 'permissionSignatures'].map(key => [key,
  !comparison || comparison.runs.length > 0 && new Set(comparison.runs.flatMap(run => run.rawAudit[key])).size === 1]))
const auditPassed = (probe?.runs ?? []).every(run => run.rawAudit.passed) && (comparison?.runs ?? []).every(run => run.rawAudit.passed) && Object.values(crossRunChecks).every(Boolean)
const armCosts = comparisonSummary.arms.map(arm => ({ mode: arm.mode, repeats: arm.repeats,
  efficiency: arm.efficiency, failedConsumption: arm.failedConsumption, costMultiples: arm.costMultiples }))
const output = { version: 3, reconciledAt: new Date().toISOString(), auditPassed, crossRunChecks, continuousComparisons, bootstrap, comparisonBootstrap, armCosts,
  adaptiveProbe: probe ? { source: probe.source, planned: probe.planned, complete: probe.complete, summary: trim(summary), runs: probe.runs.map(compact) } : null,
  comparison: comparison ? { source: comparison.source, complete: comparison.complete, summary: trim(comparisonSummary), runs: comparison.runs.map(compact) } : null,
  gates: trim(comparisonSummary), unmet, mayInterpretTopology: auditPassed && comparisonSummary.mayInterpretTopology,
  causalClaim: false, benefitClaim: comparisonSummary.benefitClaim,
  interpretation: 'Fixed and fixed-wide failure under the chosen static policy is task design. No small-sample capability gate. Adaptive benefit requires consistent advantages beyond intervals and paired tests over fixed-wide, no-feedback and no-board. Efficiency includes successes only; failure consumption is separate. All causal claims remain false.' }
await mkdir(dirname(resolve(values.out)), { recursive: true })
await writeFile(resolve(values.out), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ output: portable(values.out), auditPassed, adaptiveProbe: probe ? { repeats: summary.repeats,
  correct: summary.correct, rewires: summary.rewireCounts, discovery: summary.discovery, stepHeadroomPassed: summary.stepHeadroomPassed }
  : null, comparisonArms: comparisonSummary.arms.map(arm => ({ mode: arm.mode, repeats: arm.repeats, correct: arm.correct })),
  unmet, mayInterpretTopology: output.mayInterpretTopology }))
}
