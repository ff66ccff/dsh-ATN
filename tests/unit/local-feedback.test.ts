/** Intrinsic feedback stays useful without a validator and never manufactures acceptance. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import {
  captureRewireObservations, materialFingerprint, MAX_LOCAL_FEEDBACK_TASKS,
  refreshRewireObservations, summarizeLocalFeedback,
} from '../../src/local-feedback.ts'
import { networkRecordSchema, nodeRecordSchema, taskRecordSchema, type NetworkRecord } from '../../src/schema.ts'
import { topologyFeedbackMessage } from '../../src/topology-feedback.ts'
import { evaluateRewireEvidence } from '../../src/verified-feedback.ts'
import { makeChain, makeNode, makeTask } from '../fixtures/network.ts'

function text(message: UserMessage | undefined): string {
  assert.ok(message)
  return message.content.map(part => part.type === 'text' ? part.text : '').join('\n')
}

function appendRewire(record: NetworkRecord, id: string, at: number, nextPeers: string[]): NetworkRecord {
  const previousPeers = ['B']
  return {
    ...record,
    rewireHistory: [...(record.rewireHistory ?? []), {
      id, nodeId: 'A', createdAt: at, previousPeers, nextPeers, intent: 'exploration',
      evaluation: evaluateRewireEvidence(record, {
        requesterId: 'A', previousPeers, nextPeers, baselineTaskIds: [], candidateTaskIds: [],
      }),
      observations: captureRewireObservations(record, 'A', previousPeers, nextPeers, at),
    }],
  }
}

test('intrinsic feedback observes declared outcomes, local latency, steps, retries and downstream failures without acceptance', () => {
  const record = makeChain(['A', 'B', 'C', 'D'])
  record.nodes.B.stepsUsed = 9
  record.nodes.C.lifecycle = 'failed'
  record.tasks = {
    done: makeTask('done', { status: 'completed', createdAt: 100, settledAt: 140,
      holderStepsAtCreation: 2, holderStepsAtSettlement: 4, result: { summary: 'declared result', evidence: [] } }),
    open: makeTask('open', { createdAt: 110, holderStepsAtCreation: 5 }),
    failed: makeTask('failed', { status: 'failed', createdAt: 120, settledAt: 150, holderStepsAtCreation: 4, holderStepsAtSettlement: 5 }),
    lost: makeTask('lost', { status: 'unreachable', createdAt: 100, settledAt: 180, holderStepsAtCreation: 0, holderStepsAtSettlement: 6 }),
    old: makeTask('old', { holderId: 'C', status: 'unreachable', settledAt: 150 }),
    retry: makeTask('retry', { retryOf: 'old', createdAt: 180, holderStepsAtCreation: 8 }),
    downstream: makeTask('downstream', { holderId: 'D', status: 'failed', dependsOn: ['done', 'lost'], settledAt: 160 }),
    foreign: makeTask('foreign', { requesterId: 'D', status: 'completed', settledAt: 200 }),
    foreignDownstream: makeTask('foreignDownstream', { requesterId: 'D', holderId: 'D', status: 'failed', dependsOn: ['done'], settledAt: 210 }),
  }
  const summary = summarizeLocalFeedback(record, 'B', { observerId: 'A', now: 200 })
  assert.equal(summary.source, 'runtime')
  assert.equal(summary.assigned, 5)
  assert.equal(summary.open, 2)
  assert.equal(summary.completed, 1, 'declared completion is observable without inventing a verified pass')
  assert.equal(summary.failed, 1)
  assert.equal(summary.unreachable, 1)
  assert.equal(summary.retries, 1)
  assert.equal(summary.recoveries, 1)
  assert.equal(summary.downstreamFailures, 1, 'one local failed dependent is counted once even with two dependencies')
  assert.equal(summary.stepsUsed, 9)
  assert.equal(summary.stepsRemaining, record.limits.stepBudget - 9)
  assert.ok(Math.abs(summary.meanLatencyMs! - 50) < 1e-10)
  assert.equal(summary.meanHolderSteps, 3)
  assert.deepEqual(summary.observations.find(row => row.taskId === 'open'), {
    taskId: 'open', status: 'open', elapsedMs: 90, latencyMs: null, holderSteps: 4,
    retryOf: null, recovery: false, downstreamFailures: 0,
  })
  assert.equal(record.tasks.done.acceptance, undefined)
  assert.ok(!('passRate' in summary), 'runtime declarations must not be labeled success rates')
})

test('feedback is bounded, deterministically ordered and preserves unknown legacy measurements', () => {
  const record = makeChain(['A', 'B'])
  for (let index = 0; index < 20; index += 1) {
    const id = `task-${index.toString().padStart(2, '0')}`
    record.tasks[id] = makeTask(id, { status: 'completed', createdAt: 5, settledAt: 10 })
  }
  const first = summarizeLocalFeedback(record, 'B', { now: 20, maxTasks: 100 })
  const reordered = { ...record, tasks: Object.fromEntries(Object.entries(record.tasks).reverse()) }
  assert.deepEqual(summarizeLocalFeedback(reordered, 'B', { now: 20, maxTasks: Number.NaN }), first)
  assert.equal(first.assigned, 20)
  assert.equal(first.observations.length, MAX_LOCAL_FEEDBACK_TASKS)
  assert.equal(first.omittedTasks, 12)
  assert.equal(first.stepsUsed, null)
  assert.equal(first.stepsRemaining, null)
  assert.equal(first.meanHolderSteps, null)
  assert.equal(first.meanLatencyMs, 5)
  assert.ok(first.observations.every(row => row.holderSteps === null))
  record.nodes.B.stepsUsed = 1
  record.tasks['task-00'] = { ...record.tasks['task-00'], holderStepsAtCreation: 10, holderStepsAtSettlement: 5 }
  assert.equal(summarizeLocalFeedback(record, 'B').observations[0].holderSteps, null, 'inconsistent counters are unknown, not negative cost')
})

test('only terminal outcomes replay feedback; peer steps, task ages and open work do not', () => {
  const record = makeChain(['A', 'B'])
  record.nodes.A.stepsUsed = 2
  record.nodes.B.stepsUsed = 3
  record.tasks.t = makeTask('t', { createdAt: 100, holderStepsAtCreation: 1 })
  const initial = topologyFeedbackMessage(record, 'A', [], 130)
  assert.match(text(initial), /Runtime telemetry/)
  assert.match(text(initial), /elapsed=30ms/)
  assert.doesNotMatch(text(initial), /steps=|remaining=/)
  const events = [{ type: 'user/message', data: initial }]
  record.nodes.A.stepsUsed = 20
  assert.equal(topologyFeedbackMessage(record, 'A', events, 200), undefined, 'wall time and own input steps are not feedback changes')
  const early = summarizeLocalFeedback(record, 'B', { now: 130 })
  const late = summarizeLocalFeedback(record, 'B', { now: 200 })
  assert.notEqual(early.observations[0].elapsedMs, late.observations[0].elapsedMs)
  assert.equal(materialFingerprint([early]), materialFingerprint([late]))
  record.nodes.B.stepsUsed = 4
  assert.equal(topologyFeedbackMessage(record, 'A', events, 200), undefined)
  record.tasks.another = makeTask('another', { createdAt: 210 })
  assert.equal(topologyFeedbackMessage(record, 'A', events, 220), undefined, 'open task changes are not material')
  record.tasks.t = { ...record.tasks.t, status: 'failed', settledAt: 240, holderStepsAtSettlement: 4 }
  assert.match(text(topologyFeedbackMessage(record, 'A', events, 250)), /failed=1/)
  assert.equal(events.length, 1, 'reading feedback never acknowledges it; only the session log does')
})

test('material fingerprint ignores ordering, continuous metrics and open task eviction', () => {
  const record = makeChain(['A', 'B', 'C'])
  record.tasks.done = makeTask('done', { status: 'completed', settledAt: 10 })
  const initial = summarizeLocalFeedback(record, 'B', { observerId: 'A', now: 20 })
  for (let index = 0; index < MAX_LOCAL_FEEDBACK_TASKS; index++) {
    record.tasks[`open-${index}`] = makeTask(`open-${index}`, { createdAt: 30 + index })
  }
  record.nodes.B.stepsUsed = 20
  const current = summarizeLocalFeedback(record, 'B', { observerId: 'A', now: 100 })
  assert.equal(current.observations.some(row => row.taskId === 'done'), false)
  assert.equal(materialFingerprint([initial]), materialFingerprint([current]))
  const other = summarizeLocalFeedback(record, 'C')
  assert.equal(materialFingerprint([current, other]), materialFingerprint([other, current]))
  assert.equal(materialFingerprint([current]), materialFingerprint([{ ...current, meanLatencyMs: 999, meanHolderSteps: 999 }]))
  for (const key of ['completed', 'failed', 'unreachable', 'retries', 'recoveries', 'downstreamFailures'] as const) {
    assert.notEqual(materialFingerprint([current]), materialFingerprint([{ ...current, [key]: current[key] + 1 }]), key)
  }
  assert.notEqual(materialFingerprint([current]), materialFingerprint([{ ...current, lifecycle: 'draining' }]))
  assert.notEqual(materialFingerprint([current]), materialFingerprint([{ ...current, terminalTaskIds: ['different-task'] }]))
})

test('material changes merge across three admitted steps and only accepted snapshots advance the window', () => {
  const record = makeChain(['A', 'B'])
  record.nodes.A.stepsUsed = 5
  const initial = topologyFeedbackMessage(record, 'A', [])
  const events = [{ type: 'user/message', data: initial }]
  record.nodes.A.stepsUsed = 6
  record.tasks.one = makeTask('one', { status: 'completed', settledAt: 10 })
  assert.equal(topologyFeedbackMessage(record, 'A', events), undefined)
  record.nodes.A.stepsUsed = 7
  record.tasks.two = makeTask('two', { status: 'failed', settledAt: 20 })
  assert.equal(topologyFeedbackMessage(record, 'A', events), undefined)
  record.tasks.three = makeTask('three', { status: 'unreachable', settledAt: 30 })
  assert.equal(topologyFeedbackMessage(record, 'A', events), undefined)
  record.nodes.A.stepsUsed = 8
  const merged = topologyFeedbackMessage(record, 'A', events)
  assert.match(text(merged), /completed=1, failed=1, unreachable=1/)
  assert.ok(topologyFeedbackMessage(record, 'A', events), 'generating a rejected snapshot does not consume the interval')
  events.push({ type: 'user/message', data: merged })
  record.nodes.A.stepsUsed = 9
  record.nodes.B.lifecycle = 'retired'
  assert.equal(topologyFeedbackMessage(record, 'A', events), undefined)
  record.nodes.A.stepsUsed = 11
  const departed = topologyFeedbackMessage(record, 'A', events)
  assert.match(text(departed), /Removed: B \(retired\)/)
  events.push({ type: 'user/message', data: departed })
  record.nodes.A.stepsUsed = 14
  assert.equal(topologyFeedbackMessage(record, 'A', events), undefined)
})

test('legacy graph snapshots upgrade telemetry once and foreign snapshots do not acknowledge local input', () => {
  const record = makeChain(['A', 'B'])
  const legacy = createUserMessage({ content: [{ type: 'text', text: 'legacy' }], source: {
    kind: 'atn', form: 'snapshot', sections: [{ name: 'atn/topology-snapshot', text: JSON.stringify({ networkId: record.id, nodeId: 'A', peers: ['B'] }) }],
  } })
  const upgraded = topologyFeedbackMessage(record, 'A', [{ type: 'user/message', data: legacy }], 100)
  assert.doesNotMatch(text(upgraded), /Initial neighbours/)
  assert.match(text(upgraded), /Runtime telemetry/)
  assert.equal(topologyFeedbackMessage(record, 'A', [{ type: 'user/message', data: upgraded }], 200), undefined)
  assert.ok(topologyFeedbackMessage(record, 'B', [{ type: 'user/message', data: upgraded }], 200))
})

test('rewire observations refresh automatically, preserve frozen baselines and stop when superseded', () => {
  let record = makeChain(['A', 'B', 'C'])
  record.nodes.B.stepsUsed = 5
  record.nodes.C.stepsUsed = 0
  record.tasks.baseline = makeTask('baseline', { status: 'failed', settledAt: 5, holderStepsAtCreation: 0, holderStepsAtSettlement: 5 })
  record = appendRewire(record, 'rewire-1', 10, ['C'])
  const baseline = structuredClone(record.rewireHistory![0].observations!.before)
  const originalHistory = record.rewireHistory
  record.tasks.candidate = makeTask('candidate', { holderId: 'C', createdAt: 11, holderStepsAtCreation: 0 })
  record.nodes.C.stepsUsed = 2
  record = refreshRewireObservations(record, 15)
  assert.notEqual(record.rewireHistory, originalHistory)
  assert.deepEqual(record.rewireHistory![0].observations!.before, baseline)
  assert.equal(record.rewireHistory![0].observations!.after.peers[0].open, 1)
  assert.equal(record.rewireHistory![0].observations!.after.peers[0].stepsUsed, 2)
  assert.equal(record.rewireHistory![0].observations!.causalClaim, false)
  assert.equal(refreshRewireObservations(record, 20), record, 'time alone does not create durable rewrites')
  const frozen = structuredClone(record.rewireHistory![0])
  record = appendRewire(record, 'rewire-2', 21, ['B'])
  record.nodes.C.stepsUsed = 9
  record.nodes.B.stepsUsed = 7
  record = refreshRewireObservations(record, 25)
  assert.deepEqual(record.rewireHistory![0], frozen)
  assert.equal(record.rewireHistory![1].observations!.after.peers[0].stepsUsed, 7)
  assert.deepEqual(networkRecordSchema.parse(record).rewireHistory, record.rewireHistory)
})

test('schema preserves legacy records and step counters, with no arbitrary 64-rewire cap', () => {
  assert.equal(nodeRecordSchema.parse(makeNode('B')).stepsUsed, undefined)
  assert.equal(nodeRecordSchema.parse(makeNode('B', { stepsUsed: 2 })).stepsUsed, 2)
  assert.throws(() => nodeRecordSchema.parse(makeNode('B', { stepsUsed: -1 })))
  assert.equal(taskRecordSchema.parse(makeTask('t')).holderStepsAtCreation, undefined)
  assert.equal(taskRecordSchema.parse(makeTask('t', { holderStepsAtCreation: 2, holderStepsAtSettlement: 6 })).holderStepsAtSettlement, 6)
  let record = appendRewire(makeChain(['A', 'B', 'C']), 'r', 0, ['C'])
  record = { ...record, rewireHistory: Array.from({ length: 65 }, (_, index) => ({ ...record.rewireHistory![0], id: `r-${index}` })) }
  assert.equal(networkRecordSchema.parse(record).rewireHistory!.length, 65)
  const legacy = { ...record, rewireHistory: [{ ...record.rewireHistory![0], observations: undefined }] }
  assert.equal(refreshRewireObservations(legacy, 100), legacy)
})
