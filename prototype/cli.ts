// THROWAWAY executable experiment. Assertions are checkpoints in the demo, not a production test suite.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { bootKernel, type Kernel } from './harness.ts'
import { attachRuntime, type PrototypeRuntime } from './runtime.ts'
import type { Limits } from './state.ts'

const directory = dirname(fileURLToPath(import.meta.url))
const interactive = process.argv.includes('--interactive') && process.stdin.isTTY
const terminal = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : undefined
const checkpoints: { label: string; status: 'passed'; state: object }[] = []
const transcripts: { scenario: string; node: string; events: readonly SessionEvent[] }[] = []
const requests: { scenario: string; node: string; provider: string; model: string; tools: string[] }[] = []
const scratchRoots: string[] = []
let kernel: Kernel | undefined
let runtime: PrototypeRuntime | undefined
let scenario = ''
let status = 'running'
let failure: string | undefined

async function open(label: string, limits: Partial<Limits> = {}): Promise<void> {
  scenario = label
  const scratch = await mkdtemp(join(directory, '.scratch', 'PROTOTYPE-WIPE-ME-'))
  scratchRoots.push(scratch)
  kernel = await bootKernel(scratch)
  runtime = await attachRuntime(kernel, scratch, limits)
}

async function capture(): Promise<void> {
  if (!runtime || !kernel) return
  for (const node of Object.values(runtime.store.state.nodes)) {
    try { transcripts.push({ scenario, node: node.id, events: await runtime.events(node.id) }) }
    catch (error) {
      // Failed, unpublished creations have no persisted Session; successful nodes must have one.
      if (runtime.store.state.tasks[`task-${node.id}`]) throw error
    }
  }
  requests.push(...kernel.model.requests.map(request => ({
    scenario, node: request.node, provider: request.options.provider, model: request.options.model,
    tools: request.options.tools?.map(tool => tool.name).sort() ?? [],
  })))
}

async function close(): Promise<void> {
  if (!kernel) return
  await capture()
  const ctx = kernel.ctx
  const registry = ctx.agents
  await ctx.fiber.dispose()
  assert.equal(registry.list().length, 0, 'Harness registry must be empty after plugin teardown')
  kernel = undefined
  runtime = undefined
}

async function step(label: string, action: () => Promise<void> | void): Promise<void> {
  if (terminal) {
    const answer = await terminal.question(`\nNext: ${label}\n[Enter] execute, [q] quit: `)
    if (answer.trim().toLowerCase() === 'q') throw new Error('INTERACTIVE_EXIT')
  }
  await action()
  const state = runtime?.view() ?? { allKernelHandlesReleased: true }
  checkpoints.push({ label, status: 'passed', state })
  console.log(`\nPASS ${checkpoints.length}: ${label}`)
  console.log(JSON.stringify(state, null, 2))
}

function resultText(events: readonly SessionEvent[]): string[] {
  return events.filter(event => event.type === 'tool/result').map(event =>
    event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
}

async function call(node: string, tool: string, args: Record<string, unknown> = {}, error?: RegExp): Promise<Record<string, unknown>> {
  const events = await runtime!.drive(node, [{ tool, args }])
  const results = events.filter(event => event.type === 'tool/result')
  assert.equal(results.length, 1, `Expected one real tool result for ${node}.${tool}; got ${JSON.stringify(events)}`)
  const text = resultText(events)[0]
  if (error) {
    assert.equal(results[0].data.message.isError, true, text)
    assert.match(text, error)
    return {}
  }
  assert.notEqual(results[0].data.message.isError, true, text)
  return JSON.parse(text) as Record<string, unknown>
}

async function result(node: string, requester: string, task = `task-${node}`): Promise<void> {
  await call(node, 'atn_send', { to: requester, kind: 'result', replyTo: task, content: `Checked fixture result from ${node}` })
}

async function main(): Promise<void> {
  await mkdir(join(directory, '.scratch'), { recursive: true })
  await open('topology-lifecycle-document')
  let original = ''
  let replacement = ''
  let stale = ''
  let recoveryProposal = ''
  let unacknowledged = ''

  await step('Boot real Harness kernel and root A; idle is not task completion', async () => {
    await runtime!.spawn('A', null, 'Coordinate a checked fixture deliverable')
    await runtime!.settle()
    assert.equal(runtime!.handles.get('A')!.agent.status, 'idle')
    assert.equal(runtime!.store.state.tasks['task-A'].status, 'pending')
    await assert.rejects(runtime!.finalize(), /UNFINISHED_TASKS/)
    await call('A', 'atn_propose', { baseRevision: 1, body: 'Do not self-approve', reason: 'empty electorate' }, /NO_NEIGHBORS/)
  })
  await step('A creates B, B creates C, C creates D, D creates E through actual model tool calls', async () => {
    for (const [creator, id] of [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']]) {
      await call(creator, 'atn_spawn', { id, task: `Local task for ${id}` })
    }
    assert.deepEqual(runtime!.store.neighbors('C'), ['B', 'A', 'D', 'E'])
    assert.equal(kernel!.ctx.agents.list().length, 5)
  })
  await step('A creates another branch X; X can itself create Y without replacing A.selectedChild', async () => {
    await call('A', 'atn_spawn', { id: 'X', task: 'Side branch evidence lookup' })
    await call('X', 'atn_spawn', { id: 'Y', task: 'Independent side branch check' })
    assert.equal(runtime!.store.state.nodes.A.selectedChild, 'B')
    assert.deepEqual(runtime!.store.neighbors('A'), ['B', 'C'])
    assert.deepEqual(runtime!.store.neighbors('X'), ['A', 'Y'])
    const tools = kernel!.model.requests.filter(request => request.options.tools?.length)
      .map(request => request.options.tools!.map(tool => tool.name).sort())
    assert.ok(tools.length >= 7)
    for (const names of tools) assert.deepEqual(names, tools[0], 'All nodes must expose identical tools')
  })
  await step('C discovers X and sends a peer note without changing either electorate', async () => {
    const peers = await call('C', 'atn_peers', { query: 'side branch evidence' })
    assert.deepEqual(peers.peers, [{ id: 'X', description: 'Side branch evidence lookup' }])
    const receipt = await call('C', 'atn_send', { to: 'X', kind: 'note', content: 'Use this evidence', sender: 'A' })
    assert.equal(runtime!.store.state.mail[String(receipt.mailId)].from, 'C', 'Model cannot spoof sender')
    const events = await runtime!.events('X')
    assert.ok(events.some(event => event.type === 'user/message'
      && event.data.source.kind === 'atn-prototype-mail' && event.data.source.sender === 'C'))
    assert.deepEqual(runtime!.store.neighbors('C'), ['B', 'A', 'D', 'E'])
  })
  await step('C proposes a goal change; X proposes a competing version-1 change', async () => {
    original = String((await call('C', 'atn_propose', {
      baseRevision: 1, body: 'Deliver checked results and preserve old reviews during retirement.', reason: 'clarify acceptance',
    })).proposalId)
    stale = String((await call('X', 'atn_propose', {
      baseRevision: 1, body: 'Competing old-base document', reason: 'exercise compare-and-set',
    })).proposalId)
    assert.deepEqual(runtime!.store.state.proposals[original].voters, ['B', 'A', 'D', 'E'])
    assert.equal(runtime!.store.state.goals.length, 1)
  })
  await step('B begins draining; A and C bypass B, but B remains responsible for its old review', async () => {
    await call('B', 'atn_finish')
    assert.equal(runtime!.store.state.nodes.B.phase, 'draining')
    assert.ok(runtime!.handles.has('B'))
    assert.deepEqual(runtime!.store.neighbors('A'), ['C', 'D'])
    assert.deepEqual(runtime!.store.neighbors('C'), ['A', 'D', 'E'])
    assert.equal(runtime!.store.state.nodes.C.creator, 'B')
    assert.ok(runtime!.store.obligations('B').reviews.includes(original))
    await call('A', 'atn_send', { to: 'B', kind: 'task', content: 'This is new work' }, /NOT_ACCEPTING/)
  })
  await step('New C proposal uses replacement neighbors; B cannot vote on it; one rejection blocks it', async () => {
    replacement = String((await call('C', 'atn_propose', {
      baseRevision: 1, body: 'A new proposal after topology replacement', reason: 'new electorate',
    })).proposalId)
    assert.deepEqual(runtime!.store.state.proposals[replacement].voters, ['A', 'D', 'E'])
    await call('B', 'atn_vote', { proposalId: replacement, decision: 'approve' }, /NOT_IN_FROZEN_ELECTORATE/)
    await call('D', 'atn_vote', { proposalId: replacement, decision: 'reject' })
    assert.equal(runtime!.store.state.proposals[replacement].status, 'rejected')
    assert.equal(runtime!.store.state.goals.length, 1)
  })
  await step('Three approvals are not unanimity; B\'s old vote remains required', async () => {
    await Promise.all(['A', 'D', 'E'].map(id => call(id, 'atn_vote', { proposalId: original, decision: 'approve' })))
    assert.equal(runtime!.store.state.proposals[original].status, 'pending')
    assert.equal(runtime!.store.state.goals.length, 1)
  })
  await step('Draining B receives an existing child result, votes on its old proposal, then finishes its own task', async () => {
    await result('C', 'B')
    await call('B', 'atn_vote', { proposalId: original, decision: 'approve' })
    assert.equal(runtime!.store.state.goals.at(-1)!.revision, 2)
    assert.equal(runtime!.store.state.nodes.B.phase, 'draining', 'Own task still unfinished')
    await result('B', 'A')
    assert.equal(runtime!.store.state.nodes.B.phase, 'retired')
    assert.equal(kernel!.ctx.agents.get(SessionId('B')), undefined)
    assert.ok(runtime!.handles.has('C') && runtime!.handles.has('D') && runtime!.handles.has('E'))
  })
  await step('Old-base unanimous proposal cannot overwrite revision 2; votes do not transfer', async () => {
    await call('A', 'atn_vote', { proposalId: stale, decision: 'approve' })
    await call('Y', 'atn_vote', { proposalId: stale, decision: 'approve' })
    assert.equal(runtime!.store.state.proposals[stale].status, 'stale')
    assert.equal(runtime!.store.state.goals.at(-1)!.revision, 2)
  })
  await step('C was not retired by task completion: accept and finish another task', async () => {
    const sent = await call('A', 'atn_send', { to: 'C', kind: 'task', content: 'A second bounded task' })
    await result('C', 'A', String(sent.reference))
    assert.equal(runtime!.store.state.nodes.C.phase, 'active')
    const events = await runtime!.events('C')
    const snapshots = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'atn-prototype-goal')
    assert.ok(snapshots.some(event => event.type === 'user/message'
      && event.data.source.kind === 'atn-prototype-goal' && event.data.source.revision === 2))
    assert.ok(JSON.stringify(snapshots).includes(runtime!.store.state.goals.at(-1)!.body))
  })
  await step('Persist a partial vote and simulate a lost acknowledgement after target persistence', async () => {
    recoveryProposal = String((await call('C', 'atn_propose', {
      baseRevision: 2, body: 'Deliver checked results, including resumed votes and deduplicated receipts.', reason: 'recovery checkpoint',
    })).proposalId)
    await call('A', 'atn_vote', { proposalId: recoveryProposal, decision: 'approve' })
    runtime!.loseNextAcknowledgement = true
    const sent = await call('C', 'atn_send', { to: 'X', kind: 'note', content: 'Replay this receipt, not the message' })
    unacknowledged = String(sent.mailId)
    assert.equal(runtime!.store.state.mail[unacknowledged].status, 'queued')
    assert.equal((await runtime!.events('X')).filter(event => event.type === 'user/message'
      && event.data.source.kind === 'atn-prototype-mail' && event.data.source.mailId === unacknowledged).length, 1)
  })
  await step('Dispose the entire owner and kernel, then cold-resume real Session logs and network state', async () => {
    const scratch = runtime!.scratch
    const requestCount = runtime!.store.state.admittedRequests
    await close()
    kernel = await bootKernel(scratch)
    runtime = await attachRuntime(kernel, scratch)
    await runtime.resume()
    assert.equal(runtime.store.state.admittedRequests, requestCount, 'Resume must not reset the budget')
    assert.equal(runtime.store.state.proposals[recoveryProposal].votes.A, 'approve')
    assert.equal(runtime.store.state.mail[unacknowledged].status, 'delivered')
    assert.equal((await runtime.events('X')).filter(event => event.type === 'user/message'
      && event.data.source.kind === 'atn-prototype-mail' && event.data.source.mailId === unacknowledged).length, 1)
    assert.equal(runtime.handles.has('B'), false)
    assert.deepEqual(runtime.store.neighbors('A'), ['C', 'D'])
  })
  await step('Complete resumed unanimous proposal exactly once', async () => {
    await call('D', 'atn_vote', { proposalId: recoveryProposal, decision: 'approve' })
    await call('E', 'atn_vote', { proposalId: recoveryProposal, decision: 'approve' })
    await call('A', 'atn_vote', { proposalId: recoveryProposal, decision: 'approve' })
    assert.equal(runtime!.store.state.goals.length, 3, 'Duplicate vote must not append a second goal revision')
    assert.equal(runtime!.store.state.proposals[recoveryProposal].status, 'committed')
  })
  await step('Settle all remaining tasks, deliver to USER, then release all real Agent handles', async () => {
    await result('E', 'D')
    await result('D', 'C')
    await result('Y', 'X')
    await result('X', 'A')
    await result('A', 'USER')
    await runtime!.finalize()
    assert.equal(runtime!.store.state.mode, 'completed')
    assert.equal(kernel!.ctx.agents.list().length, 0)
  })
  await close()

  await open('leases-and-limits', { liveNodes: 2, totalNodes: 3, requests: 100 })
  await step('Task-driven renewal and outward replacement on logical lease expiry', async () => {
    await runtime!.spawn('A', null, 'Long task', 5)
    await runtime!.settle()
    await call('A', 'atn_spawn', { id: 'B', task: 'Short task', lease: 5 })
    await call('A', 'atn_renew', { duration: 20 })
    await call('A', 'atn_spawn', { id: 'C', task: 'Over resident cap' }, /LIVE_NODE_LIMIT/)
    runtime!.store.advance(6)
    assert.equal(runtime!.store.state.nodes.A.phase, 'active')
    assert.equal(runtime!.store.state.nodes.B.phase, 'draining')
    await result('B', 'A')
    assert.equal(runtime!.store.state.nodes.B.phase, 'retired')
    await call('A', 'atn_spawn', { id: 'C', task: 'Released capacity can be reused' })
    await result('C', 'A')
    await call('C', 'atn_finish')
    await call('A', 'atn_spawn', { id: 'D', task: 'Cumulative cap still applies' }, /TOTAL_NODE_LIMIT/)
    assert.equal(runtime!.store.state.nodes.A.selectedChild, 'B', 'Preserve the chosen path, do not silently jump to a sibling')
  })
  await close()

  await open('expiry-and-stop')
  await step('A silent neighbor never counts as approval; proposal expiry releases old review obligations', async () => {
    await runtime!.spawn('A', null, 'Wait for explicit evidence')
    await runtime!.settle()
    await call('A', 'atn_spawn', { id: 'B', task: 'Check evidence' })
    const proposal = String((await call('A', 'atn_propose', { baseRevision: 1, body: 'Never silently approve', reason: 'timeout' })).proposalId)
    runtime!.store.advance(51)
    assert.equal(runtime!.store.state.proposals[proposal].status, 'expired')
    assert.equal(runtime!.store.state.goals.length, 1)
    await call('B', 'atn_vote', { proposalId: proposal, decision: 'approve' }, /PROPOSAL_EXPIRED/)
  })
  await step('Hard stop fences late votes, renewal and new creation, then releases resources', async () => {
    const proposal = String((await call('A', 'atn_propose', { baseRevision: 1, body: 'Must not commit after stop', reason: 'stop fence' })).proposalId)
    runtime!.halt('User stop fixture')
    assert.throws(() => runtime!.store.vote('B', proposal, 'approve'), /NETWORK_STOPPED/)
    assert.throws(() => runtime!.store.renew('A', 20), /NETWORK_STOPPED/)
    await assert.rejects(runtime!.spawn('C', 'A', 'No resurrection'), /NETWORK_STOPPED/)
    await assert.rejects(runtime!.resume(), /NETWORK_STOPPED/)
    assert.equal(runtime!.store.state.goals.length, 1)
    await runtime!.close()
    assert.equal(kernel!.ctx.agents.list().length, 0)
  })
  await close()

  await open('request-budget', { requests: 3 })
  await step('Real model-request admission is capped across nodes; idle never resets it', async () => {
    await runtime!.spawn('A', null, 'A bounded request budget')
    await runtime!.settle()
    await call('A', 'atn_peers')
    await runtime!.drive('A', [{ tool: 'atn_peers', args: {} }])
    assert.equal(runtime!.store.state.admittedRequests, 3)
    assert.equal(kernel!.model.requests.length, 3)
    assert.equal(runtime!.store.state.mode, 'stopped')
    await runtime!.close()
    assert.equal(kernel!.ctx.agents.list().length, 0)
  })
  await close()
}

try {
  await main()
  status = 'passed'
} catch (error) {
  status = error instanceof Error && error.message === 'INTERACTIVE_EXIT' ? 'interrupted' : 'failed'
  failure = error instanceof Error ? error.stack : String(error)
  console.error(failure)
  try { await close() } catch (cleanup) { console.error('Cleanup failed:', cleanup) }
  process.exitCode = status === 'failed' ? 1 : 0
} finally {
  terminal?.close()
  const evidence = {
    status, failure, generatedAt: new Date().toISOString(), harnessVersion: '0.2.0-rc.2',
    sourceCommit: '639ed015397290b3745d163aafe02ffee4aa3f84',
    realModelCalls: 0, model: 'deterministic fixture; no network adapter installed',
    persistence: 'Real Harness JSONL Sessions + throwaway atomic network snapshot',
    scope: 'In-process kernel composition; not profile/bundle, sandbox inheritance, crash-kill recovery, or swarm-quality validation',
    checkpointCount: checkpoints.length, checkpoints, requests, transcripts, scratchRoots,
  }
  await mkdir(join(directory, 'evidence'), { recursive: true })
  await writeFile(join(directory, 'evidence', 'latest.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`\n${status.toUpperCase()}: ${checkpoints.length} checkpoints; ${requests.length} scripted Harness requests; 0 real model calls.`)
  console.log(`Evidence: ${join(directory, 'evidence', 'latest.json')}`)
}
