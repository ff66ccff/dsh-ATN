import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { classifyMail, establishSemantics, verdict } from '../../experiments/probe-liveness-audit-v2.ts'

const auditPath = 'docs/execution-evidence/probe-liveness-audit-v2-20261015/audit.json'
test('LIVENESS-V2: archived five-seed support, regression and declared replay conditions', async () => {
  const audit = JSON.parse(await readFile(auditPath, 'utf8'))
  const gate = await establishSemantics()
  assert.equal(audit.semantics.sha256, gate.sha256)
  assert.deepEqual(audit.scans.map((s: any) => s.seed), [17, 31, 45, 59, 73])
  assert.equal(audit.scans.flatMap((s: any) => s.mails).length, 61)
  const counterexample = audit.scans.find((s: any) => s.seed === 59).mails.find((m: any) => m.mail === 'mail-10')
  assert.equal(counterexample.category, 'normal-receipt')
  assert.equal(counterexample.defect, false)
  assert.equal(counterexample.delayedInSameStep, true)
  assert.deepEqual([counterexample.inputStep.turn, counterexample.inputStep.step], [2, 3])
  for (const scan of audit.scans) {
    assert.equal(scan.verdict, verdict(gate, scan.mails))
    assert.equal(scan.inFlight.present, false)
    assert.equal(scan.lastActions.reduce((n: number, row: any) => n + row.attempts, 0), scan.attempts)
    assert.equal(scan.openTasks, scan.tasks.filter((t: any) => t.status === 'open').length)
    assert.ok(scan.tasks.every((t: any) => !t.wakeEligible && t.reason && t.trigger))
    assert.ok(scan.mails.every((m: any) => m.category === 'unreachable'
      ? m.inputStep === null && m.terminalAtDelivery && !m.defect
      : m.inputStep && m.uniqueness.receiptMatches === 1 && m.uniqueness.reverseMailMatches === 1))
  }
  assert.equal(audit.replay.ciReplayableFromTrackedFiles, false)
  assert.equal(audit.replay.option, '4.6(b)')
  assert.equal(audit.replay.requiredFiles.filter((p: string) => p.endsWith('session.v4.jsonl')).length, 40)
  assert.equal(audit.replay.requiredFiles.filter((p: string) => p.endsWith('atn_networks.json')).length, 5)
  assert.ok(audit.replay.acquisition && audit.replay.limitation)
  assert.equal(audit.integrity.length, 37)
  assert.equal(audit.gateComparison.quantilePolicyChanged, false)
  const comparison = audit.gateComparison
  assert.equal(comparison.sum.requiredDeadlineMs, Math.ceil(68 * comparison.meanMs + comparison.tailReserveMs + comparison.hostReserveMs))
  assert.equal(comparison.p90.requiredDeadlineMs, 68 * comparison.p90Ms + comparison.hostReserveMs)
  assert.equal(comparison.differenceMs, comparison.p90.requiredDeadlineMs - comparison.sum.requiredDeadlineMs)
})

test('LIVENESS-V2: fault categories remain exclusive, including simultaneous missing request/receipt', async () => {
  const gate = await establishSemantics()
  for (const modelStarted of [false, true]) for (const delivered of [false, true]) {
    const facts = { mail: 'mail', input: true, modelStarted, delivered, terminalAtDelivery: false }
    const classification = classifyMail(gate, facts)
    assert.equal(classification.category, !modelStarted ? 'input-without-model' : !delivered ? 'receipt-missing' : 'normal-receipt')
  }
  assert.throws(() => classifyMail(gate, { mail: 'mail', input: false, modelStarted: false, delivered: true, terminalAtDelivery: false }), /7.4/)
  assert.throws(() => classifyMail(gate, { mail: 'mail', input: false, modelStarted: false, delivered: false, terminalAtDelivery: false }), /7.1/)
})
