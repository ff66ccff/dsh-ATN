import { strict as assert } from 'node:assert'
import test from 'node:test'
import { SessionSeq, type SessionEventMap, type SessionEventType } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, ToolCallId, type ContentBlock, type FinishReason } from '@deepseek-ai/dsh-llm'
import { extractFinalTextSubmission, type SubmissionEvent } from '../../experiments/submission.ts'

function trace() {
  const events: SubmissionEvent[] = []
  function add<T extends SessionEventType>(type: T, data: SessionEventMap[T]): void {
    // The generic type/data pair enforces the public event schema; TS cannot distribute this object over its union.
    events.push({ type, data, seq: SessionSeq(events.length) } as SubmissionEvent)
  }
  function start(turn = 1, step = 1): void { add('turn/start', { turn }); add('step/start', { turn, step }) }
  function message(answer: string, options: { turn?: number; step?: number; content?: ContentBlock[]; finish?: FinishReason; interrupted?: true } = {}): void {
    add('assistant/message', {
      turn: options.turn ?? 1, step: options.step ?? 1,
      message: createAssistantMessage({ source: { provider: 'fixture', model: 'fixture' }, content: options.content ?? [{ type: 'text', text: answer }] }),
      stream: [{ type: 'chunk', time: 1, chunk: { type: 'finish', reason: options.finish ?? { kind: 'stop' } } }],
      ...(options.interrupted ? { interrupted: true } : {}),
    })
  }
  function end(turn = 1, step = 1, reason: SessionEventMap['turn/end']['reason'] = { kind: 'completed' }): void {
    add('step/end', { turn, step }); add('turn/end', { turn, reason })
  }
  return { events, add, start, message, end }
}

test('SUBMISSION-01: final visible JSON is accepted without a submit tool and reasoning is never the answer', () => {
  const run = trace(); run.start()
  run.message('', { content: [{ type: 'reasoning', text: '{"private":"draft"}' }, { type: 'text', text: '{"final":true}' }] })
  run.end()
  const result = extractFinalTextSubmission(run.events, { afterSeq: -1 })
  assert.ok(result.accepted)
  assert.equal(result.answer, '{"final":true}')
  assert.equal(result.turn, 1)
})

test('SUBMISSION-02: a completed empty new turn cannot resurrect an old answer', () => {
  const run = trace(); run.start(); run.message('{"old":true}'); run.end()
  run.start(2); run.end(2)
  assert.deepEqual(extractFinalTextSubmission(run.events, { afterSeq: -1 }), { accepted: false, reason: 'no-final-message' })
})

test('SUBMISSION-03: aborted, failed, open and token-limited latest turns never fall back to old success', () => {
  for (const reason of [
    { kind: 'aborted', reason: { kind: 'user' } }, { kind: 'error', error: { code: 'X', message: 'failure' } },
    { kind: 'max-tokens' }, { kind: 'blocked' }, { kind: 'interrupted' },
  ] satisfies SessionEventMap['turn/end']['reason'][]) {
    const run = trace(); run.start(); run.message('{"old":true}'); run.end()
    run.start(2); run.message('{"new":true}', { turn: 2 }); run.end(2, 1, reason)
    assert.deepEqual(extractFinalTextSubmission(run.events, { afterSeq: -1 }), { accepted: false, reason: 'turn-not-completed' })
  }
  const run = trace(); run.start(); run.message('{"old":true}'); run.end(); run.start(2)
  assert.equal(extractFinalTextSubmission(run.events, { afterSeq: -1 }).accepted, false)
})

test('SUBMISSION-04: interrupted, tool-calling, failed-stream and reasoning-only settlements are not final submissions', () => {
  const cases = [
    { interrupted: true as const },
    { content: [{ type: 'reasoning' as const, text: '{"draft":true}' }] },
    { content: [{ type: 'text' as const, text: '{"draft":true}' }, { type: 'tool-call' as const, id: ToolCallId('call'), name: 'tool', arguments: '{}' }] },
    { finish: { kind: 'tool-calls' as const } },
    { finish: { kind: 'error' as const, failure: { code: 'X', message: 'failed' } } },
    { finish: { kind: 'max-tokens' as const } },
  ]
  for (const options of cases) {
    const run = trace(); run.start(); run.message('{"answer":true}', options); run.end()
    assert.equal(extractFinalTextSubmission(run.events, { afterSeq: -1 }).accepted, false)
  }
})

test('SUBMISSION-05: a newer empty or failed final step prevents fallback to a previous step', () => {
  for (const attempted of [true, false]) {
    const run = trace(); run.start(); run.message('{"draft":true}')
    run.add('step/end', { turn: 1, step: 1 }); run.add('step/start', { turn: 1, step: 2 })
    if (attempted) run.add('assistant/attempt', { turn: 1, step: 2, stream: [] })
    run.end(1, 2)
    assert.equal(extractFinalTextSubmission(run.events, { afterSeq: -1 }).accepted, false)
  }
})

test('SUBMISSION-06: selection is chronological even when the latest answer is invalid JSON', () => {
  const run = trace(); run.start(); run.message('{"plausible":true}'); run.end()
  run.start(2); run.message('invalid final answer', { turn: 2 }); run.end(2)
  const result = extractFinalTextSubmission(run.events, { afterSeq: -1 })
  assert.ok(result.accepted)
  assert.equal(result.answer, 'invalid final answer', 'the oracle must grade this final answer, never an earlier candidate')
})

test('SUBMISSION-07: run boundary, byte bound and completed step are required', () => {
  const run = trace(); run.start(); run.message('中文字'); run.end()
  assert.deepEqual(extractFinalTextSubmission(run.events, { afterSeq: run.events.at(-1)!.seq }), { accepted: false, reason: 'no-current-turn' })
  assert.deepEqual(extractFinalTextSubmission(run.events, { afterSeq: -1, maxBytes: 8 }), { accepted: false, reason: 'answer-too-large' })
  const incomplete = trace(); incomplete.start(); incomplete.message('{}'); incomplete.add('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.deepEqual(extractFinalTextSubmission(incomplete.events, { afterSeq: -1 }), { accepted: false, reason: 'step-not-completed' })
})
