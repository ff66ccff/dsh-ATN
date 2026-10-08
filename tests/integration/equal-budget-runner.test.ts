/** Real Harness composition with a deterministic adapter; no live inference evidence. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { PROVIDER_ID } from 'dsh-opencode-go'
import { runPilot } from '../../experiments/run.ts'
import { equalBudgetAllocations, type EqualBudgetMode } from '../../experiments/equal-budget.ts'
import { constructEqualBudgetSubmission, constructEqualBudgetShardAnswer, EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION,
  getEqualBudgetTask, renderEqualBudgetPrompt, renderEqualBudgetSingleScaffoldedPrompt, type EqualBudgetTask } from '../../experiments/equal-budget-task.ts'
import type { PilotDocument } from '../../experiments/tasks.ts'

const model = { id: 'deepseek-v4.1-flash', name: 'Zero-network budget fixture', api: 'test', catalogFree: false,
  referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }

class LedgerFixtureAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private sequence = 0
  constructor(private readonly mode: EqualBudgetMode, private readonly keepReading = false,
    private readonly source = getEqualBudgetTask(17), private readonly readsPerTurn = 1) { super() }
  override resolveModel(provider: string, id: string): Promise<LlmResolvedModelInfo> { return Promise.resolve({ provider, id, name: id }) }
  override async *stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    request.signal?.throwIfAborted()
    this.requests.push(request)
    const rendered = request.messages.flatMap(message => message.role === 'user' ? message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('\n')
    const isCandidate = String(request.sessionId).startsWith('candidate-')
    const shardId = /local result for (shard-\d+)/.exec(rendered)?.[1]
    if (isCandidate) assert.ok(shardId, 'independent candidate must receive its explicit local shard assignment')
    const source = this.source
    const documents: PilotDocument[] = request.messages.flatMap(message => message.role === 'tool' ? message.content.flatMap(block => {
      if (block.type !== 'text') return []
      try {
        const value = JSON.parse(block.text) as Partial<PilotDocument>
        return typeof value.id === 'string' && typeof value.text === 'string' ? [value as PilotDocument] : []
      } catch { return [] }
    }) : [])
    // Read all evidence through real read_document tools. Source metadata supplies no hidden answer.
    const task: EqualBudgetTask = { ...source, documents }
    const required = isCandidate && shardId ? ['policy', `${shardId}/orders`, `${shardId}/events`, `${shardId}/corrections`] : source.documents.map(document => document.id)
    const read = new Set(documents.map(document => document.id)), missing = required.filter(id => !read.has(id)).slice(0, this.readsPerTurn)
    const pastTools = request.messages.flatMap(message => message.role === 'assistant' ? message.content.flatMap(block => block.type === 'tool-call' ? [block.name] : []) : [])
    let tools: { name: string; args: Record<string, unknown> }[] = [], text: string | undefined
    if (this.mode === 'atn-adaptive' && !pastTools.includes('atn_start')) {
      tools = [{ name: 'atn_start', args: { objective: 'Reconcile supplied ledgers', successCriteria: 'Exact fixture answer', constraints: 'Use supplied documents and allocated calls' } }]
    } else if (missing.length || this.keepReading) tools = (this.keepReading ? ['policy'] : missing).map(id => ({ name: 'read_document', args: { id } }))
    else if (isCandidate && shardId) text = JSON.stringify({ shards: { [shardId]: constructEqualBudgetShardAnswer(task, shardId) }, evidence: required })
    else tools = [{ name: 'submit_answer', args: { answer: JSON.stringify(constructEqualBudgetSubmission(task)) } }]
    if (tools.length) {
      for (const [index, tool] of tools.entries()) {
        const id = ToolCallId(`ledger-fixture-${++this.sequence}`), args = JSON.stringify(tool.args)
        yield { type: 'block-start', index, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index, id, name: tool.name, argumentsDelta: args }
        yield { type: 'block-end', index, block: { type: 'tool-call', id, name: tool.name, arguments: args } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: text! }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: text! } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function scratch(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'equal-budget-runner-'))
  t.after(async () => { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }) })
  return directory
}

test('all four real Harness arms accept the ledger fixture under the same N*S allocation without network calls', async t => {
  const directory = await scratch(t)
  for (const allocation of equalBudgetAllocations(16, 32)) {
    const adapter = new LedgerFixtureAdapter(allocation.mode)
    const report = await runPilot({ mode: allocation.mode, model, task: 'ledger-reconciliation', directory: join(directory, allocation.mode),
      maxCalls: 512, maxOutputTokens: 8192, observedTokenLimit: 8_000_000, timeoutMs: 30_000,
      maxAgents: allocation.agents, perNodeSteps: 32, equalBudget: { seed: 17, agents: 16, steps: 32 } }, {
      liveProviderMount: async ctx => { assert.deepEqual(ctx.llm.listProviders(), []); ctx.llm.registerAdapter([PROVIDER_ID], adapter) },
    })
    assert.equal(report.evaluation.passed, true, `${allocation.mode}: ${report.stopReason}`)
    assert.equal(report.factFlowAudit!.passed, true, `${allocation.mode}: evidence flow must reach the submitting entry`)
    assert.equal(report.cleanup, 'released')
    assert.equal(report.issuedModelCalls, adapter.requests.length)
    assert.equal(report.allocatedConsumption!.reduce((sum, row) => sum + row.used, 0), adapter.requests.length)
    assert.ok(report.allocatedConsumption!.every(row => row.used <= row.limit))
    assert.ok(report.issuedModelCalls <= 512)
    assert.equal(report.totalAgents, allocation.mode === 'independent-pool' ? 16 : 1)
    if (allocation.mode === 'independent-pool') {
      assert.equal(report.issuedModelCalls, 15 * 5 + 26, '15 independent 4-read-plus-answer candidates and one 25-read-plus-submit entry')
      assert.deepEqual(report.allocatedConsumption!.map(row => row.used), [26, ...Array<number>(15).fill(5)])
      assert.equal(report.independentCandidates.filter(candidate => candidate.accepted).length, 15)
      for (const candidate of report.independentCandidates) if (candidate.accepted) {
        const answer = JSON.parse(candidate.answer)
        assert.equal(Object.keys(answer.shards).length, 1)
        assert.equal(answer.evidence.length, 4)
      }
    }
    assert.equal(report.metrics!.totals.tokens.inputTokens.unknownCalls, adapter.requests.length, 'unknown usage must remain unknown')
    for (const request of adapter.requests) {
      assert.equal(request.provider, PROVIDER_ID)
      assert.equal(request.model, model.id)
      assert.equal(request.maxTokens, 8192)
      assert.ok(request.tools?.some(tool => tool.name === 'read_document'))
      assert.ok(request.tools?.some(tool => tool.name === 'submit_answer'))
      if (allocation.mode === 'independent-pool') assert.ok(request.tools?.every(tool => !/atn_|teammate|send_message/.test(tool.name)))
    }
  }
})

test('real runner stops at the individual cap in each arm and retains failed, unknown-usage attempts', async t => {
  const directory = await scratch(t)
  for (const allocation of equalBudgetAllocations(2, 2)) {
    const adapter = new LedgerFixtureAdapter(allocation.mode, true)
    const report = await runPilot({ mode: allocation.mode, model, task: 'ledger-reconciliation', directory: join(directory, allocation.mode),
      maxCalls: 4, maxOutputTokens: 8192, observedTokenLimit: 8_000_000, timeoutMs: 10_000,
      maxAgents: allocation.agents, perNodeSteps: 2, equalBudget: { seed: 17, agents: 2, steps: 2 } }, {
      liveProviderMount: async ctx => { ctx.llm.registerAdapter([PROVIDER_ID], adapter) },
    })
    assert.equal(report.evaluation.passed, false)
    assert.equal(report.cleanup, 'released')
    assert.equal(report.issuedModelCalls, adapter.requests.length)
    assert.equal(report.allocatedConsumption!.reduce((sum, row) => sum + row.used, 0), adapter.requests.length)
    assert.ok(report.allocatedConsumption!.every(row => row.used === row.limit))
    assert.ok(report.issuedModelCalls <= 4)
    assert.equal(report.metrics!.totals.tokens.totalTokens.unknownCalls, adapter.requests.length)
  }
})

test('all four Harness arms execute the revision-two paired-read witness with sixteen compact shards', async t => {
  const directory = await scratch(t)
  const fixture = getEqualBudgetTask(17, 16, { ordersPerShard: 10, compactAnswer: true })
  for (const allocation of equalBudgetAllocations(16, 32)) {
    const adapter = new LedgerFixtureAdapter(allocation.mode, false, fixture, 2)
    const report = await runPilot({ mode: allocation.mode, model, task: 'ledger-reconciliation', directory: join(directory, allocation.mode),
      maxCalls: 512, maxOutputTokens: 8192, observedTokenLimit: 8_000_000, timeoutMs: 30_000,
      maxAgents: allocation.agents, perNodeSteps: 32, equalBudget: { seed: 17, agents: 16, steps: 32, shards: 16, ordersPerShard: 10, compactAnswer: true } }, {
      liveProviderMount: async ctx => { ctx.llm.registerAdapter([PROVIDER_ID], adapter) },
    })
    assert.equal(report.evaluation.passed, true, `${allocation.mode}: ${report.stopReason}`)
    assert.equal(report.factFlowAudit!.passed, true, `${allocation.mode}: every shard must reach the entry`)
    assert.equal(report.factFlowAudit!.auditedFacts, 16)
    assert.equal(report.cleanup, 'released')
    assert.ok(report.allocatedConsumption!.every(row => row.used <= row.limit))
    assert.equal(report.issuedModelCalls, allocation.mode === 'independent-pool' ? 15 * 3 + 26 : allocation.mode === 'atn-adaptive' ? 27 : 26)
    assert.equal(report.issuedModelCalls, adapter.requests.length)
    assert.equal(report.allocatedConsumption!.reduce((sum, row) => sum + row.used, 0), adapter.requests.length)
    if (allocation.mode === 'independent-pool') {
      assert.deepEqual(report.allocatedConsumption!.map(row => row.used), [26, ...Array<number>(15).fill(3)])
      const entryRequest = adapter.requests.find(request => !String(request.sessionId).startsWith('candidate-'))!
      const entryText = entryRequest.messages.flatMap(message => message.role === 'user' ? message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('\n')
      assert.match(entryText, /You own the remaining unassigned shard: shard-16/)
    }
    assert.ok(adapter.requests.some(request => request.messages.some(message => message.role === 'assistant'
      && message.content.filter(block => block.type === 'tool-call' && block.name === 'read_document').length === 2)), 'existing Harness tools must execute two reads from one model call')
  }
})

test('V3 scaffold and single send identical system, tools, model, fixture and limits with only the required prompt appendix', async t => {
  const directory = await scratch(t), fixture = getEqualBudgetTask(17, 16, { ordersPerShard: 10, compactAnswer: true })
  const runs = []
  for (const mode of ['single', 'single-scaffolded'] as const) {
    const adapter = new LedgerFixtureAdapter(mode, false, fixture, 2), runDirectory = join(directory, mode)
    const report = await runPilot({ mode, model, task: 'ledger-reconciliation', directory: runDirectory,
      maxCalls: 512, maxOutputTokens: 8192, observedTokenLimit: 8_000_000, timeoutMs: 30_000,
      maxAgents: 1, perNodeSteps: 32, equalBudget: { seed: 17, agents: 16, steps: 32, shards: 16, ordersPerShard: 10, compactAnswer: true } }, {
      liveProviderMount: async ctx => { ctx.llm.registerAdapter([PROVIDER_ID], adapter) },
    })
    assert.equal(report.evaluation.passed, true)
    assert.equal(report.factFlowAudit!.passed, true)
    assert.equal(report.totalAgents, 1)
    assert.equal(report.peakAgents, 1)
    assert.equal(report.cleanup, 'released')
    assert.equal(report.issuedModelCalls, 26)
    assert.deepEqual(report.allocatedConsumption, [{ alias: 'agent-1', limit: 512, used: 26 }])
    assert.deepEqual(adapter.requests[0].tools?.map(tool => tool.name).sort(), ['read_document', 'submit_answer'])
    const prompt = await readFile(join(runDirectory, report.taskPrompt!.file), 'utf8')
    const userText = adapter.requests[0].messages.flatMap(message => message.role === 'user'
      ? message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('\n')
    assert.equal(prompt, userText, 'persisted prompt is the exact first user task sent to the adapter')
    assert.equal(prompt, mode === 'single' ? renderEqualBudgetPrompt(fixture) : renderEqualBudgetSingleScaffoldedPrompt(fixture))
    assert.equal(report.taskPrompt!.sha256, createHash('sha256').update(prompt).digest('hex'))
    const manifest = JSON.parse(await readFile(join(runDirectory, 'manifest.json'), 'utf8'))
    assert.deepEqual(manifest.taskPrompt, report.taskPrompt)
    assert.deepEqual(JSON.parse(await readFile(join(runDirectory, 'input.json'), 'utf8')), fixture)
    runs.push({ adapter, report, manifest })
  }
  const [single, scaffold] = runs
  assert.equal(single.manifest.taskSha256, scaffold.manifest.taskSha256)
  assert.deepEqual(single.report.limits, scaffold.report.limits)
  const normalize = (request: GenerateOptions, scaffolded: boolean) => {
    const { sessionId: _session, signal: _signal, messages, ...settings } = request
    return { ...settings, messages: messages.map(message => ({ role: message.role, content: message.content.map(block =>
      scaffolded && message.role === 'user' && block.type === 'text'
        ? { ...block, text: block.text.replace(`\n\n${EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION}`, '') } : block) })) }
  }
  assert.deepEqual(normalize(scaffold.adapter.requests[0], true), normalize(single.adapter.requests[0], false),
    'every model-visible field is identical after removing the one scaffold appendix; transport identities are ignored')
})

test('V3 scaffold retains the ordinary single admission cap and persists its exact prompt even before a provider failure', async t => {
  const directory = await scratch(t), fixture = getEqualBudgetTask(17, 16, { ordersPerShard: 10, compactAnswer: true })
  const baseOptions = { mode: 'single-scaffolded' as const, model, task: 'ledger-reconciliation' as const,
    maxCalls: 4, maxOutputTokens: 8192, observedTokenLimit: 8_000_000, timeoutMs: 10_000,
    maxAgents: 1, perNodeSteps: 2, equalBudget: { seed: 17, agents: 2, steps: 2, shards: 16, ordersPerShard: 10, compactAnswer: true } }
  const adapter = new LedgerFixtureAdapter('single-scaffolded', true, fixture)
  const capped = await runPilot({ ...baseOptions, directory: join(directory, 'cap') }, {
    liveProviderMount: async ctx => { ctx.llm.registerAdapter([PROVIDER_ID], adapter) },
  })
  assert.equal(capped.issuedModelCalls, 4)
  assert.equal(capped.evaluation.passed, false)
  assert.deepEqual(capped.allocatedConsumption, [{ alias: 'agent-1', limit: 4, used: 4 }])
  assert.equal(capped.metrics!.totals.tokens.totalTokens.unknownCalls, 4)
  const failed = await runPilot({ ...baseOptions, directory: join(directory, 'provider-failure') }, {
    liveProviderMount: async () => { throw Object.assign(new Error('Test provider unavailable'), { code: 'UNKNOWN_MODEL' }) },
  })
  assert.equal(failed.issuedModelCalls, 0)
  assert.equal(failed.stopReason, 'host-error:UNKNOWN_MODEL')
  assert.equal(failed.metrics, null)
  assert.equal(failed.evaluation.passed, false)
  const persisted = await readFile(join(directory, 'provider-failure', failed.taskPrompt!.file), 'utf8')
  assert.equal(persisted, renderEqualBudgetSingleScaffoldedPrompt(fixture))
  assert.equal(failed.taskPrompt!.sha256, createHash('sha256').update(persisted).digest('hex'))
  await assert.rejects(runPilot({ ...baseOptions, equalBudget: undefined, directory: join(directory, 'invalid') }), /requires an equal-budget ledger task/)
})
