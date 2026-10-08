import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, settle } from '../fixtures/kernel.ts'
import { getEqualBudgetTask } from '../../experiments/equal-budget-task.ts'
import { installEqualBudgetObserver } from '../../experiments/equal-budget-observer.ts'

test('EQUAL-OBSERVER: real ATN mail and status deliveries preserve authenticated sender and publication order', async () => {
  for (const channel of ['mail', 'status'] as const) {
    const scratch = await mkdtemp(join(tmpdir(), 'atn-equal-observer-'))
    const kernel = await bootKernel(scratch)
    const task = getEqualBudgetTask(31, 1)
    const answer = JSON.stringify({ shards: { 'shard-01': { netByAccount: { A: 1, B: 2, C: 3, D: 4 },
      countedEventCount: 1, excludedEventCount: 2, deduplicatedEventCount: 3 } } })
    const observer = installEqualBudgetObserver(kernel.ctx, task, session => session)
    try {
      const entry = await createHostAgent(kernel, `audit-${channel}`)
      const started = await kernel.atn.start(entry, { objective: 'Audit source paths.',
        successCriteria: 'Observed delivery is grounded in source reads.', constraints: 'Scripted fixture only.' })
      const born = await kernel.atn.spawn(entry, { task: 'Read shard sources and return a result.', context: '' })
      await settle(kernel)
      const worker = kernel.ctx.agents.get(SessionId(born.sessionId))!
      for (const document of task.documents) observer.recordRead(worker.id, document.id)
      if (channel === 'mail') {
        await kernel.atn.send(worker, { to: started.nodeId, kind: 'note', body: answer })
        await kernel.atn.tick()
        await settle(kernel)
      } else {
        await kernel.atn.send(worker, { to: started.nodeId, kind: 'result', taskId: born.taskId,
          body: 'Shard result.', summary: answer, evidence: [] })
        const result = await kernel.atn.status(entry, { taskIds: [born.taskId] })
        assert.equal(result.tasks[0].result?.summary, answer)
      }
      observer.recordSubmission(entry.id, answer)
      const result = observer.finish(answer)
      assert.equal(result.audit.positiveCompletionEvidence, true, JSON.stringify(result.audit))
      assert.ok(result.audit.facts[0].path.some(step => step.kind === 'transport' && step.from === worker.id && step.agent === entry.id))
    } finally {
      observer.dispose()
      await kernel.ctx.fiber.dispose()
      await rm(scratch, { recursive: true, force: true })
    }
  }
})
