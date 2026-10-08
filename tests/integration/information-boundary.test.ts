/** Regression cases recorded before the 0.5.0 information-boundary repair. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { AtnRefusal } from '../../src/runtime.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, settle, type Kernel } from '../fixtures/kernel.ts'

const goal = { objective: 'Check local evidence.', successCriteria: 'Grounded result.', constraints: '' }
const foreign = 'artifacts/foreign.json'

async function withKernel(run: (kernel: Kernel) => Promise<void>) {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-boundary-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try { await run(kernel) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

test('BOUNDARY-RED-REVIEW: review.summary cannot launder an unowned artifact', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'boundary-review-host')
    const started = await kernel.atn.start(host, goal)
    const worker = await kernel.atn.spawn(host, { task: 'Check evidence.', context: '' })
    await settle(kernel)
    const agent = kernel.ctx.agents.get(SessionId(worker.sessionId))!
    await kernel.atn.send(agent, { to: started.nodeId, kind: 'result', taskId: worker.taskId,
      body: 'Done.', summary: 'Done.', evidence: [] })
    await settle(kernel)
    kernel.atn.installSendPolicy(started.networkId, (_record, _sender, input) => {
      if (JSON.stringify(input).includes(foreign)) throw new AtnRefusal('evidence-not-owned', foreign)
    })
    const before = await kernel.atn.network(started.networkId)
    await assert.rejects(kernel.atn.status(host, { review: { taskId: worker.taskId,
      status: 'accepted', summary: `I hold ${foreign}`, evidence: ['local-check'] } }), { code: 'evidence-not-owned' })
    assert.deepEqual(await kernel.atn.network(started.networkId), before)
  })
})

test('BOUNDARY-RED-DISCOVERY: an agent cannot forge its discovery custody', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'boundary-discovery-host')
    const started = await kernel.atn.start(host, goal)
    const worker = await kernel.atn.spawn(host, { task: 'Check evidence.', context: '' })
    await settle(kernel)
    const agent = kernel.ctx.agents.get(SessionId(worker.sessionId))!
    kernel.atn.installSendPolicy(started.networkId, (_record, _sender, input) => {
      if (JSON.stringify(input).includes(foreign)) throw new AtnRefusal('evidence-not-owned', foreign)
    })
    const before = await kernel.atn.network(started.networkId)
    await assert.rejects(kernel.atn.board(agent, { action: 'publish', key: 'forged-custody',
      body: 'I hold this document.', documents: [foreign], topics: ['forged-topic'], expectedRevision: 0 }),
    { code: 'evidence-not-owned' })
    assert.deepEqual(await kernel.atn.network(started.networkId), before)
  })
})
