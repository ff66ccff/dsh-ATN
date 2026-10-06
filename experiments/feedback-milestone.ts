/** Legacy P0/P1 diagnostic with explicit M=1; never an experiment admission or capability gate. */
import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createExactJsonValidator, isTaskAccepted } from '../src/tasks.ts'
import { bootKernel, createHostAgent, settle, type Kernel } from '../tests/fixtures/kernel.ts'

const assignment = 'Contribute to the shared objective using your local evidence.'
const comparisonKey = 'slot-5-current-value:v1'
const query = 'slot-5'
const goal = {
  objective: 'Locate current slot-5 evidence and choose the collaborator whose result the requester accepts.',
  successCriteria: 'Knowledge is discoverable; requester feedback changes a later peer choice without becoming host verification.',
  constraints: 'Five nodes; deterministic decisions; no paid provider; no claim of emergent capability or causal topology benefit.',
}

async function spawn(kernel: Kernel, creator: Agent) {
  const born = await kernel.atn.spawn(creator, { task: assignment, context: '' })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(born.sessionId))
  assert.ok(agent, 'spawn publishes a live holder')
  return { ...born, agent }
}

export async function runFeedbackMilestoneArm(withFeedback: boolean) {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-feedback-milestone-'))
  let now = 1_000_000
  const kernel = await bootKernel(scratch, { clock: () => now })
  try {
    // Keep the historical single-probe diagnostic reproducible; production defaults to M=2.
    kernel.atn.config.requesterMinSamples = 1
    const requester = await createHostAgent(kernel, 'feedback-milestone-requester')
    const started = await kernel.atn.start(requester, goal)
    const previous = await spawn(kernel, requester)
    const relay = await spawn(kernel, requester)
    const candidate = await spawn(kernel, relay.agent)
    const unrelated = await spawn(kernel, relay.agent)
    const initial = await kernel.atn.network(started.networkId)
    assert.ok([previous, relay, candidate, unrelated].every(peer => initial.tasks[peer.taskId].description === assignment))
    await kernel.atn.rewire(requester, { peers: [previous.nodeId] })

    const beforePublication = await kernel.atn.status(requester, { query })
    assert.deepEqual(beforePublication.candidates, [], 'identical assignments reveal no holder of the requested information')
    await kernel.atn.publishKnowledge(candidate.agent, {
      documents: ['document:slot-5:current'], topics: [query], contributions: ['current value with provenance'],
    })
    await kernel.atn.publishKnowledge(unrelated.agent, {
      documents: ['document:slot-2:current'], topics: ['slot-2'], contributions: ['unrelated value with provenance'],
    })
    const afterPublication = await kernel.atn.status(requester, { query })
    assert.equal(afterPublication.candidates?.[0], candidate.nodeId, 'fingerprint locates a sibling with the same generic assignment')
    const discovered = afterPublication.candidateNodes?.find(peer => peer.id === candidate.nodeId)
    assert.ok(discovered?.knowledgeFingerprint)

    // Exploration is explicitly paid in real directed topology changes and task mail.
    // Keeping the old peer for one probe permits results from both candidates.
    await kernel.atn.rewire(requester, { peers: [previous.nodeId, candidate.nodeId] })
    const probe = async (holder: typeof candidate, result: object, kind: 'accepted' | 'rejected' | 'needs-more', key: string) => {
      const sent = await kernel.atn.send(requester, {
        to: holder.nodeId, kind: 'task', body: 'Return the current slot-5 value and its document reference.',
      })
      assert.ok(sent.settledTaskId)
      await settle(kernel)
      now += 10
      const summary = JSON.stringify(result)
      await kernel.atn.send(holder.agent, {
        to: started.nodeId, kind: 'result', taskId: sent.settledTaskId,
        body: summary, summary, evidence: [`document:slot-5:${kind === 'rejected' ? 'obsolete' : 'current'}`],
      })
      await settle(kernel)
      if (withFeedback) {
        await kernel.atn.feedback(requester, {
          taskId: sent.settledTaskId, status: kind,
          summary: kind === 'accepted' ? 'Value and current document reference satisfy this request.'
            : kind === 'rejected' ? 'The supplied document reference is obsolete.' : 'A document reference alone needs the value.',
          evidence: [`requester-check:${sent.settledTaskId}`], comparisonKey: key,
        })
      }
      return sent.settledTaskId
    }
    const baselineTaskId = await probe(previous, { value: 3, document: 'document:slot-5:obsolete' }, 'rejected', comparisonKey)
    const incompleteTaskId = await probe(candidate, { document: 'document:slot-5:current' }, 'needs-more', 'slot-5-provenance-only:v1')
    const acceptedResult = { value: 7, document: 'document:slot-5:current' }
    const candidateTaskId = await probe(candidate, acceptedResult, 'accepted', comparisonKey)
    // Restore the old edge after probing; the subsequent change compares the
    // actual removed and added peers, with automatic requester-local sampling.
    await kernel.atn.rewire(requester, { peers: [previous.nodeId] })
    const decisionInput = await kernel.atn.status(requester, { query })
    const discoveredCandidate = decisionInput.candidateNodes?.find(peer => peer.id === candidate.nodeId)
    assert.ok(discoveredCandidate)
    const currentPeer = decisionInput.nodes.find(peer => peer.id === previous.nodeId)
    assert.ok(currentPeer)
    const choice = withFeedback
      ? decisionInput.candidateNodes?.find(peer => peer.requesterFeedback.accepted > currentPeer.requesterFeedback.accepted)?.id
      : decisionInput.candidates?.[0]
    assert.equal(choice, candidate.nodeId, 'the policy uses the returned local acceptance record; control uses exploration')
    const decision = await kernel.atn.rewire(requester, { peers: [choice!] })
    assert.equal(decision.evaluation.verdict, 'insufficient-evidence', 'requester agreement is never host verification')
    assert.equal(decision.requesterEvaluation.verdict, withFeedback ? 'observed-improvement' : 'insufficient-evidence')
    assert.equal(decision.requesterEvaluation.causalClaim, false)
    assert.equal(decision.requesterEvaluation.qualityOnly, true)

    const persisted = await (await kernel.atn.openStore()).load(started.networkId)
    assert.ok(persisted)
    assert.equal(persisted.tasks[baselineTaskId].settledBy, previous.nodeId)
    assert.equal(persisted.tasks[candidateTaskId].settledBy, candidate.nodeId)
    assert.equal(persisted.tasks[incompleteTaskId].localFeedback?.status, withFeedback ? 'needs-more' : undefined)
    assert.equal(persisted.tasks[candidateTaskId].localFeedback?.status, withFeedback ? 'accepted' : undefined)
    assert.equal(isTaskAccepted(persisted.tasks[candidateTaskId]), false, 'local acceptance cannot satisfy the independent host gate')

    // The stronger layer remains functional and separate. Invoke it only after
    // the measured rewire, so no oracle signal leaks into the local decision.
    const hostChecked = await kernel.atn.verifyTask(started.networkId, candidateTaskId,
      createExactJsonValidator('milestone-exact-json:v1', { [candidateTaskId]: acceptedResult }))
    assert.equal(isTaskAccepted(hostChecked), true)
    const summaries = Object.values(persisted.tasks).flatMap(task => task.localFeedback ? [task.localFeedback] : [])
    const explicitRewires = (persisted.rewireHistory ?? []).map(row => ({
      id: row.id, intent: row.intent,
      evidenceSource: row.evaluation.verdict !== 'insufficient-evidence' ? 'host'
        : row.requesterEvaluation?.verdict !== undefined && row.requesterEvaluation.verdict !== 'insufficient-evidence' ? 'requester' : 'none',
      verdict: row.evaluation.verdict !== 'insufficient-evidence' ? row.evaluation.verdict
        : row.requesterEvaluation?.verdict ?? row.evaluation.verdict,
      hostVerdict: row.evaluation.verdict,
      requesterVerdict: row.requesterEvaluation?.verdict ?? 'insufficient-evidence',
      causalClaim: false,
    }))
    return {
      diagnosticOnly: true, requesterMinSamples: 1,
      arm: withFeedback ? 'requester-feedback' : 'missing-feedback-control',
      nodeCount: Object.keys(persisted.nodes).length, identicalInitialAssignments: true,
      paidModelCalls: 0, scriptedModelCalls: kernel.model.requests.length,
      discovery: { query, beforePublication: beforePublication.candidates, afterPublication: afterPublication.candidates,
        candidateNodeId: candidate.nodeId, knowledgeFingerprint: discovered.knowledgeFingerprint },
      localFeedback: { accepted: summaries.filter(row => row.status === 'accepted').length,
        rejected: summaries.filter(row => row.status === 'rejected').length,
        needsMore: summaries.filter(row => row.status === 'needs-more').length },
      tasks: { baselineTaskId, incompleteTaskId, candidateTaskId },
      decisionInput: { previous: currentPeer.requesterFeedback, candidate: discoveredCandidate.requesterFeedback },
      decision: { neighbours: decision.neighbours, hostEvaluation: decision.evaluation, requesterEvaluation: decision.requesterEvaluation },
      explicitRewires,
      hostAcceptance: { beforeIndependentCheck: false, afterIndependentCheck: isTaskAccepted(hostChecked),
        checkedAfterDecision: true, validatorId: hostChecked.acceptance!.validatorId },
      causalClaim: false,
    }
  } finally {
    await kernel.ctx.fiber.dispose()
    // mkdtemp creates an absolute, unique child of the OS temp directory.
    assert.equal(dirname(scratch), resolve(tmpdir()))
    assert.ok(scratch.split(/[\\/]/).at(-1)?.startsWith('dsh-atn-feedback-milestone-'))
    await rm(scratch, { recursive: true, force: true })
  }
}

export async function runFeedbackMilestone() {
  const sourceFiles = ['feedback-milestone.ts', '../src/runtime.ts', '../src/schema.ts', '../src/knowledge.ts',
    '../src/requester-feedback.ts', '../src/tasks.ts', '../src/tools.ts', '../src/verified-feedback.ts',
    '../src/topology-feedback.ts', '../tests/fixtures/kernel.ts', '../package.json', '../package-lock.json']
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file =>
    [file, createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex')])))
  const arms = [await runFeedbackMilestoneArm(false), await runFeedbackMilestoneArm(true)]
  return {
    schemaVersion: 1, experiment: 'p0-p1-feedback-milestone', generatedAt: new Date().toISOString(),
    mechanism: 'Action -> requester-local result judgement -> persisted local observation -> next peer choice.',
    method: 'Real Harness agents, runtime mutation queues, task/result delivery and JSON persistence; deterministic scripted decisions.',
    paidModelCalls: 0, sourceHashes,
    interpretation: 'Tests that the feedback path can close. Requester judgement is not an oracle, a causal topology estimate, or evidence of LLM collective improvement.',
    limitations: ['Scripted policy and constructed samples; no real-model efficacy estimate.',
      'Five nodes and cheap discovery do not test topology scarcity.',
      'No message, token, latency or cost improvement claim; requester evaluation compares quality only.'],
    pending: ['P2 bounded shared whiteboard', 'P3 scarce topology or communication costs',
      'P4 unknown information placement with changing useful collaborators', 'P5 further prompt-overhead measurement'],
    arms,
  }
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'experiments/results/feedback-milestone.json' } } })
  const report = await runFeedbackMilestone()
  const output = resolve(values.out)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.table(report.arms.map(arm => ({ arm: arm.arm, nodes: arm.nodeCount,
    accepted: arm.localFeedback.accepted, rejected: arm.localFeedback.rejected, needsMore: arm.localFeedback.needsMore,
    requesterVerdict: arm.decision.requesterEvaluation.verdict, hostVerdict: arm.decision.hostEvaluation.verdict,
    paidModelCalls: arm.paidModelCalls })))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
