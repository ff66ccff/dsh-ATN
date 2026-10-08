/** Zero-network fixtures for the imported profile adapter entry point; not live efficacy evidence. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { PROVIDER_ID } from 'dsh-opencode-go'
import { runShiftingEvidence } from '../../experiments/shifting-evidence-run.ts'
import { ShiftingMailScript } from '../../experiments/shifting-evidence-script.ts'
import { ShiftingEvidenceScenario, createShiftingEvidenceTask } from '../../experiments/shifting-evidence-task.ts'

const model = { id: 'deepseek-v4.1-flash', name: 'Zero-network imported-route fixture', api: 'test', catalogFree: false,
  referenceCostPerMillion: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
const limits = { model, mode: 'adaptive' as const, agents: 8, seed: 17, chainLength: 2, perNodeSteps: 48,
  maxCalls: 384, maxOutputTokens: 1536, timeoutMs: 30000, observedTokenLimit: 400000 }
const provenance = { provider: PROVIDER_ID, plugin: 'dsh-opencode-go', profile: 'zero-network-profile-fixture',
  sourceProfile: 'original-profile-fixture', modelImport: 'dsh-desktop-profile-llm', mount: 'dsh-profile-import' } as const

class AuditedFixtureAdapter extends ShiftingMailScript {
  requests: GenerateOptions[] = []
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield* super.stream(options)
  }
}

test('PROFILE-MOUNT-01: imported live mount and scripted seam retain distinct provenance/execution and identical node capabilities/ACL', async () => {
  // Keep the pre-extension red run zero-network: the old runner would otherwise mount its real fallback provider.
  assert.equal(runShiftingEvidence.length, 3, 'runner must expose the explicit third live-provider mount argument')
  const scratch = await mkdtemp(join(tmpdir(), 'atn-profile-mount-'))
  const adapter = new AuditedFixtureAdapter()
  let mounts = 0
  const created: Array<{ id: string; options: unknown }> = []
  try {
    const live = await runShiftingEvidence({ ...limits, directory: join(scratch, 'imported') }, undefined, {
      liveProviderMount: async (ctx: Context) => {
        mounts++
        assert.deepEqual(ctx.llm.listProviders(), [], 'the standalone OpenCode Go adapter must not already be mounted')
        ctx.llm.registerAdapter([PROVIDER_ID], adapter)
        ctx.on('agent/created', ({ agent }) => {
          // Spawn inherits the route; the shared experiment cap supplies an omitted child maxTokens.
          const options = JSON.parse(JSON.stringify(agent.options))
          created.push({ id: String(agent.id), options: { ...options, maxTokens: options.maxTokens ?? limits.maxOutputTokens } })
          return undefined
        })
      },
      provenance: Object.assign({}, provenance, { apiKey: 'FIXTURE_SECRET_NEVER_EXPORT', credentials: { secret: 'FIXTURE_SECRET_NEVER_EXPORT' } }),
    })
    assert.equal(mounts, 1)
    assert.equal(live.execution, 'live-provider', 'the live entry point stays live even when this regression supplies a zero-network adapter')
    assert.deepEqual(live.providerProvenance, provenance)
    assert.equal(live.passed, true)
    const liveManifest = JSON.parse(await readFile(join(scratch, 'imported', 'manifest.json'), 'utf8'))
    assert.equal(liveManifest.execution, 'live-provider')
    assert.deepEqual(liveManifest.providerProvenance, provenance)
    assert.equal(JSON.stringify(live).includes('FIXTURE_SECRET_NEVER_EXPORT'), false)
    assert.equal(JSON.stringify(liveManifest).includes('FIXTURE_SECRET_NEVER_EXPORT'), false)
    assert.equal(created.length, 8)
    created.forEach(node => assert.deepEqual(node.options, created[0].options))
    const requests = new Map(adapter.requests.map(request => [String(request.sessionId), request]))
    assert.equal(requests.size, 8)
    const advertised = ['atn_finish', 'atn_send', 'atn_spawn', 'atn_start', 'atn_status', 'read_evidence', 'submit_checkpoint']
    for (const request of adapter.requests) {
      assert.equal(request.provider, PROVIDER_ID)
      assert.equal(request.model, model.id)
      assert.equal(request.maxTokens, limits.maxOutputTokens)
      assert.deepEqual((request.tools ?? []).map(tool => tool.name).sort(), advertised)
    }
    // Verify rendered read_evidence records remain bound to the creation-order local slots.
    const scenario = new ShiftingEvidenceScenario(createShiftingEvidenceTask(8, 17, 2))
    created.forEach(node => scenario.register(node.id))
    for (const phase of [1, 2] as const) {
      if (phase === 2) scenario.advance('phase-1-checkpoint')
      for (const node of created) {
        const allowed = scenario.read(node.id).documents
        let observed = false
        for (const request of adapter.requests.filter(row => String(row.sessionId) === node.id)) {
          const calls = new Map(request.messages.flatMap(message => message.role === 'assistant' ? message.content.flatMap(block =>
            block.type === 'tool-call' ? [[String(block.id), block.name] as const] : []) : []))
          for (const message of request.messages) if (message.role === 'tool' && calls.get(String(message.toolCallId)) === 'read_evidence') {
            for (const block of message.content) if (block.type === 'text') {
              const value = JSON.parse(block.text)
              if (value.phase === phase && Array.isArray(value.documents)) { observed = true; assert.deepEqual(value.documents, allowed) }
            }
          }
        }
        assert.ok(observed, `phase ${phase} local ACL rendered for ${node.id}`)
      }
    }
    const script = await runShiftingEvidence({ ...limits, directory: join(scratch, 'scripted') }, { adapter: new ShiftingMailScript() })
    assert.equal(script.execution, 'scripted-test')
    assert.equal(script.providerProvenance.mount, 'scripted-test')
    assert.equal(script.providerProvenance.profile, null)
    const scriptedManifest = JSON.parse(await readFile(join(scratch, 'scripted', 'manifest.json'), 'utf8'))
    assert.equal(scriptedManifest.execution, 'scripted-test')
    assert.deepEqual(scriptedManifest.providerProvenance, script.providerProvenance)
    assert.equal(mounts, 1, 'scripted execution never invokes the imported live mount')
  } finally { await rm(scratch, { recursive: true, force: true }) }
})

test('PROFILE-MOUNT-02: scripted seam and imported live mount are mutually exclusive before any provisioning or filesystem work', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-profile-mount-conflict-'))
  let mounts = 0
  try {
    await assert.rejects(() => runShiftingEvidence({ ...limits, directory: join(scratch, 'mixed') }, { adapter: new ShiftingMailScript() }, {
      liveProviderMount: async () => { mounts++ }, provenance,
    }), /scripted.*live.*mutually exclusive/i)
    assert.equal(mounts, 0)
    await assert.rejects(() => readFile(join(scratch, 'mixed', 'manifest.json')), /ENOENT/)
  } finally { await rm(scratch, { recursive: true, force: true }) }
})
