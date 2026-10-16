/** Read-only reconstruction of archived runs. No Harness, providers or model execution. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CURRENT_PROBE_DIRECTORY, PROBE_SEEDS, jsonLines, sha256, loadProbeHistory, QUANTILE_PRINCIPLE } from './live-probe-history.ts'
import { deriveProbeLowerBound, evaluateProbeFeasibility, type ProbeGateInput } from './live-probe-feasibility.ts'
import { createShiftingEvidenceTask } from './shifting-evidence-task.ts'

// Fields are deliberately projected below; full prompt/argument values never enter this analysis.
interface Event {
  sequence: number; at: number; kind: string; session: string; node: string; entry: boolean
  lifecycle: string; creationState: string; stepsUsed: number; stepBudget: number
  task: string; holder: string; requester: string; status: string; holderStepsAtCreation: number
  mail: string; tool: string; call: string; turn: number; step: number; reason: string; error: boolean
}
type Category = 'discovery' | 'protocol' | 'rewire' | 'other'
interface ToolProof {
  eventSequence: number; session: string; tool: string; name: string; turn: number; step: number; at: number
  source: string; sourceSeq: number; argumentKeys: string[]; category: Category
}
interface IdentitySeed {
  seed: number; eventFile: string; eventSha256: string
  sources: Array<{ path: string; sha256: string; session: string; firstTurnSourceSeq: number; firstTurnEventSequence: number }>
  calls: ToolProof[]
}
export const TOKEN_POLICY = {
  choice: 'b-remove-from-effective-budget' as const,
  effectiveBudgetDimensions: ['nodeSteps', 'callCap', 'deadline'],
  excluded: 'observed-total-token',
  reason: 'totalTokens is unknown for all 224 calls. The historical 400000 totalTokens threshold provided no protection and is removed from the effective budget dimensions. Frozen runner/source hashes retain the historical inert check; it is not counted as a constraint.',
  outputCap: '4096 per request is a separate output cap, not a total token or cost ceiling.',
}

export function buildSensitivity(history: Awaited<ReturnType<typeof loadProbeHistory>>) {
  return history.quantiles.map(({ quantile, ms }) => {
    const input: ProbeGateInput = {
      lowerBound: deriveProbeLowerBound(createShiftingEvidenceTask(8, 17, 2)),
      reference: { actions: 60, maxNodeActions: 8, source: 'docs/execution-evidence/agy-model-20261015/references.json; constructive policy, not a minimum' },
      conditions: { agents: 8, perNodeSteps: 12, maxCalls: 96, timeoutMs: 600000, concurrency: 1 },
      latency: { ...history.latency, ms, coverage: { quantile, sampleCount: history.sampleCount, principle: QUANTILE_PRINCIPLE } },
      margin: { actionFactor: 1.125, nodeFactor: 1.125, overheadMs: 30000, rationale: 'Retain frozen 12.5% action/node planning headroom and 30000 ms host reserve; not a completion guarantee.' },
      schedulingRemedy: 'deadline',
    }
    const at600000 = evaluateProbeFeasibility(input)
    const requiredDeadlineMs = at600000.requiredDeadlineMs
    const withDeadline = (timeoutMs: number) => evaluateProbeFeasibility({ ...input, conditions: { ...input.conditions, timeoutMs } })
    return { quantile, latencyMs: ms, requiredDeadlineMs, at600000, at120000: withDeadline(120000),
      atRequiredDeadline: withDeadline(requiredDeadlineMs), belowRequiredDeadline: withDeadline(requiredDeadlineMs - 1) }
  })
}

export function classifyQuiescence(obligations: { openTasks: number; unresolvedTasks: number; queuedMail: number; checkpointsComplete: boolean }) {
  return obligations.openTasks > 0 || obligations.unresolvedTasks > 0 || obligations.queuedMail > 0 || !obligations.checkpointsComplete
    ? 'quiescence-with-obligations-open' as const : 'quiescence-with-obligations-complete' as const
}

function lastBy(events: Event[], kind: string, key: keyof Event) {
  return new Map(events.filter(event => event.kind === kind).map(event => [String(event[key]), event]))
}

function checkToolProof(events: Event[], proof: IdentitySeed) {
  const starts = events.filter(event => event.kind === 'tool.start')
  assert.equal(proof.calls.length, starts.length)
  assert.equal(new Set(proof.calls.map(call => call.eventSequence)).size, starts.length)
  const mapping = new Map<string, { tool: string; name: string; evidence: object[] }>()
  for (const call of proof.calls) {
    const event = starts.find(event => event.sequence === call.eventSequence)
    assert.ok(event, 'Tool evidence must bind to an archived tool.start')
    for (const key of ['at', 'session', 'tool', 'turn', 'step'] as const) assert.equal(call[key], event[key])
    const source = proof.sources.find(source => source.path === call.source && source.session === call.session)
    assert.ok(source && /^[a-f0-9]{64}$/.test(source.sha256), 'Missing persisted-session provenance')
    const expectedCategory = call.name === 'atn_status' ? (call.argumentKeys.includes('rewire') ? 'rewire'
      : call.argumentKeys.includes('review') || call.argumentKeys.includes('claimTaskId') ? 'protocol' : 'discovery')
      : ['atn_spawn', 'atn_send', 'atn_finish', 'submit_checkpoint'].includes(call.name) ? 'protocol' : 'other'
    assert.equal(call.category, expectedCategory)
    const previous = mapping.get(call.tool)
    if (previous) assert.equal(previous.name, call.name, 'Tool aliases are per-run, not inferred across runs')
    else mapping.set(call.tool, { tool: call.tool, name: call.name, evidence: [] })
    mapping.get(call.tool)!.evidence.push({ eventSequence: call.eventSequence, source: call.source, sourceSeq: call.sourceSeq, sourceSha256: source.sha256 })
  }
  // Structural cross-check: status writes and directed mail have independent durable events.
  for (const start of starts) {
    const end = events.find(event => event.kind === 'tool.end' && event.call === start.call)
    assert.ok(end && !end.error, 'Only completed successful tool calls are in this frozen batch')
    const inner = events.filter(event => event.sequence > start.sequence && event.sequence < end.sequence)
    if (inner.some(event => event.kind === 'task.requester-feedback' || event.kind === 'topology.rewire')) assert.equal(mapping.get(start.tool)?.name, 'atn_status')
    if (inner.some(event => event.kind === 'mail.state' && event.status === 'queued')) assert.equal(mapping.get(start.tool)?.name, 'atn_send')
  }
  return [...mapping.values()]
}

function summarizeSession(session: string, events: Event[], calls: ToolProof[], node: Event) {
  const starts = events.filter(event => event.kind === 'step/start' && event.session === session)
  assert.equal(starts.length, node.stepsUsed, 'Step categories must account for every charged step')
  const categories = { discovery: 0, protocol: 0, rewire: 0, other: 0 }
  const steps = starts.map(event => {
    const tools = calls.filter(call => call.session === session && call.turn === event.turn && call.step === event.step)
    // Exclusive step accounting, with tool-level counts retained for batched calls.
    const category: Category = tools.some(tool => tool.category === 'protocol') ? 'protocol'
      : tools.some(tool => tool.category === 'rewire') ? 'rewire'
      : tools.some(tool => tool.category === 'discovery') ? 'discovery' : 'other'
    categories[category]++
    return { eventSequence: event.sequence, turn: event.turn, step: event.step, category,
      tools: tools.map(({ name, category, eventSequence, argumentKeys }) => ({ name, category, eventSequence, argumentKeys })) }
  })
  const sessionCalls = calls.filter(call => call.session === session)
  const lastTurn = events.filter(event => event.kind === 'turn/end' && event.session === session).at(-1)
  assert.ok(lastTurn)
  return { node: node.node, session, lifecycle: node.lifecycle, stepsUsed: node.stepsUsed, stepBudget: node.stepBudget,
    remainingSteps: node.stepBudget - node.stepsUsed, lastTurnReason: lastTurn.reason, lastTurnSequence: lastTurn.sequence,
    categories, steps, toolCounts: Object.fromEntries([...new Set(sessionCalls.map(call => call.name))].map(name => [name, sessionCalls.filter(call => call.name === name).length])),
    readOnlyStatusCalls: sessionCalls.filter(call => call.category === 'discovery').length }
}

export async function analyzeProbeBatch() {
  const identityFile = 'docs/execution-evidence/probe-gate-quiescence-20261015/tool-identities.json'
  const identityRaw = await readFile(identityFile, 'utf8')
  const identities: { seeds: IdentitySeed[] } = JSON.parse(identityRaw)
  const stops = []
  for (const seed of PROBE_SEEDS) {
    const reportFile = `${CURRENT_PROBE_DIRECTORY}/seed-${seed}-report.json`
    const eventFile = `${CURRENT_PROBE_DIRECTORY}/seed-${seed}-events.jsonl`
    const reportRaw = await readFile(reportFile, 'utf8'), eventRaw = await readFile(eventFile, 'utf8')
    const report = JSON.parse(reportRaw), events = jsonLines<Event>(eventRaw)
    assert.match(report.stopReason, /^phase-[12]-quiescence$/)
    const proof = identities.seeds.find(row => row.seed === seed)
    assert.ok(proof)
    assert.equal(proof.eventFile, eventFile); assert.equal(proof.eventSha256, sha256(eventRaw))
    const toolMapping = checkToolProof(events, proof)
    assert.equal(proof.calls.filter(call => call.category === 'discovery').length,
      report.protocol.rewireTelemetry.priorStatusQueryCalls, 'Read-only status projection must match independent runner counter')
    assert.equal(proof.calls.filter(call => call.category === 'rewire').length,
      report.protocol.rewireTelemetry.statusRewireCalls, 'Rewire projection must match independent runner counter')
    const checkpointCalls = proof.calls.filter(call => call.name === 'submit_checkpoint')
    assert.equal(checkpointCalls.length, report.attempts.length)
    for (const call of checkpointCalls) {
      const start = events.find(event => event.sequence === call.eventSequence)!
      const end = events.find(event => event.kind === 'tool.end' && event.call === start.call)!
      assert.ok(report.attempts.some((attempt: { at: number }) => attempt.at >= start.at && attempt.at <= end.at), 'Checkpoint lacks matching submission receipt')
    }
    const nodes = lastBy(events, 'node.state', 'node'), tasks = lastBy(events, 'task.state', 'task'), mails = lastBy(events, 'mail.state', 'mail')
    const openTasks = [...tasks.values()].filter(task => task.status === 'open').length
    const queuedMail = [...mails.values()].filter(mail => mail.status === 'queued').length
    assert.equal(openTasks, report.protocol.openTasks)
    assert.equal(queuedMail, report.protocol.queuedMail)
    // The aliases in protocol.stepUse are raw runtime node IDs, not telemetry node aliases.
    // Their insertion order is creation order in both projections; verify all states, not just IDs.
    assert.deepEqual([...nodes.values()].map(node => [node.stepsUsed, node.lifecycle]),
      report.protocol.stepUse.map((node: { stepsUsed: number; lifecycle: string }) => [node.stepsUsed, node.lifecycle]))
    const running = new Set<string>()
    for (const event of events) {
      if (event.kind === 'turn/start') running.add(event.session)
      if (event.kind === 'turn/end') running.delete(event.session)
    }
    assert.equal(running.size, 0, 'Archived turn stream is not quiet')
    const end = events.find(event => event.kind === 'experiment.end')!
    const lastTurnAt = Math.max(...events.filter(event => event.kind === 'turn/end').map(event => event.at))
    assert.ok(end.at - lastTurnAt >= 200)
    const unfinished = [...tasks.values()].filter(task => task.status !== 'completed').map(task => {
      const holder = nodes.get(task.holder)
      assert.ok(holder, `Missing holder state for ${task.task}; stop rather than guess`)
      assert.ok(['active', 'retired', 'failed'].includes(holder.lifecycle), 'Unexplained holder lifecycle')
      assert.ok(Number.isInteger(task.holderStepsAtCreation), 'Missing creation step observation')
      const turn = events.filter(event => event.kind === 'turn/end' && event.session === holder.session).at(-1)!
      return { task: task.task, holder: task.holder, requester: task.requester, status: task.status,
        taskSequence: task.sequence, holderStepsAtCreation: task.holderStepsAtCreation,
        holderReachability: holder.lifecycle === 'active' && holder.creationState === 'published' ? 'holder-alive' : 'holder-unreachable',
        holderState: { lifecycle: holder.lifecycle, active: holder.lifecycle === 'active', retired: holder.lifecycle === 'retired',
          failed: holder.lifecycle === 'failed', stepsUsed: holder.stepsUsed, remainingSteps: holder.stepBudget - holder.stepsUsed,
          running: false, lastTurnReason: turn.reason, nodeSequence: holder.sequence, turnSequence: turn.sequence } }
    })
    const obligations = { networkStatus: report.protocol.status, openTasks, unresolvedTasks: unfinished.length, queuedMail,
      checkpointsComplete: report.phase1Correct && report.phase2Correct,
      checkpoints: report.evaluation, checkpointSnapshots: report.checkpointObligations,
      meaning: 'Quiescence is activity cessation, never evidence that the protocol or checkpoints completed. Unresolved includes open, failed and unreachable tasks; historical openTasks counts open only.' }
    const sessions = [...nodes.values()].map(node => summarizeSession(node.session, events, proof.calls, node))
    const entryNode = [...nodes.values()].find(node => node.entry)!
    const entry = sessions.find(session => session.node === entryNode.node)!
    const tokens = report.metrics.totals.tokens
    assert.equal(tokens.totalTokens.unknownCalls, report.metrics.totals.attempts)
    assert.equal(tokens.totalTokens.known, 0)
    stops.push({ seed, stopReason: report.stopReason, classification: classifyQuiescence(obligations), failureClass: report.failureClass,
      activity: { reason: 'No agent running after scheduler tick, sustained >=200 ms', runningAgents: running.size, minimumQuietMs: 200,
        lastTurnToExperimentEndMs: end.at - lastTurnAt, evidence: 'Archived stopReason plus unchanged runner predicate; turn/end stream corroborates quiet, not an independent tick trace.' },
      obligations, tasks: unfinished, entry, otherNodes: sessions.filter(session => session !== entry), toolMapping,
      tokens: { inputKnown: tokens.inputTokens.known, outputKnown: tokens.outputTokens.known, cacheReadKnown: tokens.cacheReadTokens.known,
        totalUnknownCalls: tokens.totalTokens.unknownCalls, historicalThreshold: 400000, inputExceedsHistoricalThreshold: tokens.inputTokens.known > 400000 },
      failures: report.failures,
      sources: [{ path: reportFile, sha256: sha256(reportRaw) }, { path: eventFile, sha256: sha256(eventRaw) }] })
  }
  const quiescenceCounts = { 'quiescence-with-obligations-open': 0, 'quiescence-with-obligations-complete': 0 }
  const failureCounts = { 'incorrect-proof': 0, 'submission-discipline': 0 }
  for (const stop of stops) {
    quiescenceCounts[stop.classification]++
    assert.ok(stop.failureClass === 'incorrect-proof' || stop.failureClass === 'submission-discipline')
    failureCounts[stop.failureClass as keyof typeof failureCounts]++
  }
  return { identitySource: { path: identityFile, sha256: sha256(identityRaw) }, stops, quiescenceCounts, failureCounts,
    tokenPolicy: { ...TOKEN_POLICY, exceededInputSeeds: stops.filter(stop => stop.tokens.inputExceedsHistoricalThreshold).map(stop => stop.seed) },
    hypothesis: { statusAliasIsAtnStatus: true, discoveryDominatesEntryBudget: stops[0].entry.categories.discovery > stops[0].entry.stepsUsed / 2,
      conclusion: 'Not established as stated: tool-2 is atn_status but includes review and rewire. Seed 17 has 4/12 read-only discovery steps, 5 protocol, 1 rewire, 2 other. Query count exceeds each peer, but does not dominate the entry budget; no causal or statistical significance claim.' },
    causality: 'Observed cessation and remaining obligations locate protocol progress failure, not a causal proof that discovery or step allocation caused it. Seeds 31/59 retain steps and end for max-tokens/error respectively.' }
}

export async function verifyArchivedProbeHashes() {
  const legacyPlanRaw = await readFile('docs/execution-evidence/agy-model-20261015/plan.json', 'utf8')
  const planRaw = await readFile(`${CURRENT_PROBE_DIRECTORY}/plan.json`, 'utf8')
  const legacy = JSON.parse(legacyPlanRaw), plan = JSON.parse(planRaw)
  assert.deepEqual(plan.sourceHashes, legacy.sourceHashes)
  const entries = Object.entries(plan.sourceHashes) as Array<[string, string]>
  assert.equal(entries.length, 37)
  const checked = []
  for (const [file, expected] of entries) {
    const actual = sha256(await readFile(resolve('experiments', file)))
    assert.equal(actual, expected, `Archived source changed: ${file}`)
    checked.push({ file, expected, actual, unchanged: true })
  }
  for (const seed of PROBE_SEEDS) {
    for (const suffix of ['report', 'manifest']) {
      const record = JSON.parse(await readFile(`${CURRENT_PROBE_DIRECTORY}/seed-${seed}-${suffix}.json`, 'utf8'))
      assert.deepEqual(record.sourceHashes, plan.sourceHashes, `Archived seed ${seed} ${suffix} sourceHashes drift`)
    }
  }
  return { count: checked.length, unchanged: true, checked, legacyPlanSha256: sha256(legacyPlanRaw), planSha256: sha256(planRaw) }
}
