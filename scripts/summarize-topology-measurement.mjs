/** Offline analysis only. Never imports the runner/provider or calls a model. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const workspace = path.resolve(import.meta.dirname, '..')
const root = path.resolve(workspace, process.argv[2] ?? '.artifacts/experiments/topology-measurement-20261005')
const output = path.resolve(workspace, process.argv[3] ?? 'experiments/results/topology-measurement-20261005.json')
const relative = file => path.relative(workspace, file).replaceAll('\\', '/')
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const files = directory => fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]) : []
const jsonl = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
const count = (table, key) => { table[key] = (table[key] ?? 0) + 1 }
const sorted = values => [...values].sort()
const sameSet = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right))
const messageText = message => (message?.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n')
const parsedText = message => { try { return JSON.parse(messageText(message)) } catch { return null } }
const sum = (values, select) => values.reduce((total, value) => total + (select(value) ?? 0), 0)
const readOptional = file => fs.existsSync(file) ? json(file) : null
const evidenceKind = id => /^(initial|correction)-\d+$/.test(id ?? '') ? id.split('-')[0] : null
// Identifiable ledger row ids are a conservative, reproducible transport signal.
// A marker is not itself a full row, and absence does not prove no rows were paraphrased.
const rowMarkers = value => [...new Set((JSON.stringify(value) ?? '').match(/\bs\d+-(?:e\d+|late\d+)\b/g) ?? [])].sort()
const completeInitialShardMarkers = markers => [...new Set(markers.flatMap(marker => /^s(\d+)-e\d+$/.exec(marker)?.[1] ?? []))]
  .filter(slot => Array.from({ length: 12 }, (_, index) => `s${slot}-e${index}`).every(marker => markers.includes(marker)))
  .map(Number)
function canonicalTurnError(error) {
  // Never copy free-form adapter error text, headers, URLs or unknown codes.
  // These canonical messages cover the observed throw path absent from requestFailures.
  const known = { TIMEOUT: 'provider timeout', TRANSPORT: 'provider transport failure',
    AUTHENTICATION: 'provider authentication failure', AUTHORIZATION: 'provider authorization failure',
    RATE_LIMIT: 'provider rate limit', ABORTED: 'model call aborted', CANCELLED: 'model call cancelled' }
  const code = Object.hasOwn(known, error?.code) ? error.code : 'OTHER'
  const exactSafeMessages = { TIMEOUT: ['opencode-go stream idle timeout', 'Request timed out.'],
    TRANSPORT: ['terminated', 'Connection error.'] }
  const message = exactSafeMessages[code]?.includes(error.message) ? error.message
    : known[code] ?? 'unclassified turn error; raw message omitted'
  return { code, message }
}
const entryObjects = value => {
  if (!value || typeof value !== 'object') return 0
  const own = typeof value.id === 'string' && /^s\d+-(?:e\d+|late\d+)$/.test(value.id)
    && ['A', 'B', 'C', 'D'].includes(value.account) && typeof value.amount === 'number' ? 1 : 0
  return own + Object.values(value).reduce((total, item) => total + entryObjects(item), 0)
}

function calibrationEligibility(report) {
  const tokens = report.metrics?.totals?.tokens?.totalTokens
  const reasons = []
  if (report.calibration !== true) reasons.push('not-explicit-calibration')
  if (report.limits?.observedTokenLimit !== null) reasons.push('token-limit-not-unlimited')
  if (report.evaluation?.passed !== true) reasons.push('oracle-failed')
  if (!['submitted', 'final-text'].includes(report.stopReason)) reasons.push('not-successful-completion')
  if ((report.maxTokenTruncations ?? 0) !== 0) reasons.push('output-truncated')
  if (!tokens || tokens.unknownCalls !== 0) reasons.push('incomplete-token-usage')
  if (!Number.isSafeInteger(tokens?.known) || tokens.known <= 0) reasons.push('invalid-known-token-usage')
  return { eligibleSample: reasons.length === 0, reasons,
    meaning: 'Mirrors calibration.ts sample checks; a matching eligible pair is still required. No failed sample is removed.' }
}

function sourceIntegrity(manifest) {
  const snapshot = path.join(root, 'source-snapshot')
  const inventoryFile = path.join(root, 'source-hashes.json')
  const inventory = new Map(Object.entries(readOptional(inventoryFile) ?? {}))
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
  const manifest = readOptional(manifestPath) ?? {}
  const events = jsonl(path.join(directory, 'events.jsonl'))
  const storagePath = path.join(directory, 'storage/atn_networks.json')
  const networks = fs.existsSync(storagePath) ? Object.values(json(storagePath).tables?.networks ?? {}) : []
  const network = networks.find(item => item.entrySessionId === `pilot-${report.runId}`) ?? networks[0]
  const nodes = Object.values(network?.nodes ?? {})
  const tasks = Object.values(network?.tasks ?? {})
  const nodeForSession = new Map(nodes.map(node => [node.sessionId, node]))
  const callsByTool = {}, errorsByTool = {}, errorMessages = {}, finishReasons = {}, reads = {}, successfulReads = {}, readErrors = {}
  const claims = [], rewireCalls = [], submissionCalls = [], sends = [], networkFinishCalls = [], maxTokenFinishSteps = [], feedbackSessions = new Set()
  const feedbackRows = [], feedbackStepViolations = [], deliveredRowMarkers = [], deliveredMailIds = new Set()
  const turnErrorRows = []
  let truncationTurnEnds = 0
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
        if (call.name === 'atn_finish' && args?.scope === 'network') networkFinishCalls.push(call)
        if (call.name === 'atn_send') sends.push(call)
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
          if (call?.name === 'read_document') count(readErrors, call.args?.id ?? '[invalid]')
        } else {
          const result = parsedText(message)
          if (call?.name === 'atn_finish' && call.args?.scope === 'network') {
            call.accepted = result?.accepted ?? null
            call.refusalReason = result?.accepted === false ? result?.reason ?? null : null
          }
          if (call?.name === 'read_document') count(successfulReads, call.args?.id ?? '[invalid]')
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
          const section = event.data.source.sections?.find(section => section.name === 'atn/topology-snapshot')
          let snapshot = null
          try { snapshot = JSON.parse(section?.text ?? 'null') } catch {}
          const row = { nodeId, at: event.time, admittedStep: snapshot?.admittedStep ?? null,
            payloadBytes: Buffer.byteLength(text, 'utf8'), peers: snapshot?.peers ?? null,
            volatileStepText: /\bsteps=|\bremaining=/.test(text) }
          const previous = feedbackRows.findLast(row => row.nodeId === nodeId)
          if (previous?.admittedStep != null && row.admittedStep != null && row.admittedStep - previous.admittedStep < 3) {
            feedbackStepViolations.push({ nodeId, previousStep: previous.admittedStep, nextStep: row.admittedStep })
          }
          feedbackRows.push(row)
        }
        if (event.data.source?.kind === 'atn' && event.data.source.sections?.some(section => section.name === 'atn/mail')) {
          const mailId = /\bmail=([^\s]+)/.exec(text)?.[1]
          if (mailId) deliveredMailIds.add(mailId)
          const markers = rowMarkers(text)
          if (markers.length) deliveredRowMarkers.push({ nodeId, mailId: mailId ?? null, markerCount: markers.length, markers })
        }
      } else if (event.type === 'turn/end') {
        if (event.data.reason?.kind === 'max-tokens') truncationTurnEnds++
        if (event.data.reason?.kind === 'error') turnErrorRows.push({ nodeId, at: event.time, turn: event.data.turn,
          ...canonicalTurnError(event.data.reason.error) })
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
  const identityValid = manifest.runId === report.runId && manifest.mode === report.mode && manifest.task === report.task && manifest.model?.id === report.model
  const mailEvents = events.filter(event => event.kind === 'mail.state')
  const observedMailIds = new Set(mailEvents.map(event => `${event.network}:${event.mail}`))
  const retainedMails = Object.values(network?.mails ?? {})
  const retainedMailRows = retainedMails.map(mail => {
    const result = mail.kind === 'result' && mail.taskId ? network.tasks[mail.taskId]?.result : null
    const envelope = [mail.id ?? '', mail.fromId, mail.toId, mail.kind, mail.taskId ?? '', mail.proposalId ?? ''].join('\u0000')
    const bytes = Buffer.byteLength(envelope, 'utf8') + Buffer.byteLength(mail.body, 'utf8')
      + (result == null ? 0 : Buffer.byteLength(JSON.stringify(result), 'utf8'))
    const markers = rowMarkers({ body: mail.body, result })
    return { id: mail.id, kind: mail.kind, fromId: mail.fromId, toId: mail.toId, status: mail.status,
      bytes, rawRowMarkerCount: markers.length, markers, allInitialRowIdsForSlots: completeInitialShardMarkers(markers) }
  })
  const sendRows = sends.map(call => {
    const args = call.args ?? {}
    const markers = rowMarkers(args)
    let encodedBody = null
    try { encodedBody = JSON.parse(args.body ?? 'null') } catch {}
    return { nodeId: call.nodeId, turn: call.turn, step: call.step, to: args.to ?? null, kind: args.kind ?? null,
      finished: call.finished, error: call.error, rawRowMarkerCount: markers.length, markers,
      allInitialRowIdsForSlots: completeInitialShardMarkers(markers),
      structuredLedgerEntryObjects: entryObjects(args) + entryObjects(encodedBody) }
  })
  const modelEnds = events.filter(event => event.kind === 'model.end')
  const eventTokens = { known: sum(modelEnds, event => event.usage?.totalTokens),
    unknownCalls: modelEnds.filter(event => event.usage?.totalTokens == null).length }
  const retryTasks = tasks.filter(task => task.retryOf != null)
  const claimedResultTasks = claims.filter(call => call.claimedTaskId).map(call => network?.tasks[call.claimedTaskId]).filter(Boolean)
  const entryNode = nodes.find(node => node.isEntry)
  const turnErrorGroups = [...new Set(turnErrorRows.map(row => JSON.stringify([row.code, row.message])))].map(key => {
    const members = turnErrorRows.filter(row => JSON.stringify([row.code, row.message]) === key)
    const times = members.map(row => row.at).filter(Number.isFinite)
    return { code: members[0].code, message: members[0].message, count: members.length,
      affectedNodes: [...new Set(members.map(row => row.nodeId))].sort(),
      firstAt: times.length ? Math.min(...times) : null, lastAt: times.length ? Math.max(...times) : null }
  })
  return {
    report: relative(reportPath), reportSha256: hash(reportPath), manifest: relative(manifestPath),
    manifestSha256: fs.existsSync(manifestPath) ? hash(manifestPath) : null,
    runId: report.runId, model: report.model, modelName: manifest.model?.name, catalogFree: manifest.model?.catalogFree,
    referenceRates: manifest.model?.referenceCostPerMillion, provider: manifest.provider, mode: report.mode, task: report.task,
    taskSha256: manifest.taskSha256, bounds: manifest.limits ?? report.limits ?? null, topologyConditions: manifest.topologyConditions,
    sourceIntegrity: integrity, manifestIdentityMatchesReport: identityValid,
    calibration: report.calibration === true, calibrationEligibility: calibrationEligibility(report),
    calibrationKey: report.limits ? Object.fromEntries(['model', 'task', 'maxAgents', 'perNodeSteps', 'maxOutputTokens', 'recoveryMode']
      .map(key => [key, report.limits[key]])) : null,
    tokenCalibration: report.tokenCalibration ?? null, reference: report.reference ?? null,
    primaryMetrics: report.primaryMetrics ?? null, relativeMetrics: report.relativeMetrics ?? null,
    atnMessages: report.atnMessages ?? null, atnPayloadBytes: report.atnPayloadBytes ?? null,
    atnMaxContextBytes: report.metrics?.atnMaxContextBytes ?? null,
    evaluation: report.evaluation, stopReason: report.stopReason, elapsedMs: report.elapsedMs,
    issuedModelCalls: report.issuedModelCalls, observedModelCalls: report.metrics?.totals.attempts ?? null,
    tokens: report.metrics?.totals.tokens ?? null, referenceCost: report.metrics?.totals.cost ?? null,
    requestFailures: report.requestFailures, submissionMethod: report.submissionMethod,
    providerFailureAudit: { modelErrorAttempts: modelEnds.filter(event => event.status === 'error').length,
      requestFailuresRecordedByRunner: report.requestFailures?.length ?? 0,
      turnErrors: turnErrorRows.length, groups: turnErrorGroups, rows: turnErrorRows,
      meaning: 'Sanitized turn/end error events also cover thrown adapter failures missing from runner requestFailures. Counts are events, not deduplicated incidents; no raw error messages or unknown codes are emitted.' },
    submissionAttempts: submissionCalls.map(({ args, name, ...call }) => call),
    manipulation: report.manipulation, protocol: report.protocol, cleanup: report.cleanup,
    telemetryCoverage: report.metrics?.coverage ?? null,
    usageAudit: { settledModelEndEvents: modelEnds.length, eventTokens,
      unknownTokenEvents: modelEnds.filter(event => event.usage?.totalTokens == null)
        .map(event => ({ at: event.at, call: event.call, session: event.session, status: event.status, durationMs: event.durationMs })),
      totalsMatchReport: eventTokens.known === report.metrics?.totals.tokens.totalTokens.known
        && eventTokens.unknownCalls === report.metrics?.totals.tokens.totalTokens.unknownCalls },
    mailAudit: { observedUniqueMails: observedMailIds.size, retainedMails: retainedMails.length,
      deliveredMailIdsInSessions: deliveredMailIds.size, messageCountMatchesReport: observedMailIds.size === report.atnMessages,
      retainedPayloadBytes: sum(retainedMailRows, row => row.bytes),
      completeRetention: retainedMails.length === report.atnMessages,
      retainedPayloadMatchesReport: retainedMails.length === report.atnMessages
        ? sum(retainedMailRows, row => row.bytes) === report.atnPayloadBytes : null,
      rows: retainedMailRows,
      meaning: 'Unique telemetry mail ids audit total message count. Retained mail bytes can fully audit payload only when no message was pruned.' },
    rawRowTransport: { attemptedSends: sendRows.length, attemptsWithRowMarkers: sendRows.filter(row => row.rawRowMarkerCount > 0).length,
      successfulSendsWithRowMarkers: sendRows.filter(row => row.rawRowMarkerCount > 0 && row.finished && row.error === false).length,
      structuredLedgerEntryObjectsInAttempts: sum(sendRows, row => row.structuredLedgerEntryObjects),
      deliveredMessagesWithRowMarkers: deliveredRowMarkers.length,
      retainedMailsWithRowMarkers: retainedMailRows.filter(row => row.rawRowMarkerCount > 0).length,
      retainedMailsWithCompleteInitialRowIdSets: retainedMailRows.filter(row => row.allInitialRowIdsForSlots.length > 0)
        .map(row => ({ id: row.id, fromId: row.fromId, toId: row.toId, slots: row.allInitialRowIdsForSlots })),
      sendRowsWithMarkers: sendRows.filter(row => row.rawRowMarkerCount > 0), deliveredRowMarkers,
      meaning: 'Conservative marker scan for sN-eN/sN-lateN plus structured ledger-entry objects. Complete initial id sets identify all 12 ids from a slot but require body inspection to confirm amounts/accounts. Mentions can explain corrections; this is evidence of row identifiers being sent, not proof every flagged message contains full raw entries. No markers does not rule out paraphrased rows.' },
    tools: { callsByTool, errorsByTool, errors: Object.values(errorMessages), malformedToolArguments,
      totalsMatchReport: Object.values(callsByTool).reduce((a,b) => a+b, 0) === report.metrics?.totals.toolsStarted &&
        Object.values(errorsByTool).reduce((a,b) => a+b, 0) === report.metrics?.totals.toolErrors },
    rewiring: { attempts: rewireCalls.length, successfulToolResults: rewireCalls.filter(call => call.finished && call.error === false).length,
      committed: rewires.length, changedPeerSets: rewires.filter(row => row.changedPeerSet).length,
      addedEdges: rewires.reduce((sum, row) => sum + row.addedEdges, 0), removedEdges: rewires.reduce((sum, row) => sum + row.removedEdges, 0),
      rows: rewires, commitsMatchProtocol: rewires.length === report.protocol?.explicitRewires?.length },
    orphanClaims: { attempted: claims.length, successfulToolResults: claims.filter(call => call.finished && call.error === false).length,
      confirmedNewTaskResults: claims.filter(call => call.claimedTaskId).length,
      confirmedRecoveryClaims: claimedResultTasks.filter(task => /Recover ledger slot \d+:/.test(task.description)).length,
      confirmedDeliveryClaims: claimedResultTasks.filter(task => task.kind === 'delivery').length,
      persistedRetryTasks: retryTasks.length,
      persistedRecoveryRetryTasks: retryTasks.filter(task => /Recover ledger slot \d+:/.test(task.description)).length,
      persistedDeliveryRetryTasks: retryTasks.filter(task => task.kind === 'delivery').length,
      attempts: claims.map(({ name, args, ...call }) => ({ ...call, sourceTaskId: args.claimTaskId })),
      orphanTaskExposures, exposedSessions: orphanTaskExposureSessions.size,
      retryTasks: retryTasks.map(task => ({ id: task.id, retryOf: task.retryOf, kind: task.kind ?? 'work',
        isLedgerRecovery: /Recover ledger slot \d+:/.test(task.description),
        holderId: task.holderId, requesterId: task.requesterId, status: task.status })) },
    deliveryRecovery: { entryLifecycle: entryNode?.lifecycle ?? null, entryStepsUsed: entryNode?.stepsUsed ?? null,
      deliveryTasks: tasks.filter(task => task.kind === 'delivery').map(task => ({ id: task.id, holderId: task.holderId,
        retryOf: task.retryOf ?? null, status: task.status })),
      networkFinishAttempts: networkFinishCalls.map(({ args, name, ...call }) => call),
      networkClosed: network ? network.status !== 'open' : null, nativeDeliveryCompleted: network?.status === 'completed',
      meaning: 'Answer acceptance and durable network closure are separate outcomes. A non-error finish tool result may still have accepted:false; final successful submission can cancel before its tool result is logged.' },
    nodeBudgets: { totalRuntimeSteps: nodeBudgets.reduce((sum, node) => sum + (node.stepsUsed ?? 0), 0),
      retiredForBudget: nodeBudgets.filter(node => node.retiredForBudget).length,
      atStepLimit: nodeBudgets.filter(node => node.stepsUsed !== null && node.stepsUsed >= node.stepBudget).length,
      nodes: nodeBudgets },
    feedbackDelivery: { normalUserMessageSnapshots: feedbackMessages, withRuntimeTelemetry: telemetryMessages,
      sessionsWithRuntimeTelemetry: feedbackSessions.size, sessionFiles,
      textPayloadBytes: sum(feedbackRows, row => row.payloadBytes), snapshotMetadataRows: feedbackRows,
      minimumStepInterval: 3, stepIntervalViolations: feedbackStepViolations,
      stepOrRemainingTextOccurrences: feedbackRows.filter(row => row.volatileStepText).length },
    documentReads: { callsById: reads, successfulCallsById: successfulReads, errorsById: readErrors,
      successfulInitialSlots: Object.keys(successfulReads).filter(id => evidenceKind(id) === 'initial').length,
      successfulCorrectionSlots: Object.keys(successfulReads).filter(id => evidenceKind(id) === 'correction').length,
      mineCalls: reads.mine ?? 0, successfulMinePhase1, repeatedMinePhase1AfterFirst,
      repeatsMeaning: 'Additional successful phase-1 mine reads after the first per session; not all mine calls are idle polling.' },
    modelFinishReasons: finishReasons, maxTokenFinishes: finishReasons['max-tokens'] ?? 0, maxTokenFinishSteps,
    truncationAudit: { reportedTurnEnds: report.maxTokenTruncations ?? null, sessionTurnEnds: truncationTurnEnds,
      assistantStepFinishes: finishReasons['max-tokens'] ?? 0,
      stepFinishesBeyondTurnCounter: (finishReasons['max-tokens'] ?? 0) - truncationTurnEnds,
      countsMatch: truncationTurnEnds === report.maxTokenTruncations,
      meaning: 'Runner counts turn/end max-tokens; assistant finish chunks are reported separately and need not have the same count.' },
    telemetryEvents: events.length,
  }
}

const reports = files(root).filter(file => path.basename(file) === 'report.json').sort()
const runs = reports.map(summarize)
const planFile = path.join(root, 'validation-plan.json')
const plan = readOptional(planFile)
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
const calibrationPairs = [...new Set(runs.filter(run => run.calibration).map(run => JSON.stringify(run.calibrationKey)))].map(encodedKey => {
  const key = JSON.parse(encodedKey)
  const members = runs.filter(run => run.calibration && JSON.stringify(run.calibrationKey) === encodedKey)
  const suffix = key.recoveryMode === 'preassigned-backup' ? '-preassigned-backup' : ''
  const expectedModes = ['atn-no-rewire', 'atn-adaptive'].map(mode => mode + suffix)
  const missingModes = expectedModes.filter(mode => !members.some(run => run.mode === mode))
  const failedSamples = members.filter(run => !run.calibrationEligibility.eligibleSample)
  const eligiblePair = missingModes.length === 0 && failedSamples.length === 0
  return { key, expectedModes, missingModes, eligiblePair,
    samples: members.map(run => ({ runId: run.runId, mode: run.mode, ...run.calibrationEligibility })),
    measuredSafetyThreshold: eligiblePair ? Math.max(...members.map(run => run.tokens.totalTokens.known)) * 2 : null,
    multiplier: 2, meaning: 'Exact calibration key pair; all matching failed samples block eligibility. Missing runs are not failures.' }
})
const primaryGroups = [...new Set(runs.map(run => JSON.stringify([run.model, run.mode, run.task, run.bounds])))].map(encodedKey => {
  const members = runs.filter(run => JSON.stringify([run.model, run.mode, run.task, run.bounds]) === encodedKey)
  const measured = members.filter(run => run.relativeMetrics)
  return { model: members[0].model, mode: members[0].mode, task: members[0].task, bounds: members[0].bounds,
    attempts: members.length, passed: members.filter(run => run.evaluation.passed).length,
    answerPassRate: members.filter(run => run.evaluation.passed).length / members.length,
    meanRelativeMessages: measured.length ? sum(measured, run => run.relativeMetrics.relativeMessages) / measured.length : null,
    meanRelativePayloadBytes: measured.length ? sum(measured, run => run.relativeMetrics.relativePayloadBytes) / measured.length : null,
    meanRelativeTotalPayloadBytes: measured.length ? sum(measured, run => run.relativeMetrics.relativeTotalPayloadBytes) / measured.length : null,
    runs: members.map(run => run.runId), causalClaim: false }
})
const result = {
  schemaVersion: 2, generatedAt: new Date().toISOString(), root: relative(root),
  validationPlan: plan, validationPlanSha256: plan ? hash(planFile) : null,
  method: 'Offline analysis of every finalized report; no model calls, retry selection, or failure exclusion.',
  totalsMeaning: 'Accounting across all finalized runs, including separately bounded supplemental runs. Compare outcomes within bounds cohorts and pairs; do not interpret the combined totals as a shared-budget success rate.',
  costMeaning: 'Live-catalog reference estimate, not actual subscription billing. Incomplete usage is unknown, not zero.',
  relativePayloadMeaning: 'relativePayloadBytes compares total wire bytes to reference maximum per-node context; relativeTotalPayloadBytes compares total to total. Failed-run low costs do not demonstrate efficiency.',
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
    recoveryClaimsConfirmed: sum(runs, run => run.orphanClaims.confirmedRecoveryClaims),
    deliveryClaimsConfirmed: sum(runs, run => run.orphanClaims.confirmedDeliveryClaims),
    atnMessages: sum(runs, run => run.atnMessages), atnPayloadBytes: sum(runs, run => run.atnPayloadBytes),
    runtimeFeedbackMessages: sum(runs, run => run.feedbackDelivery.withRuntimeTelemetry),
    modelMaxTokenFinishChunks: sum(runs, run => run.maxTokenFinishes),
    runnerMaxTokenTurnEnds: sum(runs, run => run.truncationAudit.reportedTurnEnds),
    providerErrorAttempts: sum(runs, run => run.providerFailureAudit.modelErrorAttempts),
    turnErrors: sum(runs, run => run.providerFailureAudit.turnErrors),
    samplesEligibleForCalibration: runs.filter(run => run.calibrationEligibility.eligibleSample).length,
    eligibleCalibrationPairs: calibrationPairs.filter(pair => pair.eligiblePair).length,
    retiredForBudget: runs.reduce((sum, run) => sum + run.nodeBudgets.retiredForBudget, 0),
    allSourceHashesVerified: runs.every(run => run.sourceIntegrity.valid && run.manifestIdentityMatchesReport),
    allToolCountsMatch: runs.every(run => run.tools.totalsMatchReport),
    allRewireCountsMatch: runs.every(run => run.rewiring.commitsMatchProtocol),
    allMailCountsMatch: runs.every(run => run.mailAudit.messageCountMatchesReport),
    allFullyRetainedMailBytesMatch: runs.every(run => run.mailAudit.retainedPayloadMatchesReport !== false),
    allUsageCountsMatch: runs.every(run => run.usageAudit.totalsMatchReport),
    allTruncationCountersMatch: runs.every(run => run.truncationAudit.countsMatch),
    allFeedbackStepIntervalsValid: runs.every(run => run.feedbackDelivery.stepIntervalViolations.length === 0),
    allCleanupReleased: runs.every(run => run.cleanup === 'released'),
  }, cohorts, pairs, calibrationPairs, primaryGroups, runs,
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ output: relative(output), totals: result.totals, pendingReports: result.pendingReports }))
if (['allSourceHashesVerified', 'allToolCountsMatch', 'allRewireCountsMatch', 'allMailCountsMatch',
  'allFullyRetainedMailBytesMatch', 'allUsageCountsMatch', 'allTruncationCountersMatch', 'allFeedbackStepIntervalsValid']
  .some(key => !result.totals[key])) process.exitCode = 1
