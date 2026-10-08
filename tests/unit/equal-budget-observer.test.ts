import { strict as assert } from 'node:assert'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { getEqualBudgetTask } from '../../experiments/equal-budget-task.ts'
import { installEqualBudgetObserver } from '../../experiments/equal-budget-observer.ts'

const task = getEqualBudgetTask(17, 1)
const answer = JSON.stringify({ shards: { 'shard-01': { netByAccount: { A: 1, B: 2, C: 3, D: 4 },
  countedEventCount: 1, excludedEventCount: 2, deduplicatedEventCount: 3 } } })
const alias = (session: string) => `alias:${session}`

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

test('EQUAL-OBSERVER: native queued messages require observed delivery, and replay is deduplicated', async () => {
  const ctx = new Context()
  const observer = installEqualBudgetObserver(ctx, task, alias)
  const emit = (type: string, data: unknown) => ctx.emit('session/event', {} as Session, { type, data } as SessionEvent)
  try {
    for (const document of task.documents) observer.recordRead('worker', document.id)
    emit('team/message/queued', { teamId: 'team', message: { id: 'message', senderId: 'worker', targetId: 'entry',
      content: [{ type: 'text', text: answer }] } })
    assert.equal(observer.finish(null).events.filter(event => event.kind === 'transport').length, 0)
    emit('team/message/delivered', { teamId: 'team', messageId: 'message', targetId: 'entry' })
    emit('team/message/delivered', { teamId: 'team', messageId: 'message', targetId: 'entry' })
    observer.recordSubmission('entry', answer)
    const result = observer.finish(answer)
    assert.equal(result.audit.positiveCompletionEvidence, true)
    assert.equal(result.events.filter(event => event.kind === 'transport').length, 1)
  } finally { observer.dispose(); await ctx.fiber.dispose() }
})

test('EQUAL-OBSERVER: inferred final boundary and missing native queue stay explicit audit gaps', async () => {
  const ctx = new Context()
  const observer = installEqualBudgetObserver(ctx, task, alias)
  try {
    for (const document of task.documents) observer.recordRead('entry', document.id)
    ctx.emit('session/event', {} as Session, { type: 'team/message/delivered',
      data: { teamId: 'team', messageId: 'missing', targetId: 'entry' } } as SessionEvent)
    const result = observer.finish(answer, 'entry')
    assert.equal(result.audit.positiveCompletionEvidence, false)
    assert.deepEqual(result.audit.observerErrors, ['unobserved-publication-boundary', 'submission-boundary-inferred-at-finish'])
  } finally { observer.dispose(); await ctx.fiber.dispose() }
})
