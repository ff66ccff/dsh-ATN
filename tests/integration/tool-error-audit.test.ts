import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { OpencodeGoAdapter, OpencodeGoCatalog, PlainConfig, PROVIDER_ID, type OpencodeGoConfig } from 'dsh-opencode-go'
import type { StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm'
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

test('public adapter keeps valid tool names and cannot repair incoming NUL names into advertised tools', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/tool-error-nul.json', import.meta.url), 'utf8')) as {
    advertisedTools: ToolSchema[]
    incidents: { call: { name: string; arguments: string } }[]
  }
  const calls = [
    { name: 'read_evidence', arguments: '{"id":"mine"}' },
    { name: 'atn_status', arguments: '{}' },
    ...fixture.incidents.map(incident => incident.call),
    // Unlike the recorded names, stripping this synthetic NUL would select a real tool.
    { name: 'atn_status\0', arguments: '{}' },
  ]
  const requests: { tools: { type: string; function: ToolSchema }[]; model: string; stream: boolean }[] = []
  let discoveries = 0
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-adapter-audit-'))
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/v1/models') {
        discoveries++
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [{
          id: 'audit-fixture', type: 'chat', name: 'Audit fixture',
          api: { 'chat-completions': {} }, modalities: { input: ['text'] },
          limit: { context: 8192, output: 256 },
        }] }))
        return
      }
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      const body: Buffer[] = []
      for await (const chunk of request) body.push(Buffer.from(chunk))
      const index = requests.length
      requests.push(JSON.parse(Buffer.concat(body).toString('utf8')))
      const call = calls[index]
      if (!call) throw new Error('unexpected extra inference request')
      const frames = [
        { id: 'audit-response', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `audit-call-${index}`, type: 'function', function: call }] }, finish_reason: null }] },
        { id: 'audit-response', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n'
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end(frames)
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: String(error) } }))
    }
  })
  let adapter: OpencodeGoAdapter | undefined
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const baseURL = `http://127.0.0.1:${address.port}/v1`
    const config = PlainConfig({
      baseURL, freeBaseURL: baseURL, freeEnabled: false, proxyURL: '',
      apiKeyEnv: 'ATN_AUDIT_TEST_ONLY', autoSwitch: false,
      requestTimeoutMs: 5000, requestPreparationTimeoutMs: 5000, streamIdleTimeoutMs: 5000,
    } as OpencodeGoConfig)
    // The public catalog captures its cache path at construction. Never read/write the user's cache.
    const previousHome = process.env.DSH_HOME
    let catalog: OpencodeGoCatalog
    try {
      process.env.DSH_HOME = scratch
      catalog = new OpencodeGoCatalog(baseURL, 60_000)
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
    adapter = new OpencodeGoAdapter({
      config: () => config, catalog: () => catalog,
      resolveApiKey: async () => 'test-only-not-a-credential',
    })
    const advertisedNames = fixture.advertisedTools.map(tool => tool.name)
    for (const [index, call] of calls.entries()) {
      const chunks: StreamChunk[] = []
      for await (const chunk of adapter.stream({
        provider: PROVIDER_ID, model: 'audit-fixture', maxTokens: 256,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Replay fixture' }] }],
        tools: fixture.advertisedTools,
      })) chunks.push(chunk)
      assert.equal(requests.length, index + 1, 'one adapter call makes one local inference request')
      assert.equal(requests[index]!.model, 'audit-fixture')
      assert.equal(requests[index]!.stream, true)
      assert.deepEqual(requests[index]!.tools.map(tool => ({
        name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters,
      })), fixture.advertisedTools, 'outgoing schemas retain the advertised names and arguments')
      assert.ok(requests[index]!.tools.every(tool => tool.type === 'function' && !tool.function.name.includes('\0')))
      const completed = chunks.flatMap(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call' ? [chunk.block] : [])
      assert.deepEqual(completed.map(block => block.name), [call.name], 'the current public adapter preserves the incoming name exactly')
      assert.equal(completed[0]!.id, `audit-call-${index}`)
      assert.deepEqual(JSON.parse(completed[0]!.arguments), JSON.parse(call.arguments))
      if (call.name.includes('\0')) {
        assert.ok(completed.every(block => !advertisedNames.includes(block.name)), 'corrupt names must never select an advertised tool')
      }
      const finishes = chunks.filter(chunk => chunk.type === 'finish')
      assert.equal(finishes.length, 1, 'the adapter emits exactly one terminal state')
      assert.equal(finishes[0]!.reason.kind, 'tool-calls')
      assert.equal(chunks.at(-1)?.type, 'finish', 'no output follows the terminal state')
    }
    assert.equal(discoveries, 1, 'all inference requests use the owned local catalog')
  } finally {
    try {
      await adapter?.dispose()
    } finally {
      try {
        if (server.listening) {
          const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
          server.closeAllConnections()
          await closed
        }
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    }
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
