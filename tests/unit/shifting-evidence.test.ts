import { strict as assert } from 'node:assert'
import test from 'node:test'
import { createShiftingEvidenceTask, expectedChain, evaluateChain, evaluateCheckpoints, ShiftingEvidenceScenario, shiftingPrompt } from '../../experiments/shifting-evidence-task.ts'
import { summarizeShiftingRuns, type ShiftingRunObservation } from '../../experiments/shifting-evidence-protocol.ts'
import { proveTopologyBinding } from '../../experiments/topology-binding-proof.ts'
import { bindingEvidence } from '../fixtures/binding-evidence.ts'

test('shifting chain fixture changes route and root owner reproducibly without oracle strings in shared instructions', () => {
  for (const agents of [8, 16]) for (const seed of [17, 31]) {
    const task = createShiftingEvidenceTask(agents, seed)
    assert.deepEqual(task, createShiftingEvidenceTask(agents, seed))
    assert.notDeepEqual(task.phases[0].holders, task.phases[1].holders)
    assert.notEqual(task.phases[0].holders[task.rootKey], task.phases[1].holders[task.rootKey])
    const one = expectedChain(task, 1), two = expectedChain(task, 2)
    assert.equal(one.chain.length, 4); assert.equal(two.chain.length, 4)
    assert.notDeepEqual(one.chain.map(row => row.key), two.chain.map(row => row.key))
    const prompt = shiftingPrompt(task)
    for (const phase of task.phases) for (const fact of phase.facts) assert.equal(prompt.includes(fact.proof), false)
    assert.equal(evaluateChain(task, 1, JSON.stringify(one)).passed, true)
    assert.equal(evaluateChain(task, 2, JSON.stringify(one)).passed, false)
    assert.equal(evaluateChain(task, 2, JSON.stringify({ ...two, chain: [...two.chain].reverse() })).passed, false)
    assert.equal(evaluateChain(task, 2, JSON.stringify({ ...two, extra: true })).passed, false)
    assert.equal(evaluateChain(task, 2, 'Done!').passed, false)
  }
})

test('phase ACL hides other owners and stale evidence; transition does not wait for all readers or verify submitted answer', () => {
  const task = createShiftingEvidenceTask()
  const scenario = new ShiftingEvidenceScenario(task)
  const sessions = Array.from({ length: task.agents }, (_, i) => `session-${i}`)
  sessions.forEach(id => scenario.register(id))
  const oldOwner = task.phases[0].holders[task.rootKey]
  const newOwner = task.phases[1].holders[task.rootKey]
  assert.throws(() => scenario.read(sessions[newOwner], task.rootKey), /denied/)
  assert.equal(scenario.read(sessions[oldOwner], task.rootKey).documents[0].phase, 1)
  scenario.submit(1, '{"unverified":"wrong"}')
  scenario.advance('phase-1-checkpoint')
  assert.throws(() => scenario.read(sessions[oldOwner], task.rootKey), /denied/)
  assert.throws(() => scenario.read(sessions[newOwner], `phase-1:${task.rootKey}`), /denied/)
  assert.equal(scenario.read(sessions[newOwner], task.rootKey).documents[0].phase, 2)
  assert.equal(scenario.snapshot().transitionReason, 'phase-1-checkpoint')
  assert.equal(scenario.snapshot().distinctDocumentReads, 2)
  assert.equal(evaluateChain(task, 1, scenario.submissions.get(1)).passed, false)
})

test('canonical discovery hints expose identifiers only, change with phase, and do not count as evidence reads', () => {
  const scenario = new ShiftingEvidenceScenario(createShiftingEvidenceTask())
  scenario.register('local')
  const first = scenario.knowledgeHints('local')
  assert.equal(scenario.snapshot().distinctDocumentReads, 0)
  assert.deepEqual(first.contributions, [])
  assert.ok(first.topics.includes('phase-1'))
  assert.equal(JSON.stringify(first).includes('witness-'), false)
  assert.equal(JSON.stringify(first).includes('release-'), false)
  assert.deepEqual(scenario.read('local').discoveryHints, first)
  scenario.advance('test')
  assert.ok(scenario.knowledgeHints('local').topics.includes('phase-2'))
  assert.notDeepEqual(scenario.knowledgeHints('local'), first)
  assert.throws(() => scenario.knowledgeHints('unknown'), /denied/)
})

test('chain lengths are explicit and automatic advancement is disabled in the default instructions', () => {
  for (const length of [2, 3, 4]) {
    const task = createShiftingEvidenceTask(8, 17, length)
    assert.equal(expectedChain(task, 1).chain.length, length)
    assert.equal(expectedChain(task, 2).chain.length, length)
    assert.match(shiftingPrompt(task, { perNodeSteps: 48 }), /48 steps.*24 per phase/)
    assert.match(shiftingPrompt(task), /Automatic advance is disabled/)
    assert.match(shiftingPrompt(task, { autoAdvance: true }), /Automatic advance is enabled/)
    assert.match(shiftingPrompt(task), /Submit phase 1 IMMEDIATELY/)
    assert.doesNotMatch(shiftingPrompt(task), /atn_feedback|atn_publish/)
  }
  assert.throws(() => createShiftingEvidenceTask(8, 17, 1), /Chain length/)
})

test('correct phase 2 without phase 1 is a submission discipline failure, separately from an incorrect proof', () => {
  const task = createShiftingEvidenceTask()
  const missed = evaluateCheckpoints(task, new Map([[2, JSON.stringify(expectedChain(task, 2))]]))
  assert.deepEqual([missed.phase1Submitted, missed.phase1Correct, missed.phase2Submitted, missed.phase2Correct], [false, false, true, true])
  assert.equal(missed.passed, false)
  assert.equal(missed.submissionDisciplineFailure, true)
  assert.equal(missed.solvingFailure, false)
  assert.equal(missed.failureClass, 'submission-discipline')
  const wrong = evaluateCheckpoints(task, new Map([[1, '{}'], [2, '{}']]))
  assert.equal(wrong.submissionDisciplineFailure, false)
  assert.equal(wrong.solvingFailure, true)
  assert.equal(wrong.failureClass, 'incorrect-proof')
})

test('topology interpretation requires matching prior live probe, real rejection, headroom and five repeats in every arm', () => {
  const rows: ShiftingRunObservation[] = ['fixed', 'adaptive', 'no-feedback', 'no-board'].flatMap(mode => Array.from({ length: 5 }, (_, i) => ({
    runId: `${mode}-${i}`, mode, model: 'test', execution: 'live-provider', passed: i !== 0,
    phase1Submitted: true, phase1Correct: i !== 0, phase2Submitted: true, phase2Correct: i !== 0,
    purpose: 'comparison' as const, startedAt: 1000, completedAt: 2000,
    submissionDisciplineFailure: false, solvingFailure: i === 0, conditions: { seed: 17 + i, perNodeSteps: 20, agents: 8, chainLength: 2, topologyBinding: true, maxCalls: 160, timeoutMs: 30000 },
    ...bindingEvidence({ seed: 17 + i, perNodeSteps: 20, agents: 8, chainLength: 2, topologyBinding: true, maxCalls: 160, timeoutMs: 30000 }, { source: 'same' }),
    topologyProof: proveTopologyBinding(createShiftingEvidenceTask(8, 17 + i, 2, true)),
    topologyBinding: { enforced: true, refusedResults: 0, refusals: [] },
    sourceHashes: { source: 'same' }, atnTotalInteractions: 12, atnTotalTransferBytes: 100,
    meanInputTokensPerCall: null, relativeInteractions: 1, relativeTransferBytes: 1,
    protocol: { requesterFeedback: { accepted: 1, rejected: 1, needsMore: 0 }, stepUse: Array.from({ length: 8 }, (_, i) => ({ id: `node-${i}`, stepsUsed: 16 })),
      explicitRewires: [], rewireTelemetry: { statusRewireCalls: 0, successfulRewires: 0, unchangedRewires: 0,
        blockedRewires: 0, ablationBlockedRewires: 0, pendingRewires: 0, priorStatusQueryCalls: 0, callsWithPriorStatusQuery: 0 } } })))
  const probes: ShiftingRunObservation[] = rows.filter(row => row.mode === 'adaptive').map(row => ({ ...row,
    runId: `probe-${row.runId}`, purpose: 'adaptive-probe', startedAt: 1, completedAt: 100,
    protocol: { ...row.protocol!, explicitRewires: [{ id: 'rewire', changed: true }], rewireTelemetry: {
      ...row.protocol!.rewireTelemetry, statusRewireCalls: 1, successfulRewires: 1 } } }))
  assert.equal(summarizeShiftingRuns(rows, probes).mayInterpretTopology, true)
  assert.equal(summarizeShiftingRuns(rows).mayInterpretTopology, false)
  assert.equal(summarizeShiftingRuns(rows.slice(1), probes).mayInterpretTopology, false)
  assert.equal(summarizeShiftingRuns(rows.map(row => ({ ...row, execution: 'scripted-test' })), probes).mayInterpretTopology, false)
  assert.equal(summarizeShiftingRuns(rows.map((row, i) => i === 0 ? { ...row, conditions: { ...row.conditions, perNodeSteps: 32 } } : row), probes).mayInterpretTopology, false)
  assert.equal(summarizeShiftingRuns([...rows, rows[0]], probes).mayInterpretTopology, false)
  assert.equal(summarizeShiftingRuns(rows).runs.length, 20, 'failures remain in per-run details')
})
