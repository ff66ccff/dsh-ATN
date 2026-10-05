/**
 * EFFORT/ROUTE: a node inherits the reasoning effort of the request that created
 * it, and recovery resumes with the recorded effort instead of a profile default.
 * @module dsh-atn/tests/integration/effort
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { bootKernel, drive, settle, type Kernel } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'

const goal = {
  objective: 'Inherit the whole route.',
  successCriteria: 'Provider, model and effort match the creating request.',
  constraints: 'Deterministic clock only.',
}

interface Bench {
  kernel: Kernel
  store: MemoryNetworkStore
  scratch: string
}

async function bench(): Promise<Bench> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-effort-'))
  const store = new MemoryNetworkStore()
  const kernel = await bootKernel(scratch, { store, clock: () => 1_000_000, cleanupTimeoutMs: 50 })
  return { kernel, store, scratch }
}

/**
 * Create a host-owned entry agent on an explicit route.
 *
 * @param kernel - Booted kernel.
 * @param sessionId - Session to create.
 * @param effort - Reasoning effort the creating request carries.
 * @returns The live agent.
 */
async function createHostAgentWithEffort(kernel: Kernel, sessionId: string, effort: string): Promise<ReturnType<Kernel['ctx']['agents']['get']>> {
  const handle = await kernel.ctx.agents.create({
    sessionId: SessionId(sessionId),
    agentOptions: { provider: 'atn-script', model: 'deterministic', reasoningEffort: effort as never },
  })
  return handle.agent
}

test('EFFORT-01: a spawned child records and uses the parent effort', async () => {
  const b = await bench()
  try {
    const host = (await createHostAgentWithEffort(b.kernel, 'session-host', 'high'))!
    b.kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Child work.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(b.kernel)

    const networkId = (await b.kernel.ctx.atn.networkIds())[0]!
    const record = await b.kernel.ctx.atn.network(networkId)
    const child = Object.values(record.nodes).find((node) => !node.isEntry)!
    assert.equal(child.modelRoute.provider, 'atn-script')
    assert.equal(child.modelRoute.model, 'deterministic')
    assert.equal(child.modelRoute.effort, 'high', 'the recorded route keeps the effort')

    const childAgent = b.kernel.ctx.agents.get(SessionId(child.sessionId))!
    assert.equal(childAgent.options.reasoningEffort, 'high', 'the child agent really carries the effort')

    // Compare what the parent and the child actually asked the provider for.
    const hostRequest = b.kernel.model.requests.filter((request) => request.sessionId === 'session-host').at(-1)!
    const childRequest = b.kernel.model.requests.filter((request) => request.sessionId === child.sessionId).at(-1)!
    assert.equal(childRequest.options.provider, hostRequest.options.provider)
    assert.equal(childRequest.options.model, hostRequest.options.model)
    assert.equal(childRequest.options.reasoningEffort, hostRequest.options.reasoningEffort)
    assert.equal(childRequest.options.reasoningEffort, 'high')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('EFFORT-02: recovery resumes on the persisted effort, never a profile default', async () => {
  const b = await bench()
  try {
    const host = (await createHostAgentWithEffort(b.kernel, 'session-host', 'medium'))!
    b.kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Child work.', context: '' } },
    ])
    await drive(host, 'start and spawn')
    await settle(b.kernel)

    const networkId = (await b.kernel.ctx.atn.networkIds())[0]!
    const record = await b.kernel.ctx.atn.network(networkId)
    const child = Object.values(record.nodes).find((node) => !node.isEntry)!
    assert.equal(child.modelRoute.effort, 'medium')

    // Drop the live handle, then let recovery rebuild the node.
    const runtime = b.kernel.ctx.atn as unknown as { handles: Map<string, AgentHandle> }
    await runtime.handles.get(child.sessionId)!.dispose()
    runtime.handles.delete(child.sessionId)
    const report = await b.kernel.ctx.atn.recover()
    assert.equal(report.find((entry) => entry.nodeId === child.id)?.action, 'resume')

    const resumed = b.kernel.ctx.agents.get(SessionId(child.sessionId))!
    assert.equal(resumed.options.reasoningEffort, 'medium', 'the resumed agent keeps the recorded effort')
    b.kernel.model.enqueue(child.sessionId, [{ tool: 'atn_status', args: {} }])
    await drive(resumed, 'report neighbours')
    await settle(b.kernel)
    const request = b.kernel.model.requests.filter((entry) => entry.sessionId === child.sessionId).at(-1)!
    assert.equal(request.options.reasoningEffort, 'medium', 'the request carries the recorded effort')
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})

test('EFFORT-03: an inherited route with no effort passes no effort through', async () => {
  const b = await bench()
  try {
    const handle = await b.kernel.ctx.agents.create({
      sessionId: SessionId('session-host'),
      agentOptions: { provider: 'atn-script', model: 'deterministic' },
    })
    b.kernel.model.enqueue('session-host', [
      { tool: 'atn_start', args: goal },
      { tool: 'atn_spawn', args: { task: 'Child work.', context: '' } },
    ])
    await drive(handle.agent, 'start and spawn')
    await settle(b.kernel)

    const networkId = (await b.kernel.ctx.atn.networkIds())[0]!
    const record = await b.kernel.ctx.atn.network(networkId)
    const child = Object.values(record.nodes).find((node) => !node.isEntry)!
    const childAgent = b.kernel.ctx.agents.get(SessionId(child.sessionId))!
    assert.equal(childAgent.options.reasoningEffort, undefined, 'no effort is invented when the parent had none')
    assert.equal(child.modelRoute.effort, null)
  } finally {
    await b.kernel.ctx.fiber.dispose()
    await rm(b.scratch, { recursive: true, force: true })
  }
})
