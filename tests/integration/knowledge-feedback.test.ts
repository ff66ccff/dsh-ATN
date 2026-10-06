/** Real tool identity, discovery ranking, no-wakeup updates and durable recovery. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import type { SpawnResult } from '../../src/runtime.ts'
import type { TaskValidator } from '../../src/tasks.ts'

const goal = {
  objective: 'Discover local evidence and use requester feedback.',
  successCriteria: 'Knowledge hints and attributed opinions affect discovery and survive restart.',
  constraints: 'Scripted decisions; updates alone never wake another agent.',
}
const knowledge = { documents: ['evidence/slot-5.json'], topics: ['slot 5'], contributions: [] }

async function withKernel(run: (kernel: Kernel) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-knowledge-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try { await run(kernel) }
  finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

async function spawn(kernel: Kernel, creator: Agent): Promise<SpawnResult & { agent: Agent }> {
  const born = await kernel.atn.spawn(creator, {
    task: 'Contribute to the shared objective using your local evidence.', context: '',
  })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(born.sessionId))
  assert.ok(agent)
  return { ...born, agent }
}

async function submit(kernel: Kernel, networkId: string, worker: SpawnResult & { agent: Agent }, summary = 'Local result submitted.'): Promise<string> {
  const record = await kernel.atn.network(networkId)
  const task = Object.values(record.tasks).find(row => row.holderId === worker.nodeId)!
  await kernel.atn.send(worker.agent, {
    to: task.requesterId, kind: 'result', taskId: task.id,
    body: summary, summary,
  })
  await settle(kernel)
  return task.id
}

function toolResults(agent: Agent): { isError?: boolean; content?: readonly { text?: string }[] }[] {
  return (agent.session.snapshotEvents() as readonly { type: string; data?: unknown }[])
    .filter(event => event.type === 'tool/result')
    .map(event => (event.data as { message: { isError?: boolean; content?: readonly { text?: string }[] } }).message)
}

test('KNOWLEDGE-01: real publish and feedback tools derive identity from the live calling agent', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'knowledge-tools-host')
    const started = await kernel.atn.start(host, goal)
    const worker = await spawn(kernel, host)
    kernel.model.enqueue(worker.sessionId, [{ tool: 'atn_board', args: {
      action: 'publish', key: 'slot-5', body: 'Evidence available.', documents: knowledge.documents, topics: knowledge.topics, expectedRevision: 0,
    } }])
    await drive(worker.agent, 'Publish the evidence you have read.')
    await settle(kernel)
    let record = await kernel.atn.network(started.networkId)
    assert.deepEqual(record.whiteboard?.entries.find(entry => entry.authorId === worker.nodeId)?.topics, ['slot 5'])
    assert.equal(record.nodes[started.nodeId].knowledgeFingerprint, undefined)
    assert.equal(toolResults(worker.agent).at(-1)?.isError, false)

    const taskId = await submit(kernel, started.networkId, worker)
    const opinion = { taskId, status: 'accepted', summary: 'Matches local evidence.',
      evidence: ['requester-check.json'], comparisonKey: 'lookup-v1' }
    kernel.model.enqueue(worker.sessionId, [{ tool: 'atn_status', args: { review: opinion } }])
    await drive(worker.agent, 'Attempt to review the result you submitted.')
    await settle(kernel)
    assert.equal(toolResults(worker.agent).at(-1)?.isError, true)
    assert.match(toolResults(worker.agent).at(-1)?.content?.[0]?.text ?? '', /only requester/)
    assert.equal((await kernel.atn.network(started.networkId)).tasks[taskId].localFeedback, undefined)

    kernel.model.enqueue(String(host.id), [{ tool: 'atn_status', args: { review: opinion } }])
    await drive(host, 'Review the requested result against your evidence.')
    await settle(kernel)
    record = await kernel.atn.network(started.networkId)
    assert.equal(record.tasks[taskId].localFeedback?.requesterId, started.nodeId)
    assert.equal(record.tasks[taskId].localFeedback?.status, 'accepted')
    assert.equal(record.tasks[taskId].acceptance, null, 'requester acceptance never writes a host verdict')

    const outsider = await createHostAgent(kernel, 'knowledge-outsider')
    kernel.model.enqueue(String(outsider.id), [
      { tool: 'atn_board', args: { action: 'publish', key: 'forged', body: 'Evidence available.', documents: knowledge.documents, topics: knowledge.topics, expectedRevision: 0 } },
      { tool: 'atn_status', args: { review: opinion } },
    ])
    await drive(outsider, 'Try both tools outside the network.')
    await settle(kernel)
    assert.equal(toolResults(outsider).length, 2)
    assert.ok(toolResults(outsider).every(result => result.isError === true))
    const unchanged = await kernel.atn.network(started.networkId)
    assert.deepEqual(unchanged.whiteboard?.entries, record.whiteboard?.entries)
    assert.deepEqual(unchanged.tasks[taskId].localFeedback, record.tasks[taskId].localFeedback)
  })
})

test('KNOWLEDGE-02: identical assignments become discoverable and requester quality breaks relevance ties', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'knowledge-ranking-host')
    const started = await kernel.atn.start(host, goal)
    const first = await spawn(kernel, host)
    const second = await spawn(kernel, host)
    await kernel.atn.rewire(host, { peers: [] })
    assert.deepEqual((await kernel.atn.status(host, { query: 'slot 5' })).candidates, [])
    await kernel.atn.publishKnowledge(first.agent, knowledge)
    await kernel.atn.publishKnowledge(second.agent, knowledge)
    const firstTask = await submit(kernel, started.networkId, first)
    const secondTask = await submit(kernel, started.networkId, second)
    const before = await kernel.atn.status(host, { query: 'slot 5' })
    assert.deepEqual(before.candidates, [first.nodeId, second.nodeId])
    const requestCount = kernel.model.requests.length
    const prior = await kernel.atn.network(started.networkId)

    await kernel.atn.feedback(host, { taskId: firstTask, status: 'rejected', summary: 'Did not satisfy local evidence.',
      evidence: ['first-check.json'], comparisonKey: 'lookup-v1' })
    await kernel.atn.feedback(host, { taskId: secondTask, status: 'accepted', summary: 'Satisfied local evidence.',
      evidence: ['second-check.json'], comparisonKey: 'lookup-v1' })
    await settle(kernel)
    const after = await kernel.atn.status(host, { query: 'slot 5' })
    assert.deepEqual(after.candidates, [second.nodeId, first.nodeId])
    assert.equal(after.candidateNodes?.[0].requesterFeedback.accepted, 1)
    assert.equal(after.candidateNodes?.[0].verifiedFeedback.passed, 0)
    assert.equal(after.candidateNodes?.[0].knowledgeFingerprint.requesterAcceptanceRate, 1)
    assert.equal(kernel.model.requests.length, requestCount, 'rating and reading discovery never wake idle peers')
    const updated = await kernel.atn.network(started.networkId)
    assert.deepEqual(updated.mails, prior.mails, 'feedback creates no protocol messages')
    assert.equal(updated.stepsUsed, prior.stepsUsed)

    await kernel.atn.publishKnowledge(first.agent, { documents: [], topics: ['unique amber lookup'], contributions: [] })
    assert.deepEqual((await kernel.atn.status(host, { query: 'unique amber lookup' })).candidates, [first.nodeId],
      'unrelated popularity cannot replace the evidence actually requested')
  })
})

test('KNOWLEDGE-03: concurrent local updates do not lose writes or wake peers and survive cold recovery', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-knowledge-recover-'))
  let kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try {
    const host = await createHostAgent(kernel, 'knowledge-recovery-host')
    const started = await kernel.atn.start(host, goal)
    const first = await spawn(kernel, host)
    const second = await spawn(kernel, host)
    const taskId = await submit(kernel, started.networkId, first)
    const before = await kernel.atn.network(started.networkId)
    const requestCount = kernel.model.requests.length
    await Promise.all([
      kernel.atn.publishKnowledge(first.agent, knowledge),
      kernel.atn.publishKnowledge(second.agent, { documents: ['evidence/slot-6.json'], topics: ['slot 6'], contributions: [] }),
      kernel.atn.feedback(host, { taskId, status: 'accepted', summary: 'Checked locally.', evidence: ['check.json'], comparisonKey: 'lookup-v1' }),
    ])
    await settle(kernel)
    assert.equal(kernel.model.requests.length, requestCount)
    const committed = await kernel.atn.network(started.networkId)
    assert.deepEqual(committed.mails, before.mails)
    assert.equal(committed.stepsUsed, before.stepsUsed)
    assert.deepEqual(committed.nodes[first.nodeId].knowledgeFingerprint?.topics, ['slot 5'])
    assert.deepEqual(committed.nodes[second.nodeId].knowledgeFingerprint?.topics, ['slot 6'])
    assert.equal(committed.tasks[taskId].localFeedback?.status, 'accepted')
    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
    await kernel.atn.recover()
    await settle(kernel)
    const recovered = await kernel.atn.network(started.networkId)
    assert.deepEqual(recovered.nodes[first.nodeId].knowledgeFingerprint, committed.nodes[first.nodeId].knowledgeFingerprint)
    assert.deepEqual(recovered.nodes[second.nodeId].knowledgeFingerprint, committed.nodes[second.nodeId].knowledgeFingerprint)
    assert.deepEqual(recovered.tasks[taskId].localFeedback, committed.tasks[taskId].localFeedback)
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('KNOWLEDGE-04: automatic local samples feed both requester and stronger host evaluation', async () => {
  await withKernel(async kernel => {
    kernel.atn.config.requesterMinSamples = 1
    const host = await createHostAgent(kernel, 'knowledge-host-evidence')
    const started = await kernel.atn.start(host, goal)
    const previous = await spawn(kernel, host)
    const candidate = await spawn(kernel, host)
    const baselineTaskId = await submit(kernel, started.networkId, previous, 'obsolete-answer')
    const candidateTaskId = await submit(kernel, started.networkId, candidate, 'current-answer')
    const comparisonKey = 'same-answer-contract-v1'
    await kernel.atn.feedback(host, { taskId: baselineTaskId, status: 'rejected',
      summary: 'The old answer contradicts local evidence.', evidence: ['baseline-check.json'], comparisonKey })
    await kernel.atn.feedback(host, { taskId: candidateTaskId, status: 'accepted',
      summary: 'The current answer matches local evidence.', evidence: ['candidate-check.json'], comparisonKey })
    const hostValidator: TaskValidator = {
      id: 'independent-fixture-v1',
      validate(task) {
        return {
          passed: task.result?.summary === 'current-answer',
          summary: 'Compared the submitted answer with the fixture oracle.', evidence: ['oracle.json'],
          metrics: { comparisonKey, costUnit: 'fixture-work', cost: task.id === baselineTaskId ? 2 : 1 },
        }
      },
    }
    await kernel.atn.verifyTask(started.networkId, baselineTaskId, hostValidator)
    await kernel.atn.verifyTask(started.networkId, candidateTaskId, hostValidator)
    await kernel.atn.rewire(host, { peers: [previous.nodeId] })
    const decision = await kernel.atn.rewire(host, { peers: [candidate.nodeId] })
    assert.deepEqual(decision.requesterEvaluation.baselineTaskIds, [baselineTaskId])
    assert.deepEqual(decision.requesterEvaluation.candidateTaskIds, [candidateTaskId])
    assert.deepEqual(decision.evaluation.baselineTaskIds, decision.requesterEvaluation.baselineTaskIds)
    assert.deepEqual(decision.evaluation.candidateTaskIds, decision.requesterEvaluation.candidateTaskIds)
    assert.equal(decision.requesterEvaluation.verdict, 'observed-improvement')
    assert.equal(decision.evaluation.verdict, 'observed-improvement')
    assert.equal(decision.evaluation.validatorId, hostValidator.id)
    assert.equal(decision.evaluation.costUnit, 'fixture-work')
    assert.equal(decision.evaluation.delta.passRate, 1)
    assert.equal(decision.evaluation.delta.meanCost, -1)
    assert.equal(decision.evaluation.causalClaim, false)
    const persisted = await kernel.atn.network(started.networkId)
    assert.deepEqual(persisted.rewireHistory?.at(-1)?.evaluation, decision.evaluation)
    assert.deepEqual(persisted.rewireHistory?.at(-1)?.requesterEvaluation, decision.requesterEvaluation)
  })
})

test('RECOVERY-EDGE-01: genuinely new edges become measurable after two ratings and survive restart', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-edge-recover-'))
  let now = 1_000_000
  let kernel = await bootKernel(scratch, { clock: () => now })
  try {
    const host = await createHostAgent(kernel, 'cumulative-edge-host')
    const started = await kernel.atn.start(host, goal)
    const old = await spawn(kernel, host)
    // The candidate has never held a task requested by the entry.
    const candidate = await spawn(kernel, old.agent)
    const rate = async (taskId: string, status: 'accepted' | 'rejected') => {
      now++
      return kernel.atn.status(host, { review: { taskId, status, summary: 'Checked the same contract.',
        evidence: ['local-check'], comparisonKey: 'edge-contract' } })
    }
    const run = async (worker: typeof old, status: 'accepted' | 'rejected') => {
      const task = await kernel.atn.send(host, { to: worker.nodeId, kind: 'task', body: 'Answer the same contract.' })
      assert.ok(task.settledTaskId)
      now++
      await kernel.atn.send(worker.agent, { to: started.nodeId, kind: 'result', taskId: task.settledTaskId,
        body: 'Submission', summary: 'Submission' })
      await settle(kernel)
      await rate(task.settledTaskId, status)
      return task.settledTaskId
    }
    await rate(await submit(kernel, started.networkId, old), 'rejected')
    await run(old, 'rejected')
    now++
    const status = await kernel.atn.status(host, { rewire: { peers: [candidate.nodeId] } })
    const decision = status.rewire!
    assert.equal(decision.requesterEvaluation.minimumSamples, 2)
    assert.equal(decision.requesterEvaluation.baseline.rejected, 2)
    assert.equal(decision.requesterEvaluation.verdict, 'insufficient-evidence')
    assert.deepEqual(decision.requesterEvaluation.reasons, ['new-edge-unobserved'])
    assert.equal(decision.requesterEvaluation.candidateEdges?.[0].state, 'unobserved')
    assert.equal(decision.requesterEvaluation.causalClaim, false)
    const first = await run(candidate, 'accepted')
    let record = await kernel.atn.network(started.networkId)
    assert.equal(record.rewireHistory?.find(row => row.id === decision.rewireId)?.requesterEvaluation?.verdict, 'insufficient-evidence')
    assert.ok(record.rewireHistory?.find(row => row.id === decision.rewireId)?.requesterEvaluation?.reasons.includes('candidate-below-minimum-samples'))
    await rate(first, 'accepted') // An exact retry cannot create the second sample.
    record = await kernel.atn.network(started.networkId)
    assert.equal(record.requesterEdges?.find(edge => edge.holderId === candidate.nodeId)?.sampleCount, 1)
    await run(candidate, 'accepted')
    record = await kernel.atn.network(started.networkId)
    const measured = record.rewireHistory?.find(row => row.id === decision.rewireId)?.requesterEvaluation
    assert.equal(measured?.verdict, 'observed-improvement')
    assert.equal(measured?.candidate.accepted, 2)
    assert.equal(measured?.baseline.rejected, 2)
    assert.equal(measured?.delta.acceptanceRate, 1)
    assert.equal(measured?.causalClaim, false)
    const next = await kernel.atn.rewire(host, { peers: [old.nodeId] })
    assert.equal(next.requesterEvaluation.verdict, 'observed-regression')
    const committed = await kernel.atn.network(started.networkId)
    await kernel.ctx.fiber.dispose()
    kernel = await bootKernel(scratch, { clock: () => now })
    await kernel.atn.recover()
    await settle(kernel)
    const recovered = await kernel.atn.network(started.networkId)
    assert.deepEqual(recovered.requesterEdges, committed.requesterEdges)
    assert.deepEqual(recovered.rewireHistory?.map(row => row.requesterEvaluation), committed.rewireHistory?.map(row => row.requesterEvaluation))
    await kernel.atn.stop(started.networkId, 'End fixture after evidence collection.')
    const stopped = await kernel.atn.network(started.networkId)
    assert.equal(stopped.rewireHistory?.find(row => row.id === decision.rewireId)?.requesterEvaluation?.verdict, 'observed-improvement')
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('RECOVERY-EDGE-02: unused feedback and unused new edges have distinct reasons without positive claims', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'unrated-edge-host')
    const started = await kernel.atn.start(host, goal)
    const old = await spawn(kernel, host)
    const candidate = await spawn(kernel, old.agent)
    const result = await kernel.atn.rewire(host, { peers: [candidate.nodeId] })
    assert.equal(result.requesterEvaluation.verdict, 'insufficient-evidence')
    assert.ok(result.requesterEvaluation.reasons.includes('no-ratings-at-all'))
    assert.ok(result.requesterEvaluation.reasons.includes('new-edge-unobserved'))
    assert.ok(!result.requesterEvaluation.reasons.includes('empty-sample'))
    assert.ok(!result.requesterEvaluation.reasons.includes('baseline-uncovered-peer'))
    const neverRequested = await kernel.atn.rewire(candidate.agent, { peers: [started.nodeId] })
    assert.equal(neverRequested.requesterEvaluation.verdict, 'insufficient-evidence')
    assert.ok(neverRequested.requesterEvaluation.reasons.includes('no-ratings-at-all'))
    await kernel.atn.stop(started.networkId, 'Stop without any ratings.')
    const stopped = await kernel.atn.network(started.networkId)
    assert.ok(stopped.rewireHistory?.every(row => row.requesterEvaluation?.verdict === 'insufficient-evidence'))
  })
})

test('RECOVERY-DISCOVERY: board metadata is discoverable without a knowledge index; legacy indices stay readable', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'board-discovery-host')
    const started = await kernel.atn.start(host, goal)
    const worker = await spawn(kernel, host)
    await kernel.atn.rewire(host, { peers: [] })
    await kernel.atn.board(worker.agent, { action: 'publish', key: 'evidence', body: 'Details on the board.',
      documents: ['documents/amber-proof.json'], topics: ['violet-domain'], expectedRevision: 0 })
    const record = await kernel.atn.network(started.networkId)
    assert.equal(record.nodes[worker.nodeId].knowledgeFingerprint, undefined)
    assert.deepEqual((await kernel.atn.status(host, { query: 'amber-proof' })).candidates, [worker.nodeId])
    assert.deepEqual((await kernel.atn.status(host, { query: 'violet-domain' })).candidates, [worker.nodeId])
    // Runtime API retains compatibility for integrations predating board publication.
    await kernel.atn.publishKnowledge(worker.agent, { documents: ['legacy/cobalt.json'], topics: [], contributions: [] })
    assert.deepEqual((await kernel.atn.status(host, { query: 'cobalt' })).candidates, [worker.nodeId])
    assert.deepEqual((await kernel.atn.status(host, { query: 'amber-proof' })).candidates, [worker.nodeId])
  })
})

test('RECOVERY-STATUS: competing optional writes are refused before either can mutate', async () => {
  await withKernel(async kernel => {
    const host = await createHostAgent(kernel, 'status-write-host')
    const started = await kernel.atn.start(host, goal)
    const worker = await spawn(kernel, host)
    const taskId = await submit(kernel, started.networkId, worker)
    const before = await kernel.atn.network(started.networkId)
    await assert.rejects(kernel.atn.status(host, { rewire: { peers: [] }, review: {
      taskId, status: 'accepted', summary: 'Checked.', evidence: ['check'],
    } }), { code: 'multiple-status-mutations' })
    assert.deepEqual(await kernel.atn.network(started.networkId), before)
  })
})
