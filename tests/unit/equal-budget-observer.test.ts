import { strict as assert } from 'node:assert'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { getEqualBudgetTask } from '../../experiments/equal-budget-task.ts'
import { installEqualBudgetObserver } from '../../experiments/equal-budget-observer.ts'

const task = getEqualBudgetTask(17, 1)
const answer = JSON.stringify({ shards: { 'shard-01': { netByAccount: { A: 1, B: 2, C: 3, D: 4 },
  countedEventCount: 1, excludedEventCount: 2, deduplicatedEventCount: 3 } } })
const alias = (session: string) => `alias:${session}`
const session = (id: string) => ({ id }) as Session
const emit = (ctx: Context, id: string, type: string, data: unknown) =>
  ctx.emit('session/event', session(id), { type, data } as SessionEvent)
const sendCall = (ctx: Context) => {
  const execution = { token: Symbol('send'), name: 'send_message', agent: { id: 'worker' },
    arguments: { agent: 'lead', message: answer } } as unknown as ToolExecution
  ctx.emit('tools/pre-execute', execution, async () => ({ kind: 'allow' as const }))
  return execution
}
const relay = () => createUserMessage({ content: [{ type: 'text', text: `Agent worker sent a message: ${answer}` }],
  source: { kind: 'agent-message', form: 'relay', senderSessionId: session('worker').id } })

test('EQUAL-OBSERVER: independent delivery and exact submission boundary retain positive witnesses', async () => {
  const ctx = new Context()
  const observer = installEqualBudgetObserver(ctx, task, alias)
  try {
    for (const document of task.documents) observer.recordRead('worker', document.id)
    observer.recordIndependent('worker', 'entry', answer)
    observer.recordSubmission('entry', answer)
    const result = observer.finish(answer)
    assert.equal(result.audit.positiveCompletionEvidence, true)
    assert.equal(result.events.at(-1)?.kind, 'transport')
    assert.equal(result.submission?.agent, 'alias:entry')
    assert.ok(result.events.every(event => event.seq < result.submission!.seq))
  } finally { observer.dispose(); await ctx.fiber.dispose() }
})

test('EQUAL-OBSERVER: current relay needs exact accepted identity plus recorded content; replay is deduplicated', async () => {
  const ctx = new Context()
  const observer = installEqualBudgetObserver(ctx, task, alias)
  try {
    for (const document of task.documents) observer.recordRead('worker', document.id)
    const execution = sendCall(ctx)
    const message = relay()
    emit(ctx, 'entry', 'user/message', message)
    assert.equal(observer.finish(null).audit.transportSendBoundaryUnknown, 1, 'a receipt alone does not establish send-time knowledge')
    ctx.emit('tools/result', execution, { isError: false, value: { messageId: message.id }, content: [] })
    emit(ctx, 'entry', 'user/message', message)
    observer.recordSubmission('entry', answer)
    const result = observer.finish(answer)
    assert.equal(result.audit.positiveCompletionEvidence, true)
    assert.equal(result.events.filter(event => event.kind === 'transport').length, 1)
    assert.deepEqual(result.audit.observerErrors, [])
  } finally { observer.dispose(); await ctx.fiber.dispose() }
})

test('EQUAL-OBSERVER: inferred final boundary and unmatched current receipt remain audit gaps', async () => {
  const ctx = new Context()
  const observer = installEqualBudgetObserver(ctx, task, alias)
  try {
    for (const document of task.documents) observer.recordRead('entry', document.id)
    emit(ctx, 'entry', 'user/message', relay())
    const result = observer.finish(answer, 'entry')
    assert.equal(result.audit.positiveCompletionEvidence, false)
    assert.deepEqual(result.audit.observerErrors, ['submission-boundary-inferred-at-finish', 'unobserved-native-publication-boundary'])
  } finally { observer.dispose(); await ctx.fiber.dispose() }
})

test('EQUAL-OBSERVER: reads after dispatch cannot ground a result delivered later', async () => {
  const ctx = new Context()
  const observer = installEqualBudgetObserver(ctx, task, alias)
  try {
    const execution = sendCall(ctx)
    for (const document of task.documents) observer.recordRead('worker', document.id)
    const message = relay()
    ctx.emit('tools/result', execution, { isError: false, value: { messageId: message.id }, content: [] })
    emit(ctx, 'entry', 'user/message', message)
    observer.recordSubmission('entry', answer)
    assert.equal(observer.finish(answer).audit.positiveCompletionEvidence, false)
  } finally { observer.dispose(); await ctx.fiber.dispose() }
})

test('EQUAL-OBSERVER: actual settlement closing text transfers results, not lifecycle or board updates', async () => {
  const ctx = new Context()
  const observer = installEqualBudgetObserver(ctx, task, alias)
  try {
    for (const document of task.documents) observer.recordRead('worker', document.id)
    emit(ctx, 'worker', 'assistant/message', { message: { content: [{ type: 'text', text: answer }] } })
    emit(ctx, 'entry', 'team/task', { teamId: 'entry', task: { id: '1', revision: 1, status: 'completed', description: answer } })
    assert.equal(observer.finish(null).events.filter(event => event.kind === 'transport').length, 0)
    const notice = createUserMessage({ content: [{ type: 'text', text: 'Its closing message:' }, { type: 'text', text: answer }],
      source: { kind: 'subagent-settled', form: 'notice', summary: 'Worker completed', stopReason: 'completed', senderSessionId: session('worker').id } })
    emit(ctx, 'entry', 'user/message', notice)
    emit(ctx, 'entry', 'user/message', notice)
    observer.recordSubmission('entry', answer)
    const result = observer.finish(answer)
    assert.equal(result.audit.positiveCompletionEvidence, true)
    assert.equal(result.events.filter(event => event.kind === 'transport').length, 1)
  } finally { observer.dispose(); await ctx.fiber.dispose() }
})

test('EQUAL-OBSERVER: suppressed settlement closing text cannot transfer an unseen final answer', async () => {
  const ctx = new Context()
  const observer = installEqualBudgetObserver(ctx, task, alias)
  try {
    for (const document of task.documents) observer.recordRead('worker', document.id)
    emit(ctx, 'worker', 'assistant/message', { message: { content: [{ type: 'text', text: answer }] } })
    emit(ctx, 'entry', 'user/message', createUserMessage({ content: [{ type: 'text', text: 'It sent you a message; its closing message is omitted.' }],
      source: { kind: 'subagent-settled', form: 'notice', summary: 'Worker completed', stopReason: 'completed', senderSessionId: session('worker').id } }))
    observer.recordSubmission('entry', answer)
    assert.equal(observer.finish(answer).audit.positiveCompletionEvidence, false)
  } finally { observer.dispose(); await ctx.fiber.dispose() }
})
