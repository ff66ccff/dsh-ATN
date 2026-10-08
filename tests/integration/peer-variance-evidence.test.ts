import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as evidence from '../../experiments/shifting-evidence-task.ts'
import { provisionShifting, shiftingConfig } from '../../experiments/shifting-evidence-reference.ts'
import { referenceKernel } from '../../experiments/reference-kernel.ts'
import { installShiftingEvidenceAccess } from '../../experiments/shifting-evidence-access.ts'
import { runShiftingEvidence } from '../../experiments/shifting-evidence-run.ts'
import { ShiftingMailScript } from '../../experiments/shifting-evidence-script.ts'
import * as AtnTools from '../../src/tools.ts'

test('PEER-03: identical capabilities expose both copy holders; real same-query reviews persist rejected and accepted', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'peer-variance-'))
  const task = evidence.createShiftingEvidenceTask(8, 17, 2), scenario = new evidence.ShiftingEvidenceScenario(task)
  const kernel = await referenceKernel(scratch, scenario, shiftingConfig(8, 32, 30000))
  try {
    await kernel.ctx.plugin(AtnTools)
    const network = await provisionShifting(kernel.ctx, kernel.entry, scenario)
    for (const helper of network.agents.slice(1)) {
      const assignments = helper.session.snapshotEvents().filter(event => event.type === 'user/message')
        .flatMap(event => event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      const task = assignments.find(text => text.includes('[ATN task]'))!
      assert.match(task, /Read.*local.*once per phase/i)
      assert.match(task, /respond.*actual.*task.*relay/i)
      assert.match(task, /no assigned work.*end.*turn.*wait/i)
      assert.doesNotMatch(task, /choose useful collaborators/)
    }
    installShiftingEvidenceAccess(kernel.ctx.atn, network.networkId, id => scenario.knowledgeHints(id))
    const permissions = network.agents.map(agent => JSON.parse(JSON.stringify(agent.options)))
    permissions.forEach(options => assert.deepEqual(options, permissions[0], 'all agents keep the same model route and capabilities'))
    const tools = network.agents.map(agent => kernel.ctx.tools.schemas(agent.id).map(tool => tool.name).sort())
    assert.equal(tools[0].length, 5)
    tools.forEach(names => assert.deepEqual(names, tools[0]))
    await kernel.ctx.atn.refreshCustody(network.networkId)
    const requester = network.agents[0]
    const staleSlot = task.phases[0].staleHolders[task.rootKey], goodSlot = task.phases[0].holders[task.rootKey]
    const discovered = await kernel.ctx.atn.status(requester, { query: task.rootKey })
    const visible = [...discovered.nodes, ...(discovered.candidateNodes ?? [])].filter(peer => peer.knowledgeFingerprint.topics.includes(task.rootKey))
    assert.ok(visible.some(peer => peer.id === network.ids[staleSlot]))
    assert.ok(visible.some(peer => peer.id === network.ids[goodSlot]))
    assert.ok('rewireHint' in discovered, 'status makes the atomic rewire入口 explicit')
    for (const slot of [staleSlot, goodSlot]) {
      await kernel.ctx.atn.status(requester, { rewire: { peers: [network.ids[slot]] } })
      const sent = await kernel.ctx.atn.send(requester, { to: network.ids[slot], kind: 'task', body: 'Return phase 1 version 1 key-00 with required fields.' })
      const fact = scenario.read(network.agents[slot].id, task.rootKey).documents[0]
      await kernel.ctx.atn.send(network.agents[slot], { to: network.ids[0], kind: 'result', taskId: sent.settledTaskId!, body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] })
      const verdict = evidence.validateRequestedEvidence(fact, { phase: 1, key: task.rootKey })
      await kernel.ctx.atn.status(requester, { review: { taskId: sent.settledTaskId!, status: verdict.status, summary: verdict.reasons.join(', ') || 'Local requested fields match.', evidence: [fact.id], comparisonKey: 'versioned-fact:v1' } })
    }
    const record = await kernel.ctx.atn.network(network.networkId)
    const ratings = Object.values(record.tasks).flatMap(row => row.localFeedback ? [row.localFeedback.status] : [])
    assert.deepEqual(ratings.sort(), ['accepted', 'rejected'])
  } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})

test('PEER-04: adaptive script queries, rejects stale lookup, rewires, accepts replacement and solves both phases', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'peer-variance-script-'))
  try {
    const report = await runShiftingEvidence({ model: { id: 'deepseek-v4.1-flash', name: 'Script only', api: 'test', catalogFree: false,
      referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }, mode: 'adaptive', directory: join(scratch, 'run'),
      agents: 8, seed: 17, chainLength: 2, perNodeSteps: 48, maxCalls: 384, maxOutputTokens: 1536, timeoutMs: 30000, observedTokenLimit: 400000 }, { adapter: new ShiftingMailScript() })
    assert.equal(report.passed, true)
    const protocol = report.protocol as { requesterFeedback: { accepted: number; rejected: number }; explicitRewires: Array<{ changed: boolean }>; stepUse: Array<{ stepsUsed: number }> }
    assert.ok(protocol.requesterFeedback.accepted > 0)
    assert.ok(protocol.requesterFeedback.rejected > 0)
    assert.ok(protocol.explicitRewires.some(row => row.changed))
    assert.ok(Math.max(...protocol.stepUse.map(row => row.stepsUsed)) <= 48 * 0.8)
    assert.equal(report.execution, 'scripted-test')
    assert.equal(report.meanInputTokensPerCall, null)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})
