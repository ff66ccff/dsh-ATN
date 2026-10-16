/** Offline reproduction of brief section 7.3. No runtime/provider/account imports. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const parseLines = (raw: string) => raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
const directory = 'docs/execution-evidence/probe-liveness-audit-20261015'
const archive = 'docs/execution-evidence/live-probe-resumed-20261015'
const output = resolve(process.argv[2] ?? `${directory}/precondition.json`)
const codeFiles = ['src/runtime.ts', 'src/mailbox.ts', 'node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js']
const code = await Promise.all(codeFiles.map(async path => {
  const raw = await readFile(path, 'utf8')
  return { path, sha256: digest(raw), raw }
}))
const runtime = code[0].raw, mailbox = code[1].raw, loop = code[2].raw
const delivery = runtime.slice(runtime.indexOf('  async deliverMail('), runtime.indexOf('  private alreadyQueued('))
assert.ok(delivery.indexOf("if (mail.status !== 'queued') return mail.status") < delivery.indexOf('agent.send('))
assert.ok(delivery.indexOf('flushInputReceipt(agent, message)') < delivery.indexOf('markDelivered(current, mailId'))
assert.match(runtime, /const loggedBeforeFlush = this.hasLoggedInput\(agent, marker\)/)
assert.match(runtime, /if \(!this.hasLoggedInput\(agent, marker\)\) return false/)
assert.match(mailbox, /filter\(\(mail\) => mail.status === 'queued'\)/)
assert.ok(loop.indexOf('this.session.append("user/message", message') < loop.indexOf('const stream = preparedCall?.stream(request)'))

const identityFile = 'docs/execution-evidence/probe-gate-quiescence-20261015/tool-identities.json'
const identityRaw = await readFile(identityFile, 'utf8')
const identities = JSON.parse(identityRaw)
const routeRaw = await readFile(`${archive}/discovery.json`, 'utf8')
const route = JSON.parse(routeRaw)
assert.equal(route.provider, 'agy')
assert.equal(route.model, 'gemini-3.8-flash-tiered')
assert.equal(route.reasoningEffort, 'medium')
const scans = []
let exceptional: object | undefined
for (const seed of [17, 31, 45, 59, 73]) {
  const path = `${archive}/seed-${seed}-events.jsonl`
  const raw = await readFile(path, 'utf8'), events = parseLines(raw)
  const identity = identities.seeds.find((row: { seed: number }) => row.seed === seed)
  assert.equal(digest(raw), identity.eventSha256)
  const nodes = new Map(events.filter(e => e.kind === 'node.state').map(e => [e.node, e]))
  // Require a stable bijection; never equate telemetry aliases with raw node IDs.
  assert.equal(new Set([...nodes.values()].map(n => n.session)).size, nodes.size)
  for (const event of events.filter(e => e.kind === 'node.state')) assert.equal(nodes.get(event.node).session, event.session)
  const delivered = events.filter(e => e.kind === 'mail.state' && e.status === 'delivered')
  const counts = { laterInput: 0, candidateActiveWithSteps: 0, unreachable: 0 }
  const candidates = []
  for (const mail of delivered) {
    const node = nodes.get(mail.to)
    assert.ok(node)
    const atDelivery = events.filter(e => e.kind === 'node.state' && e.node === mail.to && e.sequence < mail.sequence).at(-1)
    assert.ok(atDelivery && !['retired', 'failed'].includes(atDelivery.lifecycle), 'Stop condition 7.4: terminal recipient at delivery')
    const later = events.find(e => e.session === node.session && e.sequence > mail.sequence && ['step/start', 'model.start'].includes(e.kind))
    if (later) counts.laterInput++
    else if (['retired', 'failed'].includes(node.lifecycle)) counts.unreachable++
    else {
      assert.ok(node.lifecycle === 'active' && node.stepBudget > node.stepsUsed, 'Unspecified fourth temporal category; stop')
      counts.candidateActiveWithSteps++
      candidates.push({ mail: mail.mail, task: mail.task, node: mail.to, session: node.session,
        deliveredSequence: mail.sequence, lifecycle: node.lifecycle, remainingSteps: node.stepBudget - node.stepsUsed })
      // This diagnostic is deliberately pinned to the counterexample to the brief.
      assert.equal(seed, 59)
      assert.equal(mail.mail, 'mail-10')
      const queued = events.find(e => e.kind === 'mail.state' && e.mail === mail.mail && e.status === 'queued')
      const step = events.filter(e => e.kind === 'step/start' && e.session === node.session && e.sequence < mail.sequence).at(-1)
      const stepEnd = events.find(e => e.kind === 'step/end' && e.session === node.session && e.turn === step.turn && e.step === step.step)
      const modelStart = events.find(e => e.kind === 'model.start' && e.session === node.session && e.sequence > step.sequence && e.sequence < stepEnd.sequence)
      assert.ok(queued && modelStart && stepEnd && queued.sequence < step.sequence && modelStart.sequence < mail.sequence)
      const source = identity.sources.find((s: { session: string }) => s.session === node.session)
      const sourceRaw = await readFile(source.path, 'utf8')
      assert.equal(digest(sourceRaw), source.sha256)
      const rows = parseLines(sourceRaw)
      const sourceStep = rows.filter(e => e.type === 'step/start' && e.time === step.at && e.data.turn === step.turn && e.data.step === step.step)
      assert.equal(sourceStep.length, 1)
      const sourceEnd = rows.find(e => e.type === 'step/end' && e.data.turn === step.turn && e.data.step === step.step)
      // Identify the only result receipt for this recipient in this queue/receipt interval.
      // Save neither message text, raw identifiers, arguments nor provider response text.
      const receipts = rows.filter(e => e.type === 'user/message' && e.data.source?.kind === 'atn'
        && e.time >= queued.at && e.time <= mail.at && e.data.content?.some((b: { type: string; text?: string }) =>
          b.type === 'text' && b.text?.startsWith('[ATN result]') && b.text.split('\n')[0].includes(' mail=')))
      assert.equal(receipts.length, 1, 'Receipt ambiguous; stop rather than guess')
      const receipt = receipts[0]
      assert.ok(receipt.seq > sourceStep[0].seq && receipt.seq < sourceEnd.seq && receipt.time <= modelStart.at)
      const possibleMails = delivered.filter(e => e.to === mail.to && e.messageKind === 'result' && e.at >= receipt.time
        && events.find(q => q.kind === 'mail.state' && q.mail === e.mail && q.status === 'queued')?.at <= receipt.time)
      assert.equal(possibleMails.length, 1, 'Overlapping mail receipt intervals; stop')
      assert.equal(possibleMails[0].mail, mail.mail)
      const modelEnd = events.find(e => e.kind === 'model.end' && e.call === modelStart.call)
      const turnEnd = events.find(e => e.kind === 'turn/end' && e.session === node.session && e.turn === step.turn)
      assert.ok(modelEnd && turnEnd)
      exceptional = { seed, ...candidates.at(-1), queuedSequence: queued.sequence,
        stepStartSequence: step.sequence, modelStartSequence: modelStart.sequence,
        modelEndSequence: modelEnd.sequence, modelEndStatus: modelEnd.status,
        stepEndSequence: stepEnd.sequence, turnEndSequence: turnEnd.sequence, turnEndReason: turnEnd.reason,
        source: { path: source.path, sha256: digest(sourceRaw), stepSourceSeq: sourceStep[0].seq,
          receiptSourceSeq: receipt.seq, receiptTime: receipt.time },
        finding: 'The only temporal candidate already received this mail in its final model step. No subsequent step is required by deliverMail for a delivered receipt.' }
    }
  }
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), delivered.length)
  if (seed === 17) assert.equal(delivered.length, 11)
  scans.push({ seed, path, sha256: digest(raw), delivered: delivered.length, temporalCountsOnly: counts, candidates,
    verdict: 'not-issued: section-7.3-precondition-stop' })
}
assert.ok(exceptional)
const planRaw = await readFile(`${archive}/plan.json`, 'utf8'), plan = JSON.parse(planRaw)
assert.deepEqual(plan.sourceHashes, JSON.parse(await readFile('docs/execution-evidence/agy-model-20261015/plan.json', 'utf8')).sourceHashes)
const hashes = []
for (const [file, expected] of Object.entries(plan.sourceHashes)) {
  const actual = digest(await readFile(resolve('experiments', file)))
  assert.equal(actual, expected, `Frozen source changed: ${file}`)
  hashes.push({ file, expected, actual })
}
assert.equal(hashes.length, 37)
for (const seed of [17, 31, 45, 59, 73]) for (const suffix of ['manifest', 'report']) {
  assert.deepEqual(JSON.parse(await readFile(`${archive}/seed-${seed}-${suffix}.json`, 'utf8')).sourceHashes, plan.sourceHashes)
}
const result = { status: 'stopped', briefStopCondition: '7.3', execution: 'offline-zero-model',
  actualModelCalls: 0, accountReads: 0, networkAccess: false, providerLoaded: false,
  route: { provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort },
  code: code.map(({ raw: _raw, ...source }) => source),
  identitySource: { path: identityFile, sha256: digest(identityRaw) }, scans, exceptional,
  reason: 'Code wakes/replays queued mail awaiting logged input, not delivered mail already durably logged. The demanded delivered-only positive control does not establish an unfulfilled wake obligation. Manufacturing that verdict would broaden the code-derived definition.',
  controls: { mechanismGap: 'not-established; stopped rather than broaden wake eligibility',
    noWakeEligibleWork: 'not-certified as a classifier control; no binary classifier delivered' },
  integrity: { archivedSourceHashCount: hashes.length, hashes },
  incomplete: ['binary classifier and two constructive controls', 'full task/last-action audit', 'sum gate comparison',
    'flaky test reproduction', 'npm test/typecheck/build/pack; not run after mandatory precondition stop'] }
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify({ status: result.status, briefStopCondition: result.briefStopCondition, output,
  scans: scans.map(({ seed, delivered, temporalCountsOnly }) => ({ seed, delivered, temporalCountsOnly })),
  exceptional, archivedSourceHashCount: hashes.length, actualModelCalls: 0 }, null, 2))
