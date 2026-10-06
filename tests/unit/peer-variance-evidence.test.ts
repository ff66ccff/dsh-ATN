import { strict as assert } from 'node:assert'
import test from 'node:test'
import * as evidence from '../../experiments/shifting-evidence-task.ts'

test('PEER-01: fixed slots hold independently readable stale same-key copies in both phases', () => {
  for (const agents of [8, 16]) for (const seed of [17, 31, 45, 59, 73]) {
    const task = evidence.createShiftingEvidenceTask(agents, seed, 2)
    const duplicate = evidence.createShiftingEvidenceTask(agents, seed, 2)
    assert.deepEqual(task.phases.map(row => row.staleHolders), duplicate.phases.map(row => row.staleHolders))
    const scenario = new evidence.ShiftingEvidenceScenario(task)
    const sessions = Array.from({ length: agents }, (_, i) => `slot-${i}`)
    sessions.forEach(id => scenario.register(id))
    for (const phase of [1, 2] as const) {
      if (phase === 2) scenario.advance('phase-1-checkpoint')
      const snapshot = task.phases[phase - 1]
      const staleSlot = snapshot.staleHolders[task.rootKey]
      assert.equal(staleSlot, phase === 1 ? 1 : agents - 1, 'stale identities stay fixed across seeds')
      assert.notEqual(staleSlot, snapshot.holders[task.rootKey])
      const stale = scenario.read(sessions[staleSlot], task.rootKey).documents
      const current = scenario.read(sessions[snapshot.holders[task.rootKey]], task.rootKey).documents
      assert.equal(stale.length, 1)
      assert.equal(current.length, 1)
      assert.equal(evidence.validateRequestedEvidence(stale[0], { phase, key: task.rootKey }).status, 'rejected')
      assert.equal(evidence.validateRequestedEvidence(current[0], { phase, key: task.rootKey }).status, 'accepted')
      assert.ok(scenario.knowledgeHints(sessions[staleSlot]).topics.includes(task.rootKey))
      assert.ok(scenario.knowledgeHints(sessions[snapshot.holders[task.rootKey]]).topics.includes(task.rootKey))
      assert.deepEqual(scenario.read(sessions[staleSlot], task.rootKey).documents, stale, 'retries return the same evidence, no per-query randomness')
    }
  }
})

test('PEER-02: requester-local validation enumerates observable rejection criteria', () => {
  const task = evidence.createShiftingEvidenceTask()
  const fact = task.phases[0].facts.find(row => row.key === task.rootKey)!
  const request = { phase: 1 as const, key: task.rootKey }
  assert.deepEqual(evidence.validateRequestedEvidence(fact, request), { status: 'accepted', reasons: [] })
  const changes: Array<[unknown, string]> = [
    [{ ...fact, phase: 2 }, 'phase-mismatch'], [{ ...fact, version: 0 }, 'version-mismatch'],
    [{ ...fact, key: 'another-key' }, 'key-mismatch'],
    [Object.fromEntries(Object.entries(fact).filter(([key]) => key !== 'proof')), 'missing-field:proof'],
    [{ ...fact, proof: '' }, 'invalid-field:proof'], [{ ...fact, next: null, terminal: null }, 'invalid-field:terminal'],
  ]
  for (const [value, reason] of changes) {
    const result = evidence.validateRequestedEvidence(value, request)
    assert.equal(result.status, 'rejected')
    assert.ok(result.reasons.includes(reason), reason)
  }
  const prompt = evidence.shiftingPrompt(task)
  for (const criterion of ['phase/version mismatch', 'missing required fields', 'wrong requested key']) assert.ok(prompt.includes(criterion), criterion)
  assert.match(prompt, /atn_status\(query=.*atn_status\(rewire=/s)
  assert.match(prompt, /full desired.*peer list/)
  assert.doesNotMatch(prompt, /baselineTaskIds|candidateTaskIds/)
})

test('PEER-05: shared workflow assigns default entry/helper work and preserves exact obsolete replies', () => {
  const prompt = evidence.shiftingPrompt(evidence.createShiftingEvidenceTask())
  assert.match(prompt, /entry.*assembles the ordered chain/i)
  assert.match(prompt, /helpers.*once per phase/i)
  assert.match(prompt, /explicitly assigned.*fragment/i)
  assert.match(prompt, /no assigned work.*end the current turn.*wait/i)
  assert.match(prompt, /do not independently search the full chain|avoid unsolicited full-chain search/i)
  assert.match(prompt, /own exact local copy even if.*phase\/version.*obsolete/i)
  assert.match(prompt, /do not fetch or invent a replacement.*explicitly asks.*named holder/i)
  assert.match(prompt, /original target.*requested phase\/version.*key.*visited/i)
  assert.doesNotMatch(prompt, /may choose their own roles/)
})
