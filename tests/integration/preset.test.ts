/** Preset roster, isolation, same-revision inheritance and cold recovery. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { SHARED_RULES } from '../../src/tools.ts'

const goal = { objective: 'Check ATN mode.', successCriteria: 'Scoped tools survive spawn and recovery.', constraints: 'Scripted model only.' }
const atnTools = ['atn_finish', 'atn_send', 'atn_spawn', 'atn_start', 'atn_status']

async function withPresets(run: (kernel: Kernel) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-preset-'))
  const kernel = await bootKernel(scratch, { presets: true })
  try { await run(kernel) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

function toolsFor(kernel: Kernel, sessionId: string): string[] {
  const request = kernel.model.toolSets.filter(row => row.sessionId === sessionId).at(-1)
  assert.ok(request, `model request exists for ${sessionId}`)
  return request.tools
}

test('PRESET-01: bundle declares a standalone ATN card and scopes all model-facing rows', async () => {
  const patch = load(await readFile(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema }) as {
    insert: { id: string; name: string; config?: PresetDefinition }[]
  }[]
  const hostRows = patch.flatMap(row => row.insert)
  assert.deepEqual(hostRows.map(row => row.id), ['atn', 'preset-atn'])
  const declaration = hostRows[1]!
  assert.equal(declaration.name, '@deepseek-ai/dsh-agent-preset')
  assert.equal(declaration.config?.id, 'atn')
  assert.equal(declaration.config?.name, 'ATN')
  assert.ok(declaration.config?.description)
  assert.ok(declaration.config.plugins.some(row => row.name === 'dsh-atn/tools'))
  assert.ok(declaration.config.plugins.some(row => row.name === '@deepseek-ai/dsh-tool-fs'))
  assert.ok(declaration.config.plugins.some(row => row.name === '@deepseek-ai/dsh-tool-pwsh'))
  assert.ok(!declaration.config.plugins.some(row => row.name === '@deepseek-ai/dsh-tool-subagent'))
})

test('PRESET-02: the UI roster exposes ATN; Standard has no ATN tools or prompt', async () => {
  await withPresets(async kernel => {
    const { presets } = await kernel.ctx.agentPresets.remoteExportList()
    assert.deepEqual(presets.map(row => [row.id, row.name, row.isDefault, row.broken]), [
      ['atn', 'ATN', false, undefined], ['standard', 'Standard', true, undefined],
    ])
    const document = await kernel.ctx.agentPresets.readDocument('atn')
    assert.equal(document.name, 'ATN')
    assert.match(document.content, /atn-tools/)
    const standard = await createHostAgent(kernel, 'standard', 'standard')
    const atn = await createHostAgent(kernel, 'atn', 'atn')
    // Domain initialization is asynchronous; inspect only after it is open.
    await kernel.ctx.atn.openStore()
    assert.deepEqual(await kernel.ctx.atn.networkIds(), [], 'selecting a mode does not start a network')
    await drive(standard, 'hello')
    await drive(atn, 'hello')
    assert.deepEqual(toolsFor(kernel, 'standard'), [])
    assert.deepEqual(toolsFor(kernel, 'atn'), atnTools)
    const requestText = (id: string) => JSON.stringify(kernel.model.requests.find(row => row.sessionId === id)!.options.messages)
    assert.ok(!requestText('standard').includes('You are in ATN mode'))
    assert.ok(requestText('atn').includes('You are in ATN mode'))
    assert.ok(SHARED_RULES.includes('call atn_start'))
    assert.deepEqual(await kernel.ctx.atn.networkIds(), [])
  })
})

test('PRESET-03: a live preset selection is inherited by child and grandchild, including cwd', async () => {
  await withPresets(async kernel => {
    const host = await createHostAgent(kernel, 'entry', 'standard')
    await kernel.ctx.agentPresets.select(host, 'atn')
    assert.equal(host.session.header.agentPreset, 'standard', 'header still names original preset')
    kernel.model.enqueue(host.id, [{ tool: 'atn_start', args: goal }, { tool: 'atn_spawn', args: { task: 'child', context: '' } }])
    await drive(host, goal.objective)
    await settle(kernel)
    let record = await kernel.ctx.atn.network((await kernel.ctx.atn.networkIds())[0]!)
    const node = Object.values(record.nodes).find(row => !row.isEntry)!
    const child = kernel.ctx.agents.get(SessionId(node.sessionId))!
    assert.equal(record.nodes[record.entryNodeId]!.presetId, 'atn')
    assert.equal(node.presetId, 'atn')
    assert.equal(child.session.header.agentPreset, 'atn')
    assert.equal(child.session.header.cwd, kernel.scratch)
    assert.equal(kernel.ctx.agentPresets.composedPreset(child.ctx), 'atn')
    assert.deepEqual(toolsFor(kernel, child.id), toolsFor(kernel, host.id))
    kernel.model.enqueue(child.id, [{ tool: 'atn_spawn', args: { task: 'grandchild', context: '' } }])
    await drive(child, 'delegate a part')
    await settle(kernel)
    record = await kernel.ctx.atn.network(record.id)
    const grandchild = Object.values(record.nodes).find(row => row.creatorId === node.id)!
    assert.equal(grandchild.presetId, 'atn')
    assert.deepEqual(toolsFor(kernel, grandchild.sessionId), atnTools)
  })
})

test('PRESET-04: spawn retains the creator revision after its declaration is replaced', async () => {
  await withPresets(async kernel => {
    const unregister = await kernel.ctx.agentPresets.register({
      id: 'custom-atn', plugins: [{ name: new URL('../../src/tools.ts', import.meta.url).href }],
    })
    const host = await createHostAgent(kernel, 'entry', 'custom-atn')
    await kernel.ctx.atn.start(host, goal)
    await unregister()
    const unregisterNew = await kernel.ctx.agentPresets.register({ id: 'custom-atn', plugins: [] })
    try {
      const born = await kernel.ctx.atn.spawn(host, { task: 'keeps old tools', context: '' })
      await settle(kernel)
      assert.deepEqual(toolsFor(kernel, born.sessionId), atnTools)
      const fresh = await createHostAgent(kernel, 'fresh', 'custom-atn')
      await drive(fresh, 'hello')
      assert.deepEqual(toolsFor(kernel, fresh.id), [])
    } finally { await unregisterNew() }
  })
})

for (const missing of [false, true]) {
  test(`PRESET-RECOVER: ${missing ? 'missing preset fails without falling back to Standard' : 'cold restart restores the recorded preset, not the default'}`, async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-preset-recover-'))
    let kernel = await bootKernel(scratch, { presets: true })
    try {
      const unregister = await kernel.ctx.agentPresets.register({
        id: 'durable-atn', plugins: [{ name: new URL('../../src/tools.ts', import.meta.url).href }],
      })
      const host = await createHostAgent(kernel, 'entry', 'durable-atn')
      const started = await kernel.ctx.atn.start(host, goal)
      const child = await kernel.ctx.atn.spawn(host, { task: 'survives restart', context: '' })
      await settle(kernel)
      await unregister()
      await kernel.ctx.fiber.dispose()
      kernel = await bootKernel(scratch, { presets: true })
      const unregisterResumed = missing ? undefined : await kernel.ctx.agentPresets.register({
        id: 'durable-atn', plugins: [{ name: new URL('../../src/tools.ts', import.meta.url).href }],
      })
      try {
        const report = await kernel.ctx.atn.recover()
        assert.equal(report.find(row => row.nodeId === child.nodeId)?.action, missing ? 'fail' : 'resume')
        const agent = kernel.ctx.agents.get(SessionId(child.sessionId))
        if (missing) {
          assert.equal(agent, undefined)
          assert.equal((await kernel.ctx.atn.network(started.networkId)).nodes[child.nodeId]!.lifecycle, 'failed')
        } else {
          assert.ok(agent)
          assert.equal(kernel.ctx.agentPresets.composedPreset(agent.ctx), 'durable-atn')
          await drive(agent, 'continue')
          assert.deepEqual(toolsFor(kernel, agent.id), atnTools)
        }
      } finally { await unregisterResumed?.() }
    } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
  })
}
