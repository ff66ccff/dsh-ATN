/** Offline analysis only. Never imports the runner/provider or calls a model. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const workspace = path.resolve(import.meta.dirname, '..')
const root = path.resolve(workspace, process.argv[2] ?? '.artifacts/experiments/review-validation-20261004-23f0a11b')
const output = path.resolve(workspace, process.argv[3] ?? 'experiments/results/review-validation-20261004.json')
const relative = file => path.relative(workspace, file).replaceAll('\\', '/')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const files = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]) : []
const jsonl = file => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const count = (table, key) => { table[key] = (table[key] ?? 0) + 1 }
const sorted = values => [...values].sort()
const sameSet = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
const messageText = message => (message?.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n')
const parsedText = message => { try { return JSON.parse(messageText(message)) } catch { return null } }

function sourceIntegrity(manifest) {
  const snapshot = path.join(root, 'source-snapshot')
  const inventoryFile = path.join(snapshot, 'verified-hashes.json')
  const inventory = fs.existsSync(inventoryFile) ? new Map(json(inventoryFile).map(item => [item.file, item.sha256])) : new Map()
  const checks = Object.entries(manifest.diskSourceHashesAtModuleLoad ?? {}).map(([file, expected]) => {
    const current = path.resolve(workspace, 'experiments', file)
    const copied = path.resolve(snapshot, 'experiments', file)
    const currentSha256 = fs.existsSync(current) ? hash(current) : null
    const snapshotSha256 = fs.existsSync(copied) ? hash(copied) : null
    return { file, expectedSha256: expected, currentSha256, snapshotSha256,
      matchesCurrent: currentSha256 === expected, matchesSnapshot: snapshotSha256 === expected,
      matchesSnapshotInventory: inventory.get(file) === expected }
  })
  return { filesChecked: checks.length, valid: checks.length > 0 && checks.every(item => item.matchesCurrent && item.matchesSnapshot && item.matchesSnapshotInventory), checks }
}

function summarize(reportPath) {
  const directory = path.dirname(reportPath)
  const report = json(reportPath)
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = json(manifestPath)
  const events = jsonl(path.join(directory, 'events.jsonl'))
  const storagePath = path.join(directory, 'storage/atn_networks.json')
  const networks = fs.existsSync(storagePath) ? Object.values(json(storagePath).tables?.networks ?? {}) : []
  const network = networks.find(item => item.entrySessionId === `pilot-${report.runId}`) ?? networks[0]
  const nodes = Object.values(network?.nodes ?? {})
  const tasks = Object.values(network?.tasks ?? {})
  const nodeForSession = new Map(nodes.map(node => [node.sessionId, node]))
  const callsByTool = {}, errorsByTool = {}, errorMessages = {}, finishReasons = {}, reads = {}
  const claims = [], rewireCalls = [], submissionCalls = [], maxTokenFinishSteps = [], feedbackSessions = new Set()
  let feedbackMessages = 0, telemetryMessages = 0, repeatedMinePhase1AfterFirst = 0, successfulMinePhase1 = 0
  let orphanTaskExposures = 0, orphanTaskExposureSessions = new Set(), malformedToolArguments = 0
  let sessionFiles = 0
  for (const sessionPath of files(path.join(directory, 'sessions')).filter(file => file.endsWith('.jsonl'))) {
    sessionFiles++
    const sessionEvents = jsonl(sessionPath)
    const sessionId = sessionEvents.find(event => event.type === 'session')?.id ?? relative(sessionPath)
    const nodeId = nodeForSession.get(sessionId)?.id ?? null
    const pending = new Map()
    let minePhase1Seen = 0
    for (const event of sessionEvents) {
      if (event.type === 'tool/call') {
        let args = null
        try { args = typeof event.data.arguments === 'string' ? JSON.parse(event.data.arguments) : event.data.arguments } catch { malformedToolArguments++ }
        const call = { nodeId, name: event.data.name, args, turn: event.data.turn, step: event.data.step, error: null, finished: false }
        pending.set(event.data.callId, call)
        count(callsByTool, call.name)
        if (call.name === 'read_document') count(reads, args?.id ?? '[invalid]')
        if (call.name === 'atn_status' && args?.claimTaskId) claims.push(call)
        if (call.name === 'atn_rewire') rewireCalls.push(call)
        if (call.name === 'submit_answer') submissionCalls.push(call)
      } else if (event.type === 'tool/result') {
        const message = event.data.message
        const call = pending.get(message.toolCallId)
        if (call) { call.finished = true; call.error = Boolean(message.isError) }
        if (message.isError) {
          const tool = call?.name ?? '[unknown]'
          const text = messageText(message).replace(/\s+/g, ' ').slice(0, 1500)
          count(errorsByTool, tool)
          const key = `${tool}\u0000${text}`
          if (!errorMessages[key]) errorMessages[key] = { tool, message: text, count: 0 }
          errorMessages[key].count++
        } else {
          const result = parsedText(message)
          if (call?.name === 'atn_status') {
            if (call.args?.claimTaskId) call.claimedTaskId = result?.claimedTask?.id ?? null
            if (Array.isArray(result?.orphanTasks) && result.orphanTasks.length > 0) {
              orphanTaskExposures++
              orphanTaskExposureSessions.add(sessionId)
            }
          }
          if (call?.name === 'read_document' && call.args?.id === 'mine' && result?.phase === 1) {
            successfulMinePhase1++
            if (minePhase1Seen++) repeatedMinePhase1AfterFirst++
          }
        }
      } else if (event.type === 'user/message') {
        const text = messageText(event.data)
        if (event.data.source?.kind === 'atn' && event.data.source?.form === 'snapshot' && text.includes('[ATN local changes]')) {
          feedbackMessages++
          if (text.includes('Runtime telemetry:')) { telemetryMessages++; feedbackSessions.add(sessionId) }
        }
      } else if (event.type === 'assistant/message') {
        const finish = event.data.stream?.findLast(item => item.type === 'chunk' && item.chunk.type === 'finish')?.chunk
        if (finish) {
          count(finishReasons, finish.reason.kind)
          if (finish.reason.kind === 'max-tokens') maxTokenFinishSteps.push({ nodeId, turn: event.data.turn, step: event.data.step, at: event.time })
        }
      }
    }
  }
  const history = network?.rewireHistory ?? []
  const rewires = history.map(row => ({ nodeId: row.nodeId, id: row.id, previousPeers: row.previousPeers, nextPeers: row.nextPeers,
    changedPeerSet: !sameSet(row.previousPeers, row.nextPeers),
    addedEdges: row.nextPeers.filter(id => !row.previousPeers.includes(id)).length,
    removedEdges: row.previousPeers.filter(id => !row.nextPeers.includes(id)).length,
    observed: Boolean(row.observations), beforeObservedAt: row.observations?.before?.observedAt ?? null,
    afterObservedAt: row.observations?.after?.observedAt ?? null,
    afterContainsSettledTasks: row.observations?.after?.peers?.some(peer => peer.completed + peer.failed + peer.unreachable > 0) ?? false,
    causalClaim: false }))
  const nodeBudgets = nodes.map(node => ({ nodeId: node.id, entry: node.isEntry, lifecycle: node.lifecycle,
    stepsUsed: node.stepsUsed ?? null, stepBudget: network.limits.stepBudget, note: node.note ?? null,
    retiredForBudget: node.lifecycle === 'retired' && node.note === 'node step budget exhausted' }))
  const integrity = sourceIntegrity(manifest)
  const identityValid = manifest.runId === report.runId && manifest.mode === report.mode && manifest.task === report.task && manifest.model.id === report.model
  return {
    report: relative(reportPath), reportSha256: hash(reportPath), manifest: relative(manifestPath), manifestSha256: hash(manifestPath),
    runId: report.runId, model: report.model, modelName: manifest.model.name, catalogFree: manifest.model.catalogFree,
    referenceRates: manifest.model.referenceCostPerMillion, provider: manifest.provider, mode: report.mode, task: report.task,
    taskSha256: manifest.taskSha256, bounds: manifest.limits, topologyConditions: manifest.topologyConditions,
    sourceIntegrity: integrity, manifestIdentityMatchesReport: identityValid,
    evaluation: report.evaluation, stopReason: report.stopReason, elapsedMs: report.elapsedMs,
    issuedModelCalls: report.issuedModelCalls, observedModelCalls: report.metrics?.totals.attempts ?? null,
    tokens: report.metrics?.totals.tokens ?? null, referenceCost: report.metrics?.totals.cost ?? null,
    requestFailures: report.requestFailures, submissionMethod: report.submissionMethod,
    submissionAttempts: submissionCalls.map(({ args, name, ...call }) => call),
    manipulation: report.manipulation, protocol: report.protocol, cleanup: report.cleanup,
    telemetryCoverage: report.metrics?.coverage ?? null,
    tools: { callsByTool, errorsByTool, errors: Object.values(errorMessages), malformedToolArguments,
      totalsMatchReport: Object.values(callsByTool).reduce((a,b) => a+b, 0) === report.metrics?.totals.toolsStarted &&
        Object.values(errorsByTool).reduce((a,b) => a+b, 0) === report.metrics?.totals.toolErrors },
    rewiring: { attempts: rewireCalls.length, successfulToolResults: rewireCalls.filter(call => call.finished && call.error === false).length,
      committed: rewires.length, changedPeerSets: rewires.filter(row => row.changedPeerSet).length,
      addedEdges: rewires.reduce((sum, row) => sum + row.addedEdges, 0), removedEdges: rewires.reduce((sum, row) => sum + row.removedEdges, 0),
      rows: rewires, commitsMatchProtocol: rewires.length === report.protocol?.explicitRewires?.length },
    orphanClaims: { attempted: claims.length, successfulToolResults: claims.filter(call => call.finished && call.error === false).length,
      confirmedNewTaskResults: claims.filter(call => call.claimedTaskId).length,
      attempts: claims.map(({ name, args, ...call }) => ({ ...call, sourceTaskId: args.claimTaskId })),
      orphanTaskExposures, exposedSessions: orphanTaskExposureSessions.size,
      retryTasks: tasks.filter(task => task.retryOf != null).map(task => ({ id: task.id, retryOf: task.retryOf,
        holderId: task.holderId, requesterId: task.requesterId, status: task.status })) },
    nodeBudgets: { totalRuntimeSteps: nodeBudgets.reduce((sum, node) => sum + (node.stepsUsed ?? 0), 0),
      retiredForBudget: nodeBudgets.filter(node => node.retiredForBudget).length,
      atStepLimit: nodeBudgets.filter(node => node.stepsUsed !== null && node.stepsUsed >= node.stepBudget).length,
      nodes: nodeBudgets },
    feedbackDelivery: { normalUserMessageSnapshots: feedbackMessages, withRuntimeTelemetry: telemetryMessages,
      sessionsWithRuntimeTelemetry: feedbackSessions.size, sessionFiles },
    documentReads: { callsById: reads, mineCalls: reads.mine ?? 0, successfulMinePhase1, repeatedMinePhase1AfterFirst,
      repeatsMeaning: 'Additional successful phase-1 mine reads after the first per session; not all mine calls are idle polling.' },
    modelFinishReasons: finishReasons, maxTokenFinishes: finishReasons['max-tokens'] ?? 0, maxTokenFinishSteps,
    telemetryEvents: events.length,
  }
}

const reports = files(root).filter(file => path.basename(file) === 'report.json').sort()
const runs = reports.map(summarize)
const manifests = files(root).filter(file => path.basename(file) === 'manifest.json' && !file.includes(`${path.sep}source-snapshot${path.sep}`))
const pairs = []
for (const key of new Set(runs.map(run => `${run.model}\u0000${run.task}\u0000${JSON.stringify(run.bounds)}`))) {
  const members = runs.filter(run => `${run.model}\u0000${run.task}\u0000${JSON.stringify(run.bounds)}` === key)
  pairs.push({ model: members[0].model, task: members[0].task, bounds: members[0].bounds,
    modes: members.map(run => run.mode), completePair: members.some(run => run.mode === 'atn-adaptive') && members.some(run => run.mode === 'atn-no-rewire'),
    sameTaskHash: new Set(members.map(run => run.taskSha256)).size === 1,
    sameTopologyConditions: new Set(members.map(run => JSON.stringify(run.topologyConditions))).size === 1,
    sameSourceHashes: new Set(members.map(run => JSON.stringify(run.sourceIntegrity.checks.map(row => [row.file, row.expectedSha256])))).size === 1 })
}
const cohorts = [...new Set(runs.map(run => JSON.stringify(run.bounds)))].map(encodedBounds => {
  const members = runs.filter(run => JSON.stringify(run.bounds) === encodedBounds)
  return { bounds: JSON.parse(encodedBounds), models: [...new Set(members.map(run => run.model))],
    reports: members.map(run => run.report), runs: members.length, passed: members.filter(run => run.evaluation.passed).length,
    manipulationValid: members.filter(run => run.manipulation?.valid).length,
    issuedModelCalls: members.reduce((sum, run) => sum + run.issuedModelCalls, 0),
    knownTotalTokens: members.reduce((sum, run) => sum + (run.tokens?.totalTokens.known ?? 0), 0),
    callsWithUnknownTotalTokens: members.reduce((sum, run) => sum + (run.tokens?.totalTokens.unknownCalls ?? 0), 0),
    changedPeerSets: members.reduce((sum, run) => sum + run.rewiring.changedPeerSets, 0),
    claimsAttempted: members.reduce((sum, run) => sum + run.orphanClaims.attempted, 0),
    claimsConfirmed: members.reduce((sum, run) => sum + run.orphanClaims.confirmedNewTaskResults, 0),
    retiredForBudget: members.reduce((sum, run) => sum + run.nodeBudgets.retiredForBudget, 0) }
})
const result = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), root: relative(root),
  method: 'Offline analysis of every finalized report; no model calls, retry selection, or failure exclusion.',
  totalsMeaning: 'Accounting across all finalized runs, including separately bounded supplemental runs. Compare outcomes within bounds cohorts and pairs; do not interpret the combined totals as a shared-budget success rate.',
  costMeaning: 'Live-catalog reference estimate, not actual subscription billing. Incomplete usage is unknown, not zero.',
  causalClaim: false, pendingReports: manifests.filter(file => !fs.existsSync(path.join(path.dirname(file), 'report.json'))).map(relative),
  totals: { runs: runs.length, passed: runs.filter(run => run.evaluation.passed).length,
    manipulationValid: runs.filter(run => run.manipulation?.valid).length,
    issuedModelCalls: runs.reduce((sum, run) => sum + run.issuedModelCalls, 0),
    knownTotalTokens: runs.reduce((sum, run) => sum + (run.tokens?.totalTokens.known ?? 0), 0),
    callsWithUnknownTotalTokens: runs.reduce((sum, run) => sum + (run.tokens?.totalTokens.unknownCalls ?? 0), 0),
    knownReferenceCost: runs.reduce((sum, run) => sum + (run.referenceCost?.knownAmount ?? 0), 0),
    callsWithUnknownReferenceCost: runs.reduce((sum, run) => sum + (run.referenceCost?.unknownCalls ?? 0), 0),
    changedPeerSets: runs.reduce((sum, run) => sum + run.rewiring.changedPeerSets, 0),
    claimsAttempted: runs.reduce((sum, run) => sum + run.orphanClaims.attempted, 0),
    claimsConfirmed: runs.reduce((sum, run) => sum + run.orphanClaims.confirmedNewTaskResults, 0),
    retiredForBudget: runs.reduce((sum, run) => sum + run.nodeBudgets.retiredForBudget, 0),
    allSourceHashesVerified: runs.every(run => run.sourceIntegrity.valid && run.manifestIdentityMatchesReport),
    allToolCountsMatch: runs.every(run => run.tools.totalsMatchReport),
    allRewireCountsMatch: runs.every(run => run.rewiring.commitsMatchProtocol),
    allCleanupReleased: runs.every(run => run.cleanup === 'released'),
  }, cohorts, pairs, runs,
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ output: relative(output), totals: result.totals, pendingReports: result.pendingReports }))
if (!result.totals.allSourceHashesVerified || !result.totals.allToolCountsMatch || !result.totals.allRewireCountsMatch) process.exitCode = 1
