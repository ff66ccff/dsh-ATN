/** Experiment accounting is observed through real Harness events; no provider calls. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import TeamService from '@deepseek-ai/dsh-experimental-agent-team'
import { installTelemetry, normalizeUsage, type PriceTable } from '../../experiments/telemetry.ts'
import { ExperimentSessionQuery } from '../../experiments/session-query.ts'
import { createExperimentBudget, installExperimentOutputCap } from '../../experiments/budget.ts'
import { bootKernel, createHostAgent, drive, settle } from '../fixtures/kernel.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'
import { enqueueMail, mailBytes } from '../../src/mailbox.ts'

const usage: TokenUsage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 5, reasoningTokens: 10, totalTokens: 165 }
const prices: PriceTable = {
  id: 'synthetic-test-rates', currency: 'USD', reasoningIncludedInOutput: true,
  routes: [{ provider: 'atn-script', model: 'deterministic', inputPerMillion: 1, outputPerMillion: 2, cacheReadPerMillion: .5, cacheWritePerMillion: 2 }],
}

test('TELEMETRY-01: entry and workers count once; topology/tasks persist without private text', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-experiment-telemetry-'))
  const kernel = await bootKernel(scratch)
  const telemetry = await installTelemetry(kernel.ctx, { directory: join(scratch, 'experiment'), runId: 'test', prices })
  try {
    const stream = kernel.model.stream.bind(kernel.model)
    kernel.model.stream = async function* (options) {
      for await (const chunk of stream(options)) {
        if (chunk.type === 'finish') yield { type: 'usage', usage }
        yield chunk
      }
    }
    const host = await createHostAgent(kernel, 'private-entry-identity')
    kernel.model.enqueue(host.id, [
      { tool: 'atn_start', args: { objective: 'SECRET_PROMPT', successCriteria: 'SECRET_CRITERIA', constraints: 'SECRET_CONSTRAINTS' } },
      { tool: 'atn_spawn', args: { task: 'SECRET_TASK', context: 'SECRET_CONTEXT' } },
    ])
    await drive(host, 'SECRET_USER_INPUT')
    await settle(kernel)
    const networkId = kernel.atn.networkForSession(host.id)!
    const network = await kernel.atn.network(networkId)
    const child = Object.values(network.nodes).find(node => !node.isEntry)!
    await kernel.atn.rewire(host, { peers: [] })
    await kernel.atn.rewire(host, { peers: [child.id] })
    await kernel.atn.send(kernel.ctx.agents.get(SessionId(child.sessionId))!, {
      to: network.entryNodeId, kind: 'result', taskId: Object.values(network.tasks).find(task => task.holderId === child.id)!.id,
      body: 'SECRET_RESULT', summary: 'SECRET_SUMMARY', evidence: ['SECRET_PATH'],
    })
    await settle(kernel)
    const current = telemetry.snapshot()
    const measured = await kernel.atn.network(networkId)
    const mails = Object.values(measured.mails)
    const received = new Map<string, number>()
    let payloadBytes = 0
    for (const mail of mails) {
      const bytes = mailBytes(mail, mail.kind === 'result' && mail.taskId ? measured.tasks[mail.taskId]?.result : undefined)
      payloadBytes += bytes
      if (mail.status === 'delivered') received.set(mail.toId, (received.get(mail.toId) ?? 0) + bytes)
    }
    assert.equal(current.atnMessages, mails.length)
    assert.equal(current.atnPayloadBytes, payloadBytes)
    assert.equal(current.atnMaxContextBytes, Math.max(0, ...received.values()))
    assert.equal(Object.keys(current.sessions).length, 2)
    assert.ok(current.totals.attempts >= network.stepsUsed, 'runtime counts admitted entry and worker steps; telemetry also covers calls outside the network')
    assert.equal(current.totals.inFlight, 0)
    assert.equal(current.totals.tokens.totalTokens.known, current.totals.attempts * 165)
    assert.equal(current.totals.tokens.reasoningTokens.known, current.totals.attempts * 10)
    assert.equal(current.totals.tokens.totalTokens.unknownCalls, 0)
    assert.ok(Math.abs(current.totals.cost.amount! - current.totals.attempts * .00017) < 1e-12)
    assert.equal(current.totals.toolsStarted, 2)
    assert.equal(current.totals.toolsFinished, 2)
    const final = await telemetry.close()
    assert.equal((await telemetry.close()).events, final.events, 'close is idempotent')
    const raw = await readFile(telemetry.paths.events, 'utf8')
    const rows = raw.trim().split('\n').map(line => JSON.parse(line))
    assert.ok(rows.some(row => row.kind === 'node.state' && row.entry === true))
    assert.ok(rows.some(row => row.kind === 'node.state' && row.entry === false))
    assert.ok(rows.some(row => row.kind === 'topology.changed' && !row.initial && row.peers.length === 0))
    assert.ok(rows.some(row => row.kind === 'task.state' && row.status === 'completed'))
    assert.ok(rows.some(row => row.kind === 'mail.state'))
    assert.equal(rows.filter(row => row.kind === 'model.end').length, final.totals.attempts)
    assert.ok(rows.some(row => row.kind === 'turn/end' && row.reason === 'completed'))
    assert.equal(rows.length, final.events)
    assert.equal(raw.includes('SECRET_'), false)
    assert.equal(raw.includes('private-entry-identity'), false)
    assert.equal(raw.includes(child.sessionId), false)
    assert.equal(raw.includes('Scripted fixture:'), false)
    await assert.rejects(() => installTelemetry(kernel.ctx, { directory: join(scratch, 'experiment'), runId: 'test' }), /EEXIST/)
  } finally {
    await telemetry.close()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('TELEMETRY-ATN: payload accounting survives status changes and retention without double counting', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-experiment-payload-'))
  const kernel = await bootKernel(scratch)
  const telemetry = await installTelemetry(kernel.ctx, {
    directory: join(scratch, 'experiment'), runId: 'payload', includeSession: id => id === 'session-A' || id === 'session-B',
  })
  try {
    let record = makeChain(['A', 'B', 'C', 'D'])
    record.tasks.done = makeTask('done', { status: 'completed', result: { summary: '合计 42', evidence: ['文档'] } })
    record = enqueueMail(record, { id: 'result', fromId: 'B', toId: 'A', kind: 'result', taskId: 'done',
      proposalId: null, body: 'SECRET_账户小计', now: 1 }).record
    record = enqueueMail(record, { id: 'excluded', fromId: 'C', toId: 'D', kind: 'note', taskId: null,
      proposalId: null, body: 'SECRET_EXCLUDED', now: 1 }).record
    const bytes = mailBytes(record.mails.result, record.tasks.done.result)
    kernel.ctx.emit('atn/network-updated', { record, at: 1 })
    assert.equal(telemetry.snapshot().atnMessages, 1)
    assert.equal(telemetry.snapshot().atnPayloadBytes, bytes)
    assert.equal(telemetry.snapshot().atnMaxContextBytes, 0, 'queued payload is not received context')
    record.mails.result = { ...record.mails.result, status: 'delivered', settledAt: 2 }
    kernel.ctx.emit('atn/network-updated', { record, at: 2 })
    kernel.ctx.emit('atn/network-updated', { record, at: 3 })
    kernel.ctx.emit('atn/network-updated', { record: { ...record, mails: {} }, at: 4 })
    kernel.ctx.emit('atn/network-updated', { record, at: 5 })
    assert.equal(telemetry.snapshot().atnMessages, 1)
    assert.equal(telemetry.snapshot().atnPayloadBytes, bytes)
    assert.equal(telemetry.snapshot().atnMaxContextBytes, bytes)
    kernel.ctx.emit('atn/network-updated', { record: { ...record, id: 'other-network' }, at: 6 })
    const final = await telemetry.close()
    assert.equal(final.atnMessages, 2, 'mail identities belong to their own network')
    assert.equal(final.atnPayloadBytes, 2 * bytes)
    assert.equal(final.atnMaxContextBytes, bytes, 'separate networks do not share node context')
    assert.equal(final.totals.attempts, 0)
    const summary = JSON.parse(await readFile(telemetry.paths.summary, 'utf8'))
    assert.equal(summary.atnPayloadBytes, 2 * bytes)
    assert.equal((await readFile(telemetry.paths.events, 'utf8')).includes('SECRET_'), false)
  } finally {
    await telemetry.close()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('TELEMETRY-02: visible failed attempts, auxiliary calls, partial usage and missing prices stay explicit', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-experiment-usage-'))
  const kernel = await bootKernel(scratch)
  let tick = 100
  const telemetry = await installTelemetry(kernel.ctx, { directory: join(scratch, 'experiment'), runId: 'failures', now: () => ++tick })
  try {
    const chunks: StreamChunk[][] = [
      [{ type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } }, { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'SECRET_ERROR' } } }],
      [{ type: 'usage', usage }, { type: 'finish', reason: { kind: 'stop' } }],
      [{ type: 'finish', reason: { kind: 'stop' } }],
    ]
    kernel.model.stream = async function* () { yield* chunks.shift()! }
    for (let attempt = 0; attempt < 3; attempt++) {
      for await (const _ of kernel.ctx.llm.stream({
        provider: 'atn-script', model: 'deterministic', messages: [],
        ...(attempt === 2 ? { purpose: 'compaction' as const } : { sessionId: SessionId('same-session') }),
      })) { /* Consume the observable adapter call. */ }
    }
    const result = await telemetry.close()
    assert.equal(result.totals.attempts, 3)
    assert.equal(result.totals.errors, 1)
    assert.equal(result.totals.tokens.inputTokens.known, 103)
    assert.equal(result.totals.tokens.inputTokens.unknownCalls, 1)
    assert.equal(result.totals.tokens.cacheReadTokens.unknownCalls, 2)
    assert.equal(result.totals.cost.amount, null)
    assert.equal(result.totals.cost.unknownCalls, 3)
    assert.equal(result.sessions.unattributed.attempts, 1)
    assert.ok(result.totals.modelDurationMs > 0)
    assert.equal(result.coverage.hiddenHttpRetries, 'unknown')
    const raw = await readFile(telemetry.paths.events, 'utf8')
    assert.equal(raw.includes('SECRET_ERROR'), false)
    assert.ok(raw.includes('compaction'))
  } finally {
    await telemetry.close()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('TELEMETRY-03: invalid and contradictory usage cannot become a billable zero', () => {
  assert.equal(normalizeUsage(undefined).inputTokens, null)
  assert.equal(normalizeUsage({ inputTokens: -1, outputTokens: 1 }).inputTokens, null)
  assert.equal(normalizeUsage({ ...usage, reasoningTokens: 21 }).totalTokens, null)
  assert.equal(normalizeUsage({ ...usage, totalTokens: 164 }).totalTokens, null)
  assert.equal(normalizeUsage({ inputTokens: 3, outputTokens: 2 }).cacheReadTokens, null)
})

test('TELEMETRY-04: closing an active observation marks incomplete coverage and never cancels the model', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-experiment-close-'))
  const kernel = await bootKernel(scratch)
  let entered!: () => void
  let release!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const wait = new Promise<void>(resolve => { release = resolve })
  const telemetry = await installTelemetry(kernel.ctx, { directory: join(scratch, 'experiment'), runId: 'close-active', prices })
  let consuming: Promise<void> | undefined
  try {
    kernel.model.stream = async function* () {
      entered()
      yield { type: 'usage', usage }
      await wait
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    consuming = (async () => {
      for await (const _ of kernel.ctx.llm.stream({ provider: 'atn-script', model: 'deterministic', messages: [] })) { /* Consume normally. */ }
    })()
    await started
    assert.equal(telemetry.snapshot().totals.inFlight, 1)
    assert.equal(telemetry.snapshot().totals.cost.amount, null)
    const final = await telemetry.close()
    assert.equal(final.coverage.closedWithInFlight, true)
    assert.equal(final.totals.inFlight, 1)
    assert.equal(final.totals.settledAttempts, 0)
    release()
    await consuming
    assert.deepEqual(telemetry.snapshot(), final, 'measurement remains frozen after close')
    const rows = (await readFile(telemetry.paths.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.equal(rows.filter(row => row.kind === 'model.start').length, 1)
    assert.equal(rows.filter(row => row.kind === 'model.end').length, 0)
  } finally {
    release()
    await consuming
    await telemetry.close()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('TELEMETRY-05: native Team task revisions, dependencies and mail export only structural facts', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-experiment-team-'))
  const kernel = await bootKernel(scratch)
  const telemetry = await installTelemetry(kernel.ctx, { directory: join(scratch, 'experiment'), runId: 'native-team' })
  try {
    await kernel.ctx.plugin(SubagentRuntime)
    await kernel.ctx.plugin(ExperimentSessionQuery)
    await kernel.ctx.plugin(Spawn, { providerName: 'spawn' })
    await kernel.ctx.plugin(TeamService)
    const host = await createHostAgent(kernel, 'SECRET_TEAM_ROOT')
    const child = await kernel.ctx.agentTeams.spawnTeammate(host, {
      name: 'secret-team-name', description: 'SECRET_TEAM_DESCRIPTION', context: 'fresh', provider: 'spawn',
      prompt: [{ type: 'text', text: 'SECRET_TEAM_PROMPT' }], signal: new AbortController().signal,
    })
    await settle(kernel)
    const first = await kernel.ctx.agentTeams.createTask(host, {
      subject: 'SECRET_TASK_SUBJECT', description: 'SECRET_TASK_BODY', writeScopes: ['SECRET_DIRECTORY/SECRET_FILE'],
    })
    const second = await kernel.ctx.agentTeams.createTask(host, {
      subject: 'SECRET_DEPENDENT_SUBJECT', description: 'SECRET_DEPENDENT_BODY', blockedBy: [first.id], writeScopes: [],
    })
    const claimed = await kernel.ctx.agentTeams.updateTask(host, { taskId: first.id, expectedRevision: first.revision, action: 'claim' })
    const completed = await kernel.ctx.agentTeams.updateTask(host, { taskId: first.id, expectedRevision: claimed.revision, action: 'complete' })
    await kernel.ctx.agentTeams.updateTask(host, { taskId: first.id, expectedRevision: completed.revision, action: 'reopen' })
    let acknowledge!: () => void
    const acknowledged = new Promise<void>(resolve => { acknowledge = resolve })
    const removeAcknowledgement = kernel.ctx.on('session/event', (_session, event) => {
      if (event.type === 'team/message/delivered') acknowledge()
    })
    const sent = await kernel.ctx.agentTeams.sendMessage(host, { target: child.member.name,
      content: [{ type: 'text', text: 'SECRET_TEAM_MAIL' }], signal: new AbortController().signal })
    assert.equal(sent.status, 'accepted')
    await settle(kernel)
    const deadline = setTimeout(() => acknowledge(), 1000)
    await acknowledged
    clearTimeout(deadline)
    removeAcknowledgement()
    const final = await telemetry.close()
    assert.equal(final.coverage.observationErrors, 0)
    const raw = await readFile(telemetry.paths.events, 'utf8')
    const rows = raw.trim().split('\n').map(line => JSON.parse(line))
    assert.ok(rows.some(row => row.kind === 'team.member' && row.phase === 'active'))
    const tasks = rows.filter(row => row.kind === 'team.task')
    assert.equal(tasks.length, 5)
    const linked = tasks.find(row => row.blockedBy.length === 1)!
    assert.ok(linked)
    assert.ok(tasks.some(row => row.task === linked.blockedBy[0] && row.status === 'completed' && row.revision === completed.revision))
    assert.ok(tasks.some(row => row.owner !== null))
    assert.ok(tasks.some(row => row.writeScopes.length === 1 && row.writeScopes[0].startsWith('write-scope-')))
    const queued = rows.find(row => row.kind === 'team.mail' && row.status === 'queued')!
    assert.ok(queued)
    assert.ok(rows.some(row => row.kind === 'team.mail' && row.status === 'delivered' && row.mail === queued.mail))
    assert.equal(raw.includes('SECRET_'), false)
    assert.equal(raw.includes('secret-team-name'), false)
    assert.equal(raw.includes(child.member.id), false)
    assert.equal(raw.includes(`\"${second.id}\"`), false)
  } finally {
    await telemetry.close()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('TELEMETRY-06: an outer admission gate prevents adapter dispatch and measurement of rejected calls', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-experiment-admission-'))
  const kernel = await bootKernel(scratch)
  const telemetry = await installTelemetry(kernel.ctx, { directory: join(scratch, 'experiment'), runId: 'admission' })
  try {
    const budget = createExperimentBudget({ provider: 'atn-script', model: 'deterministic', maxCalls: 2, maxOutputTokens: 100, observedTokenLimit: 1000 })
    kernel.ctx.on('llm/stream', (request, next) => (async function* () {
      const tokens = telemetry.snapshot().totals.tokens.totalTokens
      const admission = budget.admit(request, { ended: false, knownTotalTokens: tokens.known, unknownUsageCalls: tokens.unknownCalls })
      if (!admission.allowed) throw new Error(admission.reason)
      yield* next()
    })(), { global: true, prepend: true })
    const consume = async (maxTokens: number) => {
      for await (const _ of kernel.ctx.llm.stream({ provider: 'atn-script', model: 'deterministic', maxTokens, messages: [] })) { /* Consume normally. */ }
    }
    await assert.rejects(() => consume(101), /output-limit-not-applied/)
    await Promise.all([consume(100), consume(100)])
    await assert.rejects(() => consume(100), /call-limit/)
    const result = await telemetry.close()
    assert.equal(kernel.model.requests.length, 2)
    assert.equal(result.totals.attempts, 2)
    assert.equal(result.totals.errors, 0)
    assert.equal(budget.snapshot().denied, 2)
  } finally {
    await telemetry.close()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('TELEMETRY-07: output cap is logged before freezing and reaches ATN workers whose Agent options omit it', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-experiment-output-cap-'))
  const kernel = await bootKernel(scratch)
  const telemetry = await installTelemetry(kernel.ctx, { directory: join(scratch, 'experiment'), runId: 'output-cap' })
  try {
    installExperimentOutputCap(kernel.ctx, 64)
    const budget = createExperimentBudget({ provider: 'atn-script', model: 'deterministic', maxCalls: 8, maxOutputTokens: 64, observedTokenLimit: 1000 })
    kernel.ctx.on('llm/stream', (request, next) => {
      assert.equal(Object.isFrozen(request), true, 'real loop model requests are immutable')
      const admission = budget.admit(request, { ended: false, knownTotalTokens: 0, unknownUsageCalls: 0 })
      assert.ok(admission.allowed)
      return next()
    }, { global: true, prepend: true })
    const host = await createHostAgent(kernel, 'cap-entry')
    kernel.model.enqueue(host.id, [
      { tool: 'atn_start', args: { objective: 'Cap every model request.', successCriteria: 'Entry and worker have a logged cap.', constraints: 'No real model.' } },
      { tool: 'atn_spawn', args: { task: 'Check cap.', context: '' } },
    ])
    await drive(host, 'Start the experiment.')
    await settle(kernel)
    const network = await kernel.atn.network(kernel.atn.networkForSession(host.id)!)
    const child = Object.values(network.nodes).find(node => !node.isEntry)!
    const worker = kernel.ctx.agents.get(SessionId(child.sessionId))!
    assert.equal(worker.options.maxTokens, undefined)
    assert.ok(kernel.model.requests.some(request => request.sessionId === child.sessionId))
    assert.ok(kernel.model.requests.every(request => request.options.maxTokens === 64))
    for (const agent of [host, worker]) {
      const header = agent.session.snapshotEvents().find(event => event.type === 'request/header')
      assert.ok(header?.type === 'request/header')
      assert.equal(header.data.header.config.maxTokens, 64, 'the Session log agrees with the adapter input')
    }
    assert.equal(telemetry.snapshot().totals.attempts, kernel.model.requests.length)
    assert.equal(budget.snapshot().denied, 0)
  } finally {
    await telemetry.close()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('TELEMETRY-08: independent acceptance, task provenance and explicit rewire evidence export only aliased facts', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-experiment-verified-'))
  let now = 1_000_000
  const kernel = await bootKernel(scratch, { clock: () => now })
  const telemetry = await installTelemetry(kernel.ctx, { directory: join(scratch, 'experiment'), runId: 'verified-topology' })
  try {
    const host = await createHostAgent(kernel, 'SECRET_ENTRY_ID')
    const started = await kernel.atn.start(host, {
      objective: 'SECRET_GOAL', successCriteria: 'SECRET_CRITERIA', constraints: 'SECRET_CONSTRAINTS',
    })
    const baseline = await kernel.atn.spawn(host, { task: 'SECRET_BASELINE_TASK', context: 'SECRET_CONTEXT' })
    await settle(kernel)
    now += 100
    await kernel.atn.send(kernel.ctx.agents.get(SessionId(baseline.sessionId))!, {
      to: started.nodeId, kind: 'result', taskId: baseline.taskId,
      body: 'SECRET_RESULT', summary: 'SECRET_INCORRECT_ANSWER', evidence: ['SECRET_RESULT_PATH'],
    })
    const validator = (passed: boolean, cost: number) => ({
      id: 'SECRET_VALIDATOR_ID',
      validate: () => ({
        passed, summary: 'SECRET_ACCEPTANCE_SUMMARY', evidence: ['SECRET_CHECK_PATH'],
        metrics: { comparisonKey: 'SECRET_COMPARISON_KEY', cost, costUnit: 'SECRET_COST_UNIT', informationKeys: ['SECRET_INFORMATION_KEY'] },
      }),
    })
    await kernel.atn.verifyTask(started.networkId, baseline.taskId, validator(false, 10))
    const candidate = await kernel.atn.spawn(host, { task: 'SECRET_CANDIDATE_TASK', context: 'SECRET_CONTEXT' })
    await settle(kernel)
    now += 50
    await kernel.atn.send(kernel.ctx.agents.get(SessionId(candidate.sessionId))!, {
      to: started.nodeId, kind: 'result', taskId: candidate.taskId,
      body: 'SECRET_RESULT', summary: 'SECRET_CORRECT_ANSWER', evidence: ['SECRET_RESULT_PATH'],
    })
    await kernel.atn.verifyTask(started.networkId, candidate.taskId, validator(true, 5))
    await kernel.atn.rewire(host, { peers: [baseline.nodeId] })
    const changed = await kernel.atn.rewire(host, {
      peers: [candidate.nodeId], intent: 'verified-improvement',
      baselineTaskIds: [baseline.taskId], candidateTaskIds: [candidate.taskId],
    })
    assert.equal(changed.evaluation.verdict, 'observed-improvement')
    await kernel.atn.send(host, {
      to: candidate.nodeId, kind: 'task', body: 'SECRET_DEPENDENT_RETRY',
      dependsOn: [candidate.taskId], retryOf: baseline.taskId,
    })
    await settle(kernel)
    const before = await kernel.atn.network(started.networkId)
    await telemetry.flush()
    const regression = await kernel.atn.rewire(host, {
      peers: [baseline.nodeId], intent: 'verified-improvement',
      baselineTaskIds: [candidate.taskId], candidateTaskIds: [baseline.taskId],
    })
    assert.equal(regression.evaluation.verdict, 'observed-regression', 'optional validation describes a regression without vetoing exploration')
    const afterRewire = await kernel.atn.network(started.networkId)
    await telemetry.flush()
    const beforeEvents = telemetry.snapshot().events
    await assert.rejects(kernel.atn.verifyTask(started.networkId, candidate.taskId, validator(false, 0)), /already/)
    assert.deepEqual(await kernel.atn.network(started.networkId), afterRewire)
    assert.equal(telemetry.snapshot().events, beforeEvents, 'rejected host mutations emit no committed domain facts')
    const final = await telemetry.close()
    assert.equal(final.coverage.observationErrors, 0)
    const raw = await readFile(telemetry.paths.events, 'utf8')
    const rows = raw.trim().split('\n').map(line => JSON.parse(line))
    const acceptances = rows.filter(row => row.kind === 'task.acceptance')
    assert.equal(acceptances.length, 2, 'later network commits do not duplicate immutable acceptance')
    const passed = acceptances.find(row => row.status === 'passed')!
    const rejected = acceptances.find(row => row.status === 'failed')!
    assert.equal(passed.resultBound, true)
    assert.equal(rejected.resultBound, true)
    assert.notEqual(passed.task, candidate.taskId)
    assert.notEqual(rejected.task, baseline.taskId)
    assert.equal(passed.cost, 5)
    assert.equal(passed.latencyMs, 50)
    assert.equal(passed.validator, rejected.validator)
    assert.match(passed.validator, /^validator-/)
    assert.match(passed.comparison, /^comparison-/)
    assert.match(passed.costUnit, /^cost-unit-/)
    assert.ok(passed.informationKeys.every((key: string) => key.startsWith('information-')))
    const tasks = rows.filter(row => row.kind === 'task.state')
    assert.ok(tasks.some(row => row.task === passed.task && row.status === 'completed' && row.acceptance === 'unverified'),
      'submission is observable before host acceptance')
    assert.ok(tasks.some(row => row.acceptance === 'passed' && row.task === passed.task))
    const linked = tasks.find(row => row.retryOf !== null)!
    assert.equal(linked.retryOf, rejected.task)
    assert.deepEqual(linked.dependsOn, [passed.task])
    const rewires = rows.filter(row => row.kind === 'topology.rewire')
    assert.equal(rewires.filter(row => row.intent === 'verified-improvement').length, 2)
    assert.ok(rewires.some(row => row.verdict === 'observed-regression'))
    const approved = rewires.find(row => row.verdict === 'observed-improvement')!
    assert.equal(approved.verdict, 'observed-improvement')
    assert.equal(approved.causalClaim, false)
    assert.deepEqual(approved.baselineTasks, [rejected.task])
    assert.deepEqual(approved.candidateTasks, [passed.task])
    assert.deepEqual(approved.delta, { passRate: 1, meanLatencyMs: -50, meanCost: -5 })
    assert.match(approved.rewire, /^rewire-/)
    assert.ok(approved.previousPeers.every((id: string) => id.startsWith('node-')))
    assert.ok(approved.nextPeers.every((id: string) => id.startsWith('node-')))
    assert.ok(rewires.some(row => row.intent === 'exploration' && row.verdict === 'insufficient-evidence'))
    const observations = rows.filter(row => row.kind === 'topology.rewire-observations')
    assert.ok(observations.length >= rewires.length)
    assert.ok(observations.every(row => row.causalClaim === false && row.after.peers.every((peer: { peer: string; tasks: string[] }) =>
      peer.peer.startsWith('node-') && peer.tasks.every(task => task.startsWith('task-')))))
    // Runtime task ids and aliases share the task-N shape; a different task's
    // alias can coincidentally equal a raw id, so check the mapping above.
    for (const privateValue of ['SECRET_', started.networkId, host.id, baseline.sessionId, candidate.sessionId,
      changed.rewireId!, before.tasks[baseline.taskId]!.acceptance!.resultDigest]) {
      assert.equal(raw.includes(privateValue), false, privateValue)
    }
  } finally {
    await telemetry.close()
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
