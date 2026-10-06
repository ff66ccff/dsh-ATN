/** Pure fixtures: these tests never boot a profile, read credentials or issue HTTP/provider calls. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, isAgentLoopRequest, markAgentLoopRequest, resolveRetryPolicy,
  type GenerateOptions, type LlmCallConfig, type LlmModelInfo, type PreparedLlmCall, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { PROVIDER_ID } from 'dsh-opencode-go'
import { ImportedProfileAdapter, selectImportedValidationModels, type ImportedRequestIdentity } from '../../experiments/shifting-evidence-profile-run.ts'
import type { PilotModel } from '../../experiments/provider.ts'

const retryPolicy = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'test-fixture')
const imported = (id: string, provider = PROVIDER_ID): LlmModelInfo => ({ provider, id, name: id })
const catalogModel = (id: string, free = true): PilotModel => ({ id, name: id, api: 'fixture', catalogFree: free,
  referenceCostPerMillion: { input: free ? 0 : 1, output: free ? 0 : 2, cacheRead: 0, cacheWrite: 0 } })
const providerInfo = { id: PROVIDER_ID, name: 'Already mounted profile fixture' }
const chunks: StreamChunk[] = [{ type: 'block-start', index: 0, blockType: 'text' },
  { type: 'text-delta', index: 0, text: 'fixture' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'fixture' } },
  { type: 'finish', reason: { kind: 'stop' }, replayState: { response: { opaque: 'fixture-response' }, blocks: [{ opaque: 'fixture-block' }] } }]
async function drain(stream: AsyncIterable<StreamChunk>) { const seen: StreamChunk[] = []; for await (const chunk of stream) seen.push(chunk); return seen }

function fixture(config: (requested: LlmCallConfig) => LlmCallConfig = requested => ({ ...requested }), sourceIdentity?: ImportedRequestIdentity) {
  const prepares: Array<{ config: LlmCallConfig; signal?: AbortSignal }> = []
  const requests: GenerateOptions[] = []
  const discovery: string[] = []
  const source = {
    listProviders: () => [providerInfo],
    listModels: async (provider: string) => { discovery.push(`models:${provider}`); return [imported('deepseek-v4.1-flash')] },
    resolveModelInfo: async (provider: string, model: string, signal?: AbortSignal) => { discovery.push(`resolve:${provider}:${model}:${signal?.aborted ?? false}`); return imported(model, provider) },
    prepareCall: async (requested: LlmCallConfig, signal?: AbortSignal): Promise<PreparedLlmCall> => {
      prepares.push({ config: requested, signal })
      return { config: config(requested), retryPolicy, adapterDefaults: {}, async *stream(request) {
        if (sourceIdentity && isAgentLoopRequest(request)) assert.equal(sourceIdentity.isAgentLoopRequest(request), true, 'installed identity must be marked before parent streaming')
        requests.push(request); yield* chunks
      } }
    },
  }
  const events: Array<Record<string, unknown>> = []
  return { prepares, requests, discovery, source, events, adapter: new ImportedProfileAdapter(source, retryPolicy, event => events.push(event), sourceIdentity) }
}

test('PROFILE-BRIDGE-01: selection intersects the actual imported provider and live authorized catalog, never inferring Space Bunny import', () => {
  const longcat = catalogModel('longcat-2.5-preview-free'), deepseek = catalogModel('deepseek-v4.1-flash', false)
  const bunny = catalogModel('space-bunny-free'), unrelated = catalogModel('other-paid-model', false)
  const actual = [imported(longcat.id), imported(deepseek.id), imported(bunny.id, 'another-provider')]
  const liveAuthorized = [bunny, deepseek, longcat]
  assert.deepEqual(selectImportedValidationModels(actual, liveAuthorized), [deepseek, longcat])
  assert.deepEqual(selectImportedValidationModels(actual, liveAuthorized, [longcat.id, deepseek.id]), [longcat, deepseek])
  assert.throws(() => selectImportedValidationModels(actual, liveAuthorized, [bunny.id]), /absent from the actual dsh import/)
  assert.throws(() => selectImportedValidationModels([imported('missing-live')], liveAuthorized, ['missing-live']), /absent/)
  assert.throws(() => selectImportedValidationModels([imported(unrelated.id)], [unrelated], [unrelated.id]), /authorized free-or-DeepSeek/)
  assert.throws(() => selectImportedValidationModels(actual, liveAuthorized, [longcat.id, longcat.id]), /unique/)
  assert.throws(() => selectImportedValidationModels(actual, liveAuthorized, []), /unique/)
  assert.throws(() => selectImportedValidationModels([], liveAuthorized), /unique/)
})

test('PROFILE-BRIDGE-02: adapter delegates prepared streaming and preserves loop, tools, signal, session and replay fields', async () => {
  // The installed LLM package has an independent module-local WeakSet.
  const installedMarkers = new WeakSet<GenerateOptions>(), sourceMarks: GenerateOptions[] = []
  const identity: ImportedRequestIdentity = {
    markAgentLoopRequest<T extends GenerateOptions>(request: T): T { installedMarkers.add(request); sourceMarks.push(request); return request },
    isAgentLoopRequest(request) { return installedMarkers.has(request) },
  }
  const f = fixture(undefined, identity)
  const signal = new AbortController().signal
  const request = markAgentLoopRequest(Object.assign({ provider: PROVIDER_ID, model: 'deepseek-v4.1-flash', maxTokens: 1536,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Private fixture prompt' }] })],
    tools: [{ name: 'fixture_tool', description: 'Fixture', parameters: { type: 'object', properties: {} } }],
    sessionId: SessionId('profile-fixture-session'), signal, temperature: 0.2, stop: ['STOP'] } as GenerateOptions,
  { replay: { cursor: 'fixture-cursor' }, toolHistory: { tools: [], updates: [] } }))
  assert.equal(identity.isAgentLoopRequest(request), false, 'the workspace marker cannot mark the installed package WeakSet')
  assert.equal(f.adapter.providerInfo(PROVIDER_ID), providerInfo)
  assert.equal(f.adapter.providerRetryPolicy(), retryPolicy)
  assert.deepEqual(await f.adapter.listModels(PROVIDER_ID), [imported('deepseek-v4.1-flash')])
  assert.deepEqual(await f.adapter.resolveModel(PROVIDER_ID, 'deepseek-v4.1-flash', signal), imported('deepseek-v4.1-flash'))
  assert.deepEqual(await drain(f.adapter.stream(request)), chunks)
  assert.equal(f.prepares.length, 1)
  assert.equal(f.prepares[0].signal, signal)
  assert.deepEqual(f.prepares[0].config, { provider: PROVIDER_ID, model: 'deepseek-v4.1-flash', maxTokens: 1536,
    reasoningEffort: undefined, temperature: 0.2, stop: request.stop })
  assert.equal(f.requests.length, 1)
  const forwarded = f.requests[0] as GenerateOptions & { replay: unknown }
  assert.equal(forwarded.messages, request.messages)
  assert.equal(forwarded.tools, request.tools)
  assert.equal(forwarded.signal, signal)
  assert.equal(forwarded.sessionId, request.sessionId)
  assert.equal(forwarded.toolHistory, request.toolHistory)
  assert.equal(forwarded.replay, request.replay)
  assert.equal(isAgentLoopRequest(forwarded), true)
  assert.equal(identity.isAgentLoopRequest(forwarded), true)
  assert.deepEqual(sourceMarks, [forwarded])
  assert.equal(sourceMarks[0], f.requests[0], 'the source marker and parent stream receive the same exact request object')
  assert.equal(JSON.stringify(f.events).includes('Private fixture prompt'), false)
  assert.deepEqual(f.events.map(event => event.type), ['imported-call-start', 'imported-call-prepared', 'imported-call-finish'])
  const prepared = f.events.find(event => event.type === 'imported-call-prepared')!
  assert.equal(prepared.agentLoopRequest, true)
  assert.equal(prepared.sourceAgentLoopRequest, true)
  assert.throws(() => f.adapter.providerInfo('another-provider'), /no longer mounted/)
  const manual = fixture(undefined, identity)
  await drain(manual.adapter.stream({ provider: PROVIDER_ID, model: 'deepseek-v4.1-flash', messages: [], maxTokens: 1536 }))
  assert.equal(isAgentLoopRequest(manual.requests[0]), false)
  assert.equal(identity.isAgentLoopRequest(manual.requests[0]), false)
  assert.equal(sourceMarks.length, 1, 'manual requests do not receive an invented loop marker')
})

test('PROFILE-BRIDGE-03: route changes and increased output bounds never reach the parent stream', async () => {
  for (const replacement of [{ provider: 'other-provider' }, { model: 'other-model' }, { maxTokens: 1537 }]) {
    const f = fixture(config => ({ ...config, ...replacement }))
    await assert.rejects(() => drain(f.adapter.stream({ provider: PROVIDER_ID, model: 'deepseek-v4.1-flash', maxTokens: 1536, messages: [] })), /route or output bound/)
    assert.equal(f.requests.length, 0)
    assert.equal(f.events.at(-1)?.type, 'imported-call-thrown')
  }
  const lower = fixture(config => ({ ...config, maxTokens: 1024 }))
  await drain(lower.adapter.stream({ provider: PROVIDER_ID, model: 'deepseek-v4.1-flash', maxTokens: 1536, messages: [] }))
  assert.equal(lower.requests[0].maxTokens, 1024)
})

test('PROFILE-BRIDGE-04: a prepared undefined output bound cannot erase the experiment cap', async () => {
  const f = fixture(config => ({ ...config, maxTokens: undefined }))
  let error: unknown
  try { await drain(f.adapter.stream({ provider: PROVIDER_ID, model: 'deepseek-v4.1-flash', maxTokens: 1536, messages: [] })) }
  catch (caught) { error = caught }
  if (error) { assert.match(String(error), /bound|token/i); assert.equal(f.requests.length, 0) }
  else assert.equal(f.requests[0].maxTokens, 1536, 'a missing prepared value must retain the original finite output cap')
})
