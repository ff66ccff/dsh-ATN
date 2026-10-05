/** The pilot evaluator must reject plausible but wrong artifacts without invoking a model. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { evaluatePilotTask } from '../../experiments/evaluation.ts'
import { getPilotTask, PILOT_TASK_IDS, renderTaskPrompt } from '../../experiments/tasks.ts'

const ledger = {
  netByAccount: { A: 160, B: 40 }, excludedEventIds: ['e5', 'e3'], deduplicatedEventIds: ['e4'],
  evidence: ['correction', 'events', 'orders', 'policy'],
}

test('pilot ledger rejects double counting and does not accept self-reported completion', () => {
  assert.equal(evaluatePilotTask('ledger-reconciliation', JSON.stringify(ledger)).passed, true)
  const wrong = evaluatePilotTask('ledger-reconciliation', JSON.stringify({ ...ledger, netByAccount: { A: 250, B: 40 } }))
  assert.equal(wrong.passed, false)
  assert.equal(wrong.score, 0.75)
  assert.deepEqual(wrong.checks.filter(check => !check.passed).map(check => check.name), ['netByAccount'])
  assert.equal(evaluatePilotTask('ledger-reconciliation', '{"status":"completed"}').passed, false)
  assert.equal(evaluatePilotTask('ledger-reconciliation', 'Completed; all tests pass.').error, 'invalid-json')
})

test('pilot release checks approval expiry and deterministic tie breaking independently', () => {
  const answer = {
    selected: 'eu-c', eligible: ['eu-d', 'eu-c'],
    excludedByReason: { 'us-e': 'region', 'eu-b': 'approval', 'eu-a': 'latency' },
    evidence: ['requirements', 'inventory', 'probes', 'approvals'],
  }
  assert.equal(evaluatePilotTask('release-candidate', `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``).passed, true)
  assert.equal(evaluatePilotTask('release-candidate', JSON.stringify({ ...answer, selected: 'eu-d' })).passed, false)
  assert.equal(evaluatePilotTask('release-candidate', JSON.stringify({ ...answer, eligible: ['eu-b', 'eu-c', 'eu-d'] })).passed, false)
})

test('pilot code diagnosis checks both boundaries and every required case', () => {
  const answer = {
    failingCaseIds: ['at-expiry', 'at-start'], operators: { expiry: '>', start: '>=' },
    expected: { 'before-start': false, 'at-start': true, inside: true, 'at-expiry': false, disabled: false },
    evidence: ['contract', 'implementation', 'cases'],
  }
  assert.equal(evaluatePilotTask('boundary-diagnosis', JSON.stringify(answer)).passed, true)
  assert.equal(evaluatePilotTask('boundary-diagnosis', JSON.stringify({ ...answer, operators: { expiry: '>=', start: '>' } })).passed, false)
  assert.equal(evaluatePilotTask('boundary-diagnosis', JSON.stringify({ ...answer, expected: { ...answer.expected, disabled: true } })).passed, false)
})

test('pilot output validation rejects duplicates, coercions, extra fields and ambiguous artifacts', () => {
  assert.equal(evaluatePilotTask('ledger-reconciliation', JSON.stringify({ ...ledger, evidence: [...ledger.evidence, 'policy'] })).passed, false)
  assert.equal(evaluatePilotTask('ledger-reconciliation', JSON.stringify({ ...ledger, netByAccount: { A: '160', B: 40 } })).passed, false)
  assert.equal(evaluatePilotTask('ledger-reconciliation', JSON.stringify({ ...ledger, completed: true })).passed, false)
  for (const text of ['null', '[]', '7']) assert.equal(evaluatePilotTask('ledger-reconciliation', text).error, 'answer-must-be-object')
  for (const text of ['{}\n{}', `Answer: ${JSON.stringify(ledger)}`, '```json\n{}\n```\nextra']) {
    assert.equal(evaluatePilotTask('ledger-reconciliation', text).error, 'invalid-json')
  }
  assert.equal(evaluatePilotTask('ledger-reconciliation', ' '.repeat(16_385)).error, 'answer-too-large')
})

test('pilot public task payloads are detached, reproducible and omit the oracle', () => {
  for (const id of PILOT_TASK_IDS) {
    const task = getPilotTask(id)
    assert.deepEqual(task, getPilotTask(id))
    assert.deepEqual(Object.keys(task).sort(), ['answerFormat', 'documents', 'id', 'instruction', 'revision', 'title'])
    assert.equal(new Set(task.documents.map(document => document.id)).size, task.documents.length)
    const prompt = renderTaskPrompt(task)
    for (const document of task.documents) assert.ok(prompt.includes(document.text))
    assert.doesNotMatch(prompt, /EXPECTED|evaluatePilotTask|spawn_teammate|atn_rewire|netByAccount.*160/)
  }
  const task = getPilotTask('ledger-reconciliation')
  ;(task.documents[0] as { text: string }).text = 'mutated by caller'
  assert.notEqual(getPilotTask('ledger-reconciliation').documents[0].text, 'mutated by caller')
})
