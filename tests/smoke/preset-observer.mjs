/** Copied into the disposable profile so imports use its installed packages. */
import { strict as assert } from 'node:assert'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'

export const inject = ['appReady', 'appExit', 'agentPresets', 'agents', 'llm', 'atn']

class ScriptedAdapter extends LlmAdapter {
  requests = []
  commands = [
    { name: 'atn_start', args: { objective: 'Verify the installed ATN mode.', successCriteria: 'A worker inherits ATN tools.', constraints: 'No external model requests.' } },
    { name: 'atn_spawn', args: { task: 'Check inherited capabilities.', context: 'Disposable profile smoke.' } },
  ]
  sequence = 0

  async *stream(options) {
    options.signal?.throwIfAborted()
    this.requests.push(options)
    // The Web profile also makes auxiliary title/summary requests on the same
    // session. Only the agent's tool-bearing requests consume its script.
    const command = options.sessionId === 'atn-smoke-entry'
      && options.tools?.some(tool => tool.name === this.commands[0]?.name) ? this.commands.shift() : undefined
    if (command) {
      const id = `atn-smoke-${++this.sequence}`
      const args = JSON.stringify(command.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: command.name, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: command.name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'Smoke check complete.' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Smoke check complete.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function run(ctx) {
  const roster = await ctx.agentPresets.remoteExportList()
  const atn = roster.presets.find(row => row.id === 'atn')
  assert.ok(atn, 'ATN appears in the same roster the Agent presets page reads')
  assert.equal(atn.name, 'ATN')
  assert.equal(atn.broken, undefined, atn.broken)
  assert.equal(atn.isDefault, false)
  assert.equal(roster.presets.find(row => row.isDefault)?.id, 'standard')
  const document = await ctx.agentPresets.readDocument('atn')
  assert.match(document.content, /dsh-atn\/tools/)
  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['atn-smoke'], adapter)
  const handles = []
  try {
    for (const id of ['standard', 'atn']) {
      const handle = await ctx.agents.create({
        sessionId: id === 'atn' ? 'atn-smoke-entry' : 'atn-smoke-standard',
        meta: { agentPreset: id, cwd: process.cwd() },
        agentOptions: { provider: 'atn-smoke', model: 'deterministic' },
        setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, id) },
      })
      handles.push(handle)
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Verify this mode.' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
    }
    for (let pass = 0; pass < 20; pass++) {
      const running = ctx.agents.list().filter(agent => agent.status === 'running')
      if (!running.length) break
      await Promise.all(running.map(agent => agent.whenIdle()))
    }
    const record = await ctx.atn.network((await ctx.atn.networkIds())[0])
    const child = Object.values(record.nodes).find(node => !node.isEntry)
    assert.ok(child, 'ATN mode called atn_start and atn_spawn in the installed profile: ' + JSON.stringify({
      nodes: record.nodes,
      results: handles.at(-1).agent.session.snapshotEvents().filter(event => ['tool/result', 'turn/error'].includes(event.type)),
      pendingCommands: adapter.commands,
      recentEvents: handles.at(-1).agent.session.snapshotEvents().slice(-8),
    }))
    assert.equal(child.presetId, 'atn')
    const tools = id => adapter.requests.filter(request => request.sessionId === id && request.tools?.length).at(-1)?.tools.map(tool => tool.name).sort()
    assert.ok(!tools('atn-smoke-standard').some(name => name.startsWith('atn_')))
    assert.ok(!JSON.stringify(adapter.requests.find(request => request.sessionId === 'atn-smoke-standard').messages).includes('You are in ATN mode'))
    assert.deepEqual(tools(child.sessionId), tools('atn-smoke-entry'))
    assert.deepEqual(tools(child.sessionId).filter(name => name.startsWith('atn_')), [
      'atn_board', 'atn_finish', 'atn_send', 'atn_spawn', 'atn_start', 'atn_status',
    ])
    assert.ok(tools(child.sessionId).includes('atn_status'))
    assert.ok(JSON.stringify(adapter.requests.find(request => request.sessionId === child.sessionId).messages).includes('You are in ATN mode'))
    await ctx.atn.stop(record.id, 'smoke complete')
    console.log('ATN_PRESET_SMOKE ' + JSON.stringify({
      presets: roster.presets.map(row => ({ id: row.id, name: row.name, isDefault: row.isDefault, broken: row.broken })),
      tools: tools(child.sessionId), childPreset: child.presetId, nodes: Object.keys(record.nodes).length,
    }))
  } finally { await Promise.all(handles.map(handle => handle.dispose())) }
}

export function apply(ctx) {
  ctx.effect(() => ctx.appReady.onReady(() => {
    void run(ctx).then(() => ctx.appExit(0), error => {
      console.error('ATN_PRESET_SMOKE_FAILED', error)
      ctx.appExit(1)
    })
  }))
}
