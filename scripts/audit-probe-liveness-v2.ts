/** V2 offline audit: semantic gate -> real fault controls -> unique joins -> verdicts. */
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, basename, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { establishSemantics, exactlyOne, lines, sha256, classifyMail, verdict } from '../experiments/probe-liveness-audit-v2.ts'
import { runLivenessControls } from '../tests/fixtures/probe-liveness-controls.ts'
import { loadProbeHistory } from '../experiments/live-probe-history.ts'

const out = resolve(process.argv[2] ?? 'docs/execution-evidence/probe-liveness-audit-v2-20261015')
const archive = 'docs/execution-evidence/live-probe-resumed-20261015'
const identityPath = 'docs/execution-evidence/probe-gate-quiescence-20261015/tool-identities.json'
const parse = async (path: string) => JSON.parse(await readFile(path, 'utf8'))
const save = async (name: string, data: unknown) => writeFile(`${out}/${name}.json`, JSON.stringify(data, null, 2) + '\n')
await mkdir(out, { recursive: true })
const semantics = await establishSemantics()
await save('semantics-gate', { ...semantics, phase: 1, seedVerdictsExistAtThisPhase: false })
// This gate file is committed before any classifier is invoked.
const controls = await runLivenessControls(semantics)
await save('controls', { phase: 2, controls })
const identities = await parse(identityPath)
const discovery = await parse(`${archive}/discovery.json`)
assert.equal(discovery.provider, 'agy'); assert.equal(discovery.model, 'gemini-3.8-flash-tiered'); assert.equal(discovery.reasoningEffort, 'medium')
const plan = await parse(`${archive}/plan.json`)
assert.deepEqual(plan.sourceHashes, (await parse('docs/execution-evidence/agy-model-20261015/plan.json')).sourceHashes)
const integrity = []
for (const [file, expected] of Object.entries(plan.sourceHashes)) {
  const actual = sha256(await readFile(resolve('experiments', file)))
  assert.equal(actual, expected, `Frozen source changed: ${file}`)
  integrity.push({ file, sha256: actual })
}
assert.equal(integrity.length, 37)
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'src', 'tests/integration/result-outcome.test.ts', 'tests/integration/knowledge-feedback.test.ts'])
const scans = [], requiredFiles = [identityPath]
for (const seed of [17, 31, 45, 59, 73]) {
  const identity = exactlyOne(identities.seeds.filter((row: any) => row.seed === seed), `seed ${seed} identity`)
  const eventPath = `${archive}/seed-${seed}-events.jsonl`
  const raw = await readFile(eventPath, 'utf8'), events = lines(raw)
  assert.equal(sha256(raw), identity.eventSha256)
  const report = await parse(`${archive}/seed-${seed}-report.json`)
  assert.deepEqual(report.sourceHashes, plan.sourceHashes)
  assert.deepEqual((await parse(`${archive}/seed-${seed}-manifest.json`)).sourceHashes, plan.sourceHashes)
  assert.equal(report.metrics.coverage.observationErrors, 0)
  assert.equal(report.metrics.coverage.writeFailed, false)
  assert.equal(report.metrics.coverage.closedWithInFlight, false)
  const nodes = new Map<string, any>(events.filter(e => e.kind === 'node.state').map(e => [e.node, e]))
  assert.equal(new Set([...nodes.values()].map(n => n.session)).size, nodes.size)
  for (const event of events.filter(e => e.kind === 'node.state')) assert.equal(nodes.get(event.node).session, event.session)
  const sessions = new Map<string, any[]>()
  for (const source of identity.sources) {
    requiredFiles.push(source.path)
    const sourceRaw = await readFile(source.path, 'utf8')
    assert.equal(sha256(sourceRaw), source.sha256)
    const rows = lines(sourceRaw)
    const firstTurn = exactlyOne(rows.filter(row => row.seq === source.firstTurnSourceSeq && row.type === 'turn/start'), 'first turn source')
    const telemetryTurn = exactlyOne(events.filter(e => e.sequence === source.firstTurnEventSequence), 'first turn telemetry')
    assert.equal(telemetryTurn.session, source.session)
    assert.equal(telemetryTurn.at, firstTurn.time); assert.equal(telemetryTurn.turn, firstTurn.data.turn)
    sessions.set(source.session, rows)
  }
  const storagePath = `.artifacts/live-probe-resumed/20261015/batch/seed-${seed}/storage/atn_networks.json`
  requiredFiles.push(storagePath)
  const storageRaw = await readFile(storagePath, 'utf8')
  const network: any = exactlyOne(Object.values(JSON.parse(storageRaw).tables.networks), 'persisted network')
  const rawNodeIds = new Map<string, string>()
  for (const node of nodes.values()) {
    const source: any = exactlyOne(identity.sources.filter((s: any) => s.session === node.session), 'node session provenance')
    const rawNode: any = exactlyOne(Object.values(network.nodes).filter((n: any) => n.sessionId === basename(dirname(source.path))), 'raw node session')
    assert.equal(rawNode.stepsUsed, node.stepsUsed); assert.equal(rawNode.lifecycle, node.lifecycle)
    rawNodeIds.set(node.node, rawNode.id)
  }
  const queued = events.filter(e => e.kind === 'mail.state' && e.status === 'queued')
  const uniqueMails = [...new Set(events.filter(e => e.kind === 'mail.state').map(e => e.mail))]
  const mails = []
  for (const mail of uniqueMails) {
    const states = events.filter(e => e.kind === 'mail.state' && e.mail === mail)
    const q = exactlyOne(states.filter(e => e.status === 'queued'), `${seed}/${mail} queued observation`)
    const delivered = states.filter(e => e.status === 'delivered')
    const d = delivered.length ? exactlyOne(delivered, `${seed}/${mail} delivered observation`) : null
    const recipient = nodes.get(q.to)
    assert.ok(recipient)
    const rows = sessions.get(recipient.session)
    assert.ok(rows, '7.4: recipient session unavailable')
    const atDelivery = events.filter(e => e.kind === 'node.state' && e.node === q.to && e.sequence < (d ?? states.at(-1)).sequence).at(-1)
    assert.ok(atDelivery)
    const terminal = ['retired', 'failed'].includes(atDelivery.lifecycle)
    const receipts = rows.filter(e => e.type === 'user/message' && e.data.source?.kind === 'atn'
      && e.time >= q.at && e.time <= (d?.at ?? events.at(-1)!.at)
      && e.data.content?.some((block: any) => block.type === 'text' && block.text?.startsWith(`[ATN ${q.messageKind}]`) && block.text.split('\n')[0].includes(' mail=')))
    const receipt = receipts.length ? exactlyOne(receipts, `${seed}/${mail} input interval/kind`) : null
    if (d) assert.ok(receipt, `7.4: delivered without receipt ${seed}/${mail}`)
    let inputStep: any = null, modelRequests: any[] = [], stepEnd: any = null, uniqueness: any = null
    if (receipt) {
      const competing = queued.filter(other => other.to === q.to && other.messageKind === q.messageKind && other.at <= receipt.time
        && (events.find(e => e.kind === 'mail.state' && e.mail === other.mail && e.status === 'delivered')?.at ?? Infinity) >= receipt.time)
      assert.equal(exactlyOne(competing, `${seed}/${mail} reverse mail interval`).mail, mail)
      const sourceStep = rows.filter(e => e.type === 'step/start' && e.seq < receipt.seq).at(-1)
      assert.ok(sourceStep)
      const sourceEnd = exactlyOne(rows.filter(e => e.type === 'step/end' && e.data.turn === sourceStep.data.turn && e.data.step === sourceStep.data.step), 'source step end')
      assert.ok(receipt.seq < sourceEnd.seq)
      inputStep = exactlyOne(events.filter(e => e.kind === 'step/start' && e.session === recipient.session && e.at === sourceStep.time
        && e.turn === sourceStep.data.turn && e.step === sourceStep.data.step), `${seed}/${mail} telemetry step`)
      stepEnd = exactlyOne(events.filter(e => e.kind === 'step/end' && e.session === recipient.session && e.turn === inputStep.turn && e.step === inputStep.step), 'step end')
      modelRequests = events.filter(e => e.kind === 'model.start' && e.session === recipient.session && e.sequence > inputStep.sequence && e.sequence < stepEnd.sequence)
        .map(start => {
          const end = exactlyOne(events.filter(e => e.kind === 'model.end' && e.call === start.call), 'model end')
          assert.ok(receipt.time <= start.at)
          return { call: start.call, startSequence: start.sequence, endSequence: end.sequence, status: end.status, finishReason: end.finishReason }
        })
      uniqueness = { receiptMatches: receipts.length, reverseMailMatches: competing.length, sourceStepSeq: sourceStep.seq,
        receiptSourceSeq: receipt.seq, receiptTime: receipt.time, sourceEndSeq: sourceEnd.seq, exactTimeTurnStepMatches: 1 }
    }
    const classification = classifyMail(semantics, { mail, input: !!receipt, modelStarted: !!modelRequests.length, delivered: !!d, terminalAtDelivery: terminal })
    mails.push({ mail, task: q.task, node: q.to, session: recipient.session, messageKind: q.messageKind,
      queuedSequence: q.sequence, deliveredSequence: d?.sequence ?? null, terminalAtDelivery: terminal,
      finalState: { status: states.at(-1)!.status, sequence: states.at(-1)!.sequence },
      recipientAtDelivery: { lifecycle: atDelivery.lifecycle, sequence: atDelivery.sequence },
      inputStep: inputStep ? { turn: inputStep.turn, step: inputStep.step, startSequence: inputStep.sequence, endSequence: stepEnd.sequence,
        admission: 'accepted: preStep precedes step/start' } : null,
      modelRequests, uniqueness, delayedInSameStep: !!(d && inputStep && d.sequence > inputStep.sequence && d.sequence < stepEnd.sequence), ...classification })
  }
  assert.equal(mails.length, uniqueMails.length)
  const starts = events.filter(e => e.kind === 'model.start'), ends = events.filter(e => e.kind === 'model.end')
  assert.equal(starts.length, report.metrics.totals.attempts); assert.equal(ends.length, report.metrics.totals.attempts)
  const lastActions = [...nodes.values()].map(node => {
    const own = events.filter(e => e.session === node.session)
    const step = own.filter(e => e.kind === 'step/start').at(-1)
    assert.ok(step)
    const end = own.find(e => e.kind === 'step/end' && e.turn === step.turn && e.step === step.step)
    const calls = own.filter(e => e.kind === 'model.start' && e.sequence > step.sequence && e.sequence < (end?.sequence ?? Infinity))
    const results = calls.map(call => exactlyOne(own.filter(e => e.kind === 'model.end' && e.call === call.call), 'last action model end'))
    const turnEnd = own.find(e => e.kind === 'turn/end' && e.turn === step.turn && e.sequence > step.sequence)
    const tools = own.filter(e => e.kind === 'tool.start' && e.turn === step.turn && e.step === step.step).map(tool => {
      const named = exactlyOne(identity.calls.filter((call: any) => call.eventSequence === tool.sequence), 'tool identity')
      return { tool: tool.tool, name: named.name, category: named.category,
        origin: ['read_evidence', 'submit_checkpoint'].includes(named.name) ? 'experiment-tool' : 'atn-tool', sequence: tool.sequence }
    })
    const attempts = own.filter(e => e.kind === 'model.end').length
    const modelEndCounts = own.filter(e => e.kind === 'model.end').reduce<Record<string, number>>((counts, e) => {
      const outcome = e.status === 'completed' && e.finishReason === 'max-tokens' ? 'max-tokens' : e.status
      counts[outcome] = (counts[outcome] ?? 0) + 1
      return counts
    }, {})
    const boundary = turnEnd?.sequence ?? end?.sequence ?? step.sequence
    const related = events.filter(e => e.session === node.session || e.node === node.node || e.to === node.node
      || e.from === node.node || e.holder === node.node || e.requester === node.node)
    assert.equal(attempts, report.metrics.sessions[node.session].attempts)
    assert.equal(Object.values(modelEndCounts).reduce((a, b) => a + b, 0), attempts)
    return { node: node.node, session: node.session, lifecycle: node.lifecycle, stepsUsed: node.stepsUsed, remainingSteps: node.stepBudget - node.stepsUsed,
      lastStep: { turn: step.turn, step: step.step, startSequence: step.sequence, endSequence: end?.sequence ?? null },
      modelEnds: results.map(e => ({ sequence: e.sequence, status: e.status, finishReason: e.finishReason,
        outcome: e.status === 'completed' && e.finishReason === 'max-tokens' ? 'max-tokens' : e.status })),
      turnEnd: turnEnd ? { sequence: turnEnd.sequence, reason: turnEnd.reason } : null,
      subsequentEvents: own.filter(e => e.sequence > (turnEnd?.sequence ?? end?.sequence ?? step.sequence)).map(e => ({ kind: e.kind, sequence: e.sequence })),
      subsequentRelatedEvents: related.filter(e => e.sequence > boundary).map(e => ({ kind: e.kind, sequence: e.sequence })),
      lastNodeStateSequence: node.sequence, eventsAfterLastStepEnd: own.filter(e => e.sequence > (end?.sequence ?? Infinity)).length,
      tools, attempts, modelEndCounts, unresolvedMailAtLastStepEnd: mails.filter(m => m.node === node.node && m.queuedSequence <= (end?.sequence ?? Infinity)
        && (!m.inputStep || m.inputStep.startSequence > (end?.sequence ?? Infinity))).map(m => m.mail) }
  })
  assert.equal(lastActions.reduce((n, row) => n + row.attempts, 0), report.metrics.totals.attempts)
  const openSteps = events.filter(e => e.kind === 'step/start' && !events.some(end => end.kind === 'step/end' && end.session === e.session && end.turn === e.turn && end.step === e.step))
  const openModels = starts.filter(e => !ends.some(end => end.call === e.call))
  const firstStep = events.find(e => e.kind === 'step/start')!
  const tasks = [...new Set(events.filter(e => e.kind === 'task.state').map(e => e.task))].map(task => {
    const history = events.filter(e => e.kind === 'task.state' && e.task === task), first = history[0], last = history.at(-1)!
    const preset = first.createdAt < firstStep.at && first.holderStepsAtCreation === 0
    const persisted: any = exactlyOne(Object.values(network.tasks).filter((t: any) => t.createdAt === first.createdAt
      && t.holderId === rawNodeIds.get(first.holder) && t.requesterId === rawNodeIds.get(first.requester)), 'persisted task')
    assert.equal(persisted.status, last.status)
    if (!preset && last.status !== 'completed') assert.equal(persisted.kind, 'delivery', 'Unspecified runtime obligation requires semantic review')
    return { task, holder: last.holder, requester: last.requester, status: last.status, createdAt: first.createdAt,
      createdSequence: first.sequence, holderStepsAtCreation: first.holderStepsAtCreation, lastSequence: last.sequence,
      category: preset ? 'preset-role-obligation' : 'runtime-request', taskKind: persisted.kind ?? 'work', wakeEligible: false,
      requiresNodeAction: true, nextAction: preset ? 'finish existing role, using previously received input' : 'explicit atn_status claimTaskId, then atn_finish scope=network',
      trigger: preset ? 'none: residual preset obligation; original input already consumed' : 'pull: delivery obligation discovery/claim; only a successful claim would push a new task mail',
      reason: preset ? 'Creation before first step with holderStepsAtCreation=0; bookkeeping does not independently send input'
        : 'src/tasks.ts:278 materializes unreachable delivery obligation without mail; src/runtime.ts:1647 requires explicit claimTaskId; no unclaimed obligation pushes a wake' }
  }).filter(task => task.status !== 'completed')
  assert.equal(tasks.filter(task => task.status === 'open').length, report.protocol.openTasks)
  const lastMailStates = new Map(events.filter(e => e.kind === 'mail.state').map(e => [e.mail, e]))
  assert.equal([...lastMailStates.values()].filter(e => e.status === 'queued').length, report.protocol.queuedMail)
  assert.equal(report.protocol.queuedMail, 0)
  const openTurns = events.filter(e => e.kind === 'turn/start' && !events.some(end => end.kind === 'turn/end' && end.session === e.session && end.turn === e.turn))
  assert.equal(openTurns.length, 0)
  assert.equal(report.metrics.totals.inFlight, openModels.length)
  scans.push({ seed, verdict: verdict(semantics, mails), support: mails.map(m => ({ mail: m.mail, task: m.task,
    queuedSequence: m.queuedSequence, inputStep: m.inputStep, deliveredSequence: m.deliveredSequence,
    finalState: m.finalState, recipientAtDelivery: m.recipientAtDelivery, category: m.category, defect: m.defect })),
    mails, lastActions, tasks, openTasks: tasks.filter(task => task.status === 'open').length, unresolvedTasks: tasks.length,
    inFlight: { present: openSteps.length + openModels.length > 0, steps: openSteps.map(e => e.sequence), models: openModels.map(e => e.sequence), metricsInFlight: report.metrics.totals.inFlight },
    attempts: starts.length, sourceEventSha256: sha256(raw), persistedNetworkSource: { path: storagePath, sha256: sha256(storageRaw) } })
}
const counterexample = exactlyOne(scans.find(row => row.seed === 59)!.mails.filter(row => row.mail === 'mail-10'), 'seed59/mail10')
assert.equal(counterexample.category, 'normal-receipt'); assert.equal(counterexample.delayedInSameStep, true)
assert.equal(counterexample.inputStep!.startSequence, 285)
assert.equal(scans.reduce((n, row) => n + row.tasks.filter(task => task.status === 'open' && task.category === 'preset-role-obligation').length, 0), 33)
const history = await loadProbeHistory()
const p90 = history.latency.ms, mean = history.meanMs
const tailReserveMs = Math.max(0, p90 - mean)
const sumRequired = Math.ceil(68 * mean + tailReserveMs + 30000), p90Required = 68 * p90 + 30000
const gateComparison = { calls: 68, meanMs: mean, p90Ms: p90, hostReserveMs: 30000,
  tailReserveMs, tailReserveMeaning: 'one extra p90-minus-mean service interval, plus the unchanged 30000ms host reserve; planning assumption, not a probability bound',
  sum: { requiredDeadlineMs: sumRequired, admittedAt600Seconds: sumRequired <= 600000 },
  p90: { requiredDeadlineMs: p90Required, admittedAt600Seconds: p90Required <= 600000 }, differenceMs: p90Required - sumRequired,
  quantilePolicyChanged: false, sampleCount: history.sampleCount }
await save('audit', { phase: 3, execution: 'offline-zero-real-model', actualModelCalls: 0, accountReads: 0, networkAccess: false,
  providerLoaded: false, scriptedControlRequestsOnly: true, route: { provider: discovery.provider, model: discovery.model, reasoningEffort: discovery.reasoningEffort },
  semantics, controls, scans, gateComparison, integrity,
  replay: { ciReplayableFromTrackedFiles: false, option: '4.6(b)', requiredFiles,
    trackedPrerequisites: [identityPath, semantics.path, `${archive}/discovery.json`, `${archive}/plan.json`, `${archive}/provider-calls.jsonl`,
      'docs/execution-evidence/agy-model-20261015/plan.json',
      ...scans.flatMap(s => ['events.jsonl', 'report.json', 'manifest.json'].map(suffix => `${archive}/seed-${s.seed}-${suffix}`))],
    dependencyPrerequisite: 'Install repository lockfile dependencies; semantic code hashes include the installed Harness packages. All 37 frozen source files listed in integrity are required.',
    acquisition: 'Preserve original .artifacts/live-probe-resumed/20261015/batch session.v4.jsonl files from the historical authorized run; hashes in tool-identities.json must match. Do not rerun paid model calls to regenerate different histories.',
    limitation: 'Full historical audit requires untracked persistent sessions; fresh CI checkout can run semantic and real-kernel control tests only.' },
  causalClaim: false, interpretation: 'No missing request/receipt chain in these observed mails. This does not prove task success or explain incorrect proofs causally.' })
let tables = '# V2 可复核明细\n\n完整历史重算依赖 audit.json.replay 列出的未跟踪 session 与 network 文件（方案 4.6(b)）。表内序号均为遥测 sequence，source seq 单列保存在 JSON。\n'
for (const scan of scans) {
  tables += `\n## Seed ${scan.seed}\n\n${scan.verdict}；飞行中节点：${scan.inFlight.present ? '有' : '无'}；attempts=${scan.attempts}；open=${scan.openTasks}；全部未完成=${scan.unresolvedTasks}。\n\n`
  tables += '| 邮件/任务 | queued | session:turn/step | model start→end | delivered | 类别 |\n| --- | ---: | --- | --- | ---: | --- |\n'
  for (const mail of scan.mails) tables += `| ${mail.mail}/${mail.task ?? '-'} | ${mail.queuedSequence} | ${mail.session}:${mail.inputStep ? `${mail.inputStep.turn}/${mail.inputStep.step}` : '未进入任何步'} | ${mail.modelRequests.map(c => `${c.startSequence}→${c.endSequence}`).join(',')} | ${mail.deliveredSequence ?? '-'} | ${mail.category} |\n`
  tables += '\n| 节点/session | 最后 step seq (turn/step) | model.end seq/outcome | turn.end seq/reason | 工具 | 随后关联事件数 | 未处理邮件 | attempts |\n| --- | --- | --- | --- | --- | ---: | --- | ---: |\n'
  for (const node of scan.lastActions) tables += `| ${node.node}/${node.session} | ${node.lastStep.startSequence} (${node.lastStep.turn}/${node.lastStep.step}) | ${node.modelEnds.map(e => `${e.sequence}/${e.outcome}`).join(',')} | ${node.turnEnd ? `${node.turnEnd.sequence}/${node.turnEnd.reason}` : '-'} | ${node.tools.map(t => `${t.name}(${t.category})`).join(',') || '无'} | ${node.subsequentRelatedEvents.length} | ${node.unresolvedMailAtLastStepEnd.join(',') || '无'} | ${node.attempts} |\n`
  for (const category of ['preset-role-obligation', 'runtime-request']) {
    tables += `\n${category === 'preset-role-obligation' ? '预置角色义务（不独立唤醒）' : '运行期义务（本批均为拉取式 delivery）'}：\n\n| 任务 | holder/requester | 状态 | 创建 seq/时间/步数 | 最后 seq | 类型 | 排除理由 |\n| --- | --- | --- | --- | ---: | --- | --- |\n`
    for (const task of scan.tasks.filter(t => t.category === category)) tables += `| ${task.task} | ${task.holder}/${task.requester} | ${task.status} | ${task.createdSequence}/${task.createdAt}/${task.holderStepsAtCreation} | ${task.lastSequence} | ${task.taskKind} | ${task.reason} |\n`
  }
}
await writeFile(`${out}/analysis-tables.md`, tables)
console.log(JSON.stringify({ output: out, seeds: scans.map(({ seed, verdict, openTasks, inFlight, attempts }) => ({ seed, verdict, openTasks, inFlight, attempts })),
  mails: scans.reduce((n, row) => n + row.mails.length, 0), counterexample, gateComparison, archivedHashes: integrity.length, actualModelCalls: 0 }, null, 2))
