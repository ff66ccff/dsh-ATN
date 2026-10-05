/** Installed only into the disposable smoke profile. Never calls a paid model. */
import { strict as assert } from 'node:assert'
import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'

export const inject = ['appReady', 'appExit', 'agentPresets', 'agents', 'llm', 'atn', 'atnObserver', 'typertGateway', 'connection', 'webServer', 'clientModules']

class ScriptedAdapter extends LlmAdapter {
  requests = 0
  visited = new Set()

  async *stream(options) {
    options.signal?.throwIfAborted()
    this.requests++
    if (!this.visited.has(options.sessionId) && options.tools?.some(tool => tool.name === 'atn_status')) {
      this.visited.add(options.sessionId)
      const id = `visualization-${this.requests}`
      const args = JSON.stringify({ query: '*' })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'atn_status', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'atn_status', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = 'ATN 可视化验证：检查邻接、交换反馈并等待下一项协作任务。'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

async function settleAgents(ctx) {
  for (let pass = 0; pass < 30; pass++) {
    const running = ctx.agents.list().filter(agent => agent.status === 'running')
    if (!running.length) return
    await Promise.all(running.map(agent => agent.whenIdle()))
  }
  throw new Error('Scripted agents did not become idle')
}

async function run(ctx) {
  const preview = process.env.ATN_VISUAL_PREVIEW === '1'
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  const authenticatedUrl = ctx.connection.authenticatedUrl(`${origin}/`)
  const login = await fetch(authenticatedUrl, { redirect: 'manual' })
  assert.equal(login.status, 303, 'real Web profile exchanges its launch token')
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0]
  assert.ok(cookie, 'authentication returned a browser cookie')
  const headers = { cookie, 'content-type': 'application/json' }
  const page = await fetch(origin, { headers })
  assert.equal(page.status, 200)
  assert.match(await page.text(), /dsh-atn/, 'ATN appears in the served browser boot graph')
  const client = ctx.clientModules.graph().entries.find(entry => entry.id === 'dsh-atn')
  assert.ok(client, 'installed package declares a discovered browser module')
  const bundle = await fetch(new URL(client.url, `${origin}/`), { headers })
  assert.equal(bundle.status, 200)
  const bundleText = await bundle.text()
  assert.match(bundleText, /__ModuleLoader__\.load/, 'browser registration handoff is served')
  assert.match(bundleText, /atnObserver/, 'served bundle contains the observation client')

  let requestId = 0
  async function rpc(args) {
    const response = await fetch(`${origin}/api/atnObserver/snapshot`, {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'client-request', rpcId: `visual-${++requestId}`, method: 'atnObserver/snapshot', payload: { args } }),
    })
    assert.equal(response.status, 200)
    const envelope = await response.json()
    assert.equal(envelope.type, 'server-response')
    return envelope.result
  }
  const empty = await rpc({ sessionId: 'atn-visualization-nonexistent' })
  assert.equal(empty.ok, true, JSON.stringify(empty))
  assert.equal(empty.value.network, null)
  const invalid = await rpc({ sessionId: 'atn-visualization-nonexistent', unexpected: true })
  assert.equal(invalid.ok, false, 'Gateway enforces exact strict wire arguments')
  assert.match(invalid.error.code, /gateway\/(arguments|input)-invalid/)

  const adapter = new ScriptedAdapter()
  ctx.llm.registerAdapter(['atn-visualization-smoke'], adapter)
  const sessionId = 'atn-visualization-entry'
  const handle = await ctx.agents.create({
    sessionId,
    meta: { agentPreset: 'atn', cwd: process.cwd(), title: 'ATN 网络可视化验证' },
    agentOptions: { provider: 'atn-visualization-smoke', model: 'deterministic' },
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'atn') },
  })
  let networkId
  try {
    const started = await ctx.atn.start(handle.agent, {
      objective: '验证 ATN 智能体跨分支协作网络',
      successCriteria: '展示创建关系、有向邻接、失败反馈和持续变化。',
      constraints: '隔离测试，只使用脚本模型，不访问外部模型服务。',
    })
    networkId = started.networkId
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: '开始观察 ATN 协作网络。' }], source: { kind: 'user' } }))
    await settleAgents(ctx)
    const spawn = async (agent, task) => {
      const result = await ctx.atn.spawn(agent, { task, context: '可视化隔离验证', leaseMs: 15 * 60 * 1000 })
      await settleAgents(ctx)
      const created = ctx.agents.get(result.sessionId)
      assert.ok(created)
      return { ...result, agent: created }
    }
    const left = await spawn(handle.agent, '分析拓扑结构与局部探索')
    const right = await spawn(handle.agent, '验证任务结果和协作消息')
    const leftLeaf = await spawn(left.agent, '跨分支发现并建立新的邻接关系')
    const rightLeaf = await spawn(right.agent, '接收跨分支协作反馈')
    const failed = await spawn(handle.agent, '验证失败任务的显式结果状态')
    await ctx.atn.rewire(leftLeaf.agent, { peers: [rightLeaf.nodeId] })
    await ctx.atn.rewire(rightLeaf.agent, { peers: [right.nodeId] })
    await ctx.atn.send(failed.agent, {
      to: started.nodeId, kind: 'result', taskId: failed.taskId, outcome: 'failed',
      body: '脚本验证：依赖数据不可用，任务失败。', summary: '依赖数据不可用，需要换人重试', evidence: ['smoke:scripted-failure'],
    })
    await settleAgents(ctx)
    const initial = await rpc({ sessionId })
    assert.equal(initial.ok, true)
    assert.equal(initial.value.network.nodes.length, 6)
    assert.ok(initial.value.network.edges.some(edge => edge.kind === 'collaboration' && edge.source === leftLeaf.nodeId && edge.target === rightLeaf.nodeId))
    assert.ok(!initial.value.network.edges.some(edge => edge.kind === 'collaboration' && edge.source === rightLeaf.nodeId && edge.target === leftLeaf.nodeId), 'directed cross-branch edge is not fabricated as reciprocal')
    assert.ok(initial.value.network.edges.some(edge => edge.kind === 'birth' && edge.source === left.nodeId && edge.target === leftLeaf.nodeId))
    assert.ok(initial.value.network.tasks.some(task => task.id === failed.taskId && task.status === 'failed'))
    assert.ok(initial.value.network.events.some(event => event.kind === 'tool/call'), 'actual agent behavior is observed')

    const durableBefore = JSON.stringify(await ctx.atn.network(networkId))
    const requestCountBefore = adapter.requests
    const direct = await ctx.typertGateway.invoke({ namespace: 'atnObserver', method: 'snapshot', args: { sessionId } })
    await rpc({ sessionId })
    assert.equal(direct.network.id, networkId)
    assert.equal(JSON.stringify(await ctx.atn.network(networkId)), durableBefore, 'observation does not mutate network records')
    assert.equal(adapter.requests, requestCountBefore, 'observation never wakes model requests')

    await ctx.atn.rewire(leftLeaf.agent, { peers: [started.nodeId, rightLeaf.nodeId] })
    const updated = await rpc({ sessionId })
    assert.equal(updated.ok, true)
    assert.ok(updated.value.network.edges.some(edge => edge.kind === 'collaboration' && edge.source === leftLeaf.nodeId && edge.target === started.nodeId))
    assert.ok(updated.value.network.events.some(event => event.kind === 'edge-added' && event.nodeId === leftLeaf.nodeId && event.targetId === started.nodeId))

    const readyPath = join(process.env.DSH_HOME, 'visualization-ready.json')
    await writeFile(readyPath, JSON.stringify({ origin, authenticatedUrl, sessionId, networkId, clientUrl: client.url }, null, 2), 'utf8')
    console.log('ATN_VISUALIZATION_SMOKE ' + JSON.stringify({
      nodes: 6, directedCrossBranch: true, failedResult: true, liveChange: true, strictGateway: true,
      readOnly: true, clientServed: true, sessionId, origin, preview, readyPath,
    }))
    if (preview) {
      console.log('ATN_VISUALIZATION_READY ' + JSON.stringify({ origin, sessionId, readyPath }))
      // Continual genuine runtime events for browser inspection; bounded to 15 minutes.
      const deadline = Date.now() + 15 * 60 * 1000
      let round = 0
      while (Date.now() < deadline) {
        if (await access(join(process.env.DSH_HOME, 'visualization-stop')).then(() => true, () => false)) break
        await new Promise(resolve => setTimeout(resolve, 3000))
        await ctx.atn.rewire(leftLeaf.agent, { peers: ++round % 2 ? [rightLeaf.nodeId] : [started.nodeId, rightLeaf.nodeId] })
        await ctx.atn.send(leftLeaf.agent, { to: rightLeaf.nodeId, kind: 'note', body: `第 ${round} 次协作反馈：已验证跨分支邻接。` })
        await settleAgents(ctx)
      }
    }
  } finally {
    if (networkId) await ctx.atn.stop(networkId, 'visualization smoke complete')
    await handle.dispose()
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.appReady.onReady(() => {
    void run(ctx).then(() => ctx.appExit(0), error => {
      console.error('ATN_VISUALIZATION_SMOKE_FAILED', error)
      ctx.appExit(1)
    })
  }))
}
