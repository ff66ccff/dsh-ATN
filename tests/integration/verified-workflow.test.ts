/** Real-kernel acceptance, dependency and evidence-based explicit rewiring. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { RewireResult, SendResult } from '../../src/runtime.ts'
import { networkRecordSchema, type TaskRecord } from '../../src/schema.ts'
import type { TaskValidator } from '../../src/tasks.ts'

const goal = { objective: 'Verify and combine independent work.', successCriteria: 'Check each result against a host contract.', constraints: 'Deterministic fixture, no provider calls.' }

async function fixture(run: (kernel: Kernel, advance: (ms: number) => void) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-verified-'))
  let now = 1_000_000
  const kernel = await bootKernel(scratch, { clock: () => now })
  try { await run(kernel, ms => { now += ms }) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

async function call<T>(kernel: Kernel, agent: Agent, tool: string, args: Record<string, unknown>): Promise<T> {
  kernel.model.enqueue(agent.id, [{ tool, args }])
  await drive(agent, `Execute ${tool}.`)
  await settle(kernel)
  const event = agent.session.snapshotEvents().filter(row => row.type === 'tool/result').at(-1)!
  const message = (event.data as { message: { isError?: boolean; content: readonly { text?: string }[] } }).message
  assert.notEqual(message.isError, true, JSON.stringify(message.content))
  return JSON.parse(message.content.map(block => block.text ?? '').join('')) as T
}

const validator = (cost = 1): TaskValidator => ({
  id: 'numeric-contract/v1',
  validate: task => ({
    passed: task.result?.summary === '42', summary: 'Host checked the exact numeric result.',
    evidence: [`check:${task.id}:expected-42`],
    metrics: { comparisonKey: 'numeric-work/same-budget-v1', cost, costUnit: 'tokens', informationKeys: ['answer'] },
  }),
})

test('VERIFIED-WORKFLOW-01: unverified submissions can be used; host rejection blocks new dependents without erasing history', async () => {
  await fixture(async (kernel, advance) => {
    const host = await createHostAgent(kernel, 'verified-host')
    const started = await kernel.atn.start(host, goal)
    const child = await kernel.atn.spawn(host, { task: 'Compute the numeric answer.', context: '' })
    await settle(kernel)
    const worker = kernel.ctx.agents.get(SessionId(child.sessionId))!
    const before = await kernel.atn.network(started.networkId)
    await assert.rejects(kernel.atn.spawn(host, { task: 'Premature dependency.', context: '', dependsOn: [child.taskId] }), /unfinished/)
    assert.deepEqual((await kernel.atn.network(started.networkId)).nodes, before.nodes, 'spawn preflights before allocating a node')
    advance(100)
    await kernel.atn.send(worker, { to: started.nodeId, kind: 'result', taskId: child.taskId, body: 'I think this is correct.', summary: '41', evidence: ['peer-opinion'] })
    const unverified = await kernel.atn.send(host, { to: child.nodeId, kind: 'task', body: 'Consume provisional answer.', dependsOn: [child.taskId] })
    assert.ok(unverified.settledTaskId)
    const rejected = await kernel.atn.verifyTask(started.networkId, child.taskId, validator())
    assert.equal(rejected.status, 'completed')
    assert.equal(rejected.acceptance?.status, 'failed')
    await assert.rejects(kernel.atn.send(host, { to: child.nodeId, kind: 'task', body: 'Consume rejected answer.', dependsOn: [child.taskId] }), /rejected/)
    const retry = await call<SendResult>(kernel, host, 'atn_send', { to: child.nodeId, kind: 'task', body: 'Retry the computation.', retryOf: child.taskId, messageId: 'retry-numeric' })
    const retryId = retry.settledTaskId!
    advance(50)
    await kernel.atn.send(worker, { to: started.nodeId, kind: 'result', taskId: retryId, body: 'Corrected.', summary: '42', evidence: ['calculation'] })
    await kernel.atn.verifyTask(started.networkId, retryId, validator())
    const downstream = await call<SendResult>(kernel, host, 'atn_send', { to: child.nodeId, kind: 'task', body: 'Consume verified answer.', dependsOn: [retryId], messageId: 'dependent-numeric' })
    const { tasks: snapshot } = await call<{ tasks: TaskRecord[] }>(kernel, worker, 'atn_status', { taskIds: [child.taskId, retryId, downstream.settledTaskId] })
    assert.equal(snapshot[0]!.acceptance?.status, 'failed')
    assert.equal(snapshot[1]!.retryOf, child.taskId)
    assert.equal(snapshot[1]!.acceptance?.status, 'passed')
    assert.deepEqual(snapshot[2]!.dependsOn, [retryId])
    await assert.rejects(kernel.atn.send(host, { to: child.nodeId, kind: 'task', body: 'Consume verified answer.', dependsOn: [], messageId: 'dependent-numeric' }), /stable id cannot be reused/)
    await assert.rejects(kernel.atn.verifyTask(started.networkId, retryId, validator(0)), /already/)
    assert.ok(kernel.model.toolSets.every(row => !row.tools.includes('atn_verify')), 'verification is a host capability, not a model tool')
    networkRecordSchema.parse(await kernel.atn.network(started.networkId))
  })
})

test('VERIFIED-WORKFLOW-02: rewires remain open while optional host evidence records gains and regressions', async () => {
  await fixture(async (kernel, advance) => {
    const host = await createHostAgent(kernel, 'rewire-host')
    const started = await kernel.atn.start(host, goal)
    const baseline = await kernel.atn.spawn(host, { task: 'Compute a comparable numeric answer.', context: '' })
    await settle(kernel)
    advance(100)
    await kernel.atn.send(kernel.ctx.agents.get(SessionId(baseline.sessionId))!, { to: started.nodeId, kind: 'result', taskId: baseline.taskId, body: 'Answer.', summary: '42', evidence: ['calculation-a'] })
    await kernel.atn.verifyTask(started.networkId, baseline.taskId, validator(10))
    const candidate = await kernel.atn.spawn(host, { task: 'Compute a comparable numeric answer.', context: '' })
    await settle(kernel)
    advance(50)
    await kernel.atn.send(kernel.ctx.agents.get(SessionId(candidate.sessionId))!, { to: started.nodeId, kind: 'result', taskId: candidate.taskId, body: 'Answer.', summary: '42', evidence: ['calculation-b'] })
    await kernel.atn.rewire(host, { peers: [baseline.nodeId] })
    const choice = { peers: [candidate.nodeId], intent: 'verified-improvement' as const, baselineTaskIds: [baseline.taskId], candidateTaskIds: [candidate.taskId] }
    const provisional = await kernel.atn.rewire(host, choice)
    assert.equal(provisional.evaluation.verdict, 'insufficient-evidence')
    assert.ok(provisional.rewireId)
    await kernel.atn.rewire(host, { peers: [baseline.nodeId] })
    await kernel.atn.verifyTask(started.networkId, candidate.taskId, validator(5))
    const changed = await kernel.atn.rewire(host, choice)
    assert.deepEqual(changed.neighbours, [candidate.nodeId])
    assert.equal(changed.evaluation.verdict, 'observed-improvement')
    assert.equal(changed.evaluation.causalClaim, false)
    assert.deepEqual(changed.evaluation.delta, { passRate: 0, meanLatencyMs: -50, meanCost: -5 })
    assert.ok(changed.rewireId)
    const before = await kernel.atn.network(started.networkId)
    const regression = await kernel.atn.rewire(host, { peers: [baseline.nodeId], intent: 'verified-improvement', baselineTaskIds: [candidate.taskId], candidateTaskIds: [baseline.taskId] })
    assert.equal(regression.evaluation.verdict, 'observed-regression')
    const unknown = await kernel.atn.rewire(host, { peers: [baseline.nodeId], baselineTaskIds: ['invented'], candidateTaskIds: [baseline.taskId] })
    assert.equal(unknown.evaluation.verdict, 'insufficient-evidence')
    assert.ok(unknown.evaluation.reasons.includes('baseline-unknown-task'))
    const discovery = await kernel.atn.peers(host, '*')
    assert.equal(discovery.nodes[0]!.verifiedFeedback.passed, 1)
    assert.equal(discovery.candidateNodes!.find(node => node.id === candidate.nodeId)!.verifiedFeedback.passed, 1)
    const { rewire: noChange } = await call<{ rewire: RewireResult }>(kernel, host, 'atn_status', { rewire: { peers: [baseline.nodeId] } })
    assert.ok(noChange.rewireId)
    const accepted = await kernel.atn.network(started.networkId)
    assert.equal(accepted.rewireHistory!.length, before.rewireHistory!.length + 3)
    assert.deepEqual(networkRecordSchema.parse(JSON.parse(JSON.stringify(accepted))).rewireHistory, accepted.rewireHistory)
    const stored = accepted.rewireHistory!.find(row => row.id === changed.rewireId)!
    assert.equal(stored.intent, 'verified-improvement')
    assert.equal(stored.evaluation.verdict, 'observed-improvement')
  })
})

test('VERIFIED-WORKFLOW-03: host verification survives full store recovery and thrown validation leaves no verdict', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-verified-recovery-'))
  let kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try {
    const host = await createHostAgent(kernel, 'recovery-host')
    const started = await kernel.atn.start(host, goal)
    await kernel.atn.send(host, { to: started.nodeId, kind: 'result', taskId: started.taskId, body: 'Answer.', summary: '42' })
    await assert.rejects(kernel.atn.verifyTask(started.networkId, started.taskId, { id: 'broken-validator', validate: () => { throw new Error('checker unavailable') } }), /checker unavailable/)
    assert.equal((await kernel.atn.network(started.networkId)).tasks[started.taskId]!.acceptance, null)
    const verified = await kernel.atn.verifyTask(started.networkId, started.taskId, validator())
    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
    await kernel.atn.recover()
    assert.deepEqual((await kernel.atn.network(started.networkId)).tasks[started.taskId], verified)
  } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})

test('VERIFIED-WORKFLOW-04: rewires beyond the former 64-entry gate and no-op decisions are recorded', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'bounded-rewire-host')
    const started = await kernel.atn.start(host, goal)
    const child = await kernel.atn.spawn(host, { task: 'Hold a collaborator slot.', context: '' })
    await settle(kernel)
    for (let index = 0; index < 64; index++) {
      await kernel.atn.rewire(host, { peers: index % 2 === 0 ? [] : [child.nodeId] })
    }
    const before = await kernel.atn.network(started.networkId)
    assert.equal(before.rewireHistory?.length, 64)
    await kernel.atn.rewire(host, { peers: [] })
    await kernel.atn.rewire(host, { peers: [child.nodeId] })
    const noChange = await kernel.atn.rewire(host, { peers: [child.nodeId] })
    assert.ok(noChange.rewireId)
    const after = await kernel.atn.network(started.networkId)
    assert.equal(after.rewireHistory?.length, 67)
    assert.deepEqual(after.rewireHistory!.slice(0, 64), before.rewireHistory)
    assert.deepEqual(after.nodes, before.nodes)
    assert.equal(after.sequence, before.sequence + 3)
  })
})
