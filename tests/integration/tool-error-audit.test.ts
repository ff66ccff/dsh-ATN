import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stream as completionStream } from 'opencode-go-pi-ai/api/openai-completions'
import { normalizeContext } from 'opencode-go-pi-ai/utils/transcript'
import { bootKernel, createHostAgent, drive } from '../fixtures/kernel.ts'
import { auditHistoricalErrors, classifyFinishError, classifyToolError } from '../../experiments/tool-error-audit.ts'

test('error audit covers all 35 finish failures without treating tool failures as finish failures', async () => {
  const audit = JSON.parse(await readFile(new URL('../../experiments/results/tool-error-audit-20261005.json', import.meta.url), 'utf8'))
  assert.equal(audit.finishErrors.length, 35)
  assert.deepEqual(audit.finishCounts, { TRANSPORT: 26, RATE_LIMIT: 4, EMPTY_RESPONSE: 1, SERVER: 4 })
  assert.equal(new Set(audit.finishErrors.map((row: { id: string }) => row.id)).size, 35)
  assert.equal(audit.toolErrors.length, 224)
  for (const row of audit.finishErrors) assert.equal(classifyFinishError(row.errorCode), row.category)
  for (const row of audit.toolErrors) assert.equal(classifyToolError(row), row.category)
  assert.ok(audit.runs.every((run: { finishCountMatchesReport: boolean }) => run.finishCountMatchesReport))
  assert.equal(audit.unclassified, 0)
  assert.equal(audit.requestHeadersAudited, 192)
  assert.equal(audit.invalidAdvertisedNames, 0)
  assert.throws(() => classifyFinishError('FUTURE_ERROR'), /unclassified/i)
  assert.throws(() => classifyToolError({ message: 'new unknown failure', errorCode: null, toolName: 'atn_status' }), /unclassified/i)
})

test('installed provider parser preserves both valid and NUL names from synthetic HTTP responses', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/tool-error-nul.json', import.meta.url), 'utf8'))
  const names = ['read_evidence', 'atn_status', ...fixture.incidents.map((incident: { call: { name: string } }) => incident.call.name)]
  for (const name of names) {
    let requests = 0
    const response = completionStream({ id: 'audit-fixture', name: 'Audit fixture', api: 'openai-completions',
      provider: 'openai', baseUrl: 'https://audit.invalid/v1', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 256,
    }, normalizeContext({ messages: [{ role: 'user', content: 'Replay fixture', timestamp: 0 }], tools: fixture.advertisedTools }), {
      apiKey: 'test-only-not-a-credential', maxRetries: 0,
      fetch: async (_input, init) => {
        requests++
        const body = JSON.parse(String(init!.body))
        assert.ok(body.tools.every((tool: { function: { name: string } }) => !tool.function.name.includes('\0')))
        const frames = [
          { id: 'audit-response', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'audit-call', type: 'function', function: { name, arguments: '{}' } }] }, finish_reason: null }] },
          { id: 'audit-response', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
        ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n'
        return new Response(frames, { headers: { 'Content-Type': 'text/event-stream' } })
      },
    })
    const seen: string[] = []
    for await (const event of response) {
      if (event.type === 'toolcall_end') seen.push(event.toolCall.name)
      if (event.type === 'error') assert.fail(event.error.errorMessage)
    }
    assert.equal(requests, 1)
    assert.deepEqual(seen, [name], 'the parser copies the response name; it neither injects nor repairs NUL')
  }
})

test('NUL incident is already present in the incoming model stream and absent from advertised schemas', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/tool-error-nul.json', import.meta.url), 'utf8'))
  assert.equal(fixture.incidents.length, 2)
  assert.ok(fixture.advertisedTools.every((tool: { name: string }) => /^[a-z][a-z0-9_]*$/.test(tool.name)))
  assert.equal(JSON.stringify(fixture.advertisedTools).includes('\\u0000'), false)
  for (const incident of fixture.incidents) {
    assert.ok(incident.stream.name.includes('\0'))
    assert.equal(incident.stream.name, incident.call.name)
    assert.equal(incident.result.error.code, 'UNKNOWN_TOOL')
    assert.ok(!fixture.advertisedTools.some((tool: { name: string }) => tool.name === incident.call.name))
  }
  assert.ok(fixture.textAlsoContainsNul)
})

test('real Harness rejects preserved NUL names without corrupting registry or dispatching another tool', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/tool-error-nul.json', import.meta.url), 'utf8'))
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-error-replay-'))
  const kernel = await bootKernel(scratch)
  try {
    const host = await createHostAgent(kernel, 'nul-replay')
    await kernel.ctx.atn.start(host, { objective: 'Replay error evidence', successCriteria: 'Corrupt names are rejected; valid names still work', constraints: 'No provider calls' })
    kernel.model.enqueue('nul-replay', [
      ...fixture.incidents.map((incident: { call: { name: string; arguments: string } }) => ({ tool: incident.call.name, args: JSON.parse(incident.call.arguments) })),
      { tool: 'atn_status', args: {} },
    ])
    await drive(host, 'Replay the recorded tool calls, then check status.')
    const results = host.session.snapshotEvents().filter(event => event.type === 'tool/result')
    assert.equal(results.length, 3)
    for (const event of results.slice(0, 2)) {
      if (event.type !== 'tool/result') assert.fail('tool result expected')
      assert.equal(event.data.error?.code, 'UNKNOWN_TOOL')
      assert.equal(event.data.message.isError, true)
    }
    const final = results[2]!
    if (final.type !== 'tool/result') assert.fail('tool result expected')
    assert.notEqual(final.data.message.isError, true, 'valid registered name continues to dispatch')
    for (const request of kernel.model.requests) {
      assert.ok(request.options.tools!.every(tool => !tool.name.includes('\0')))
      assert.equal(new Set(request.options.tools!.map(tool => tool.name)).size, request.options.tools!.length)
    }
  } finally {
    await kernel.ctx.fiber.dispose()
    // This test owns only its freshly-created temporary directory.
    await rm(scratch, { recursive: true, force: true })
  }
})

test('full local archive reproduces the checked-in classification when available', async t => {
  const source = new URL('../../.artifacts/experiments/full-feedback-bounded-20261005/batch.json', import.meta.url)
  try { await readFile(source) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    t.skip('historical .artifacts archive is not distributed; checked-in census and NUL fixture remain tested')
    return
  }
  const expected = JSON.parse(await readFile(new URL('../../experiments/results/tool-error-audit-20261005.json', import.meta.url), 'utf8'))
  const actual = await auditHistoricalErrors()
  assert.deepEqual(actual, expected)
})
