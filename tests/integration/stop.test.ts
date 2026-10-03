/**
 * STOP/RELEASE: the hard stop must report what really happened to every handle,
 * keep unresolved handles discoverable, and stay a persistent terminal state.
 * @module dsh-atn/tests/integration/stop
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { bootKernel, createHostAgent, drive, settle, type Kernel } from '../fixtures/kernel.ts'

const goal = {
  objective: 'Report handle releases honestly.',
  successCriteria: 'Every handle is released, failed or a straggler.',
  constraints: 'Deterministic clock only.',
}

/** Cleanup window for a real handle, generous enough for a loaded machine. */
const CLEANUP_TIMEOUT_MS = 3000
/** Short cleanup window, so a timeout is observable in a few milliseconds. */
const TIMEOUT_WINDOW_MS = 120

interface Fixture {
  kernel: Kernel
  networkId: string
  childNodeId: string
  childSession: string
  host: Agent
  scratch: string
}

async function fixture(cleanupTimeoutMs: number = CLEANUP_TIMEOUT_MS): Promise<Fixture> {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-stop-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000, cleanupTimeoutMs })
  const created = await createHostAgent(kernel, 'session-host')
  kernel.model.enqueue('session-host', [
    { tool: 'atn_start', args: goal },
    { tool: 'atn_spawn', args: { task: 'Child work.', context: '' } },
  ])
  await drive(created, 'start and spawn')
  await settle(kernel)
  const networkId = (await kernel.ctx.atn.networkIds())[0]!
  const record = await kernel.ctx.atn.network(networkId)
  const child = Object.values(record.nodes).find((node) => !node.isEntry)!
  const host = kernel.ctx.agents.get(SessionId('session-host'))!
  return { kernel, networkId, childNodeId: child.id, childSession: child.sessionId, host, scratch }
}

/**
 * Replace one node's live handle with a controllable fake, keeping the session
 * mapping the runtime uses to find it.
 *
 * @param kernel - Booted kernel.
 * @param sessionId - Session of the node being faked.
 * @param dispose - Fake `dispose` implementation.
 * @returns The real handle, so a test can still tear it down afterwards.
 */
function installFakeHandle(kernel: Kernel, sessionId: string, dispose: () => Promise<void>): AgentHandle {
  const runtime = kernel.ctx.atn as unknown as { handles: Map<string, AgentHandle> }
  const real = [...runtime.handles.entries()].find(([session]) => session === sessionId)?.[1]
  assert.ok(real !== undefined, `the runtime holds a handle for ${sessionId}`)
  runtime.handles.set(sessionId, { agent: real.agent, dispose } as AgentHandle)
  return real
}

/**
 * Put a captured real handle back under its session, so the kernel teardown
 * disposes the real Agent instead of waiting on the fake.
 *
 * @param kernel - Booted kernel.
 * @param sessionId - Session the handle belongs to.
 * @param handle - Real handle to restore.
 */
function restoreRealHandle(kernel: Kernel, sessionId: string, handle: AgentHandle): void {
  const runtime = kernel.ctx.atn as unknown as { handles: Map<string, AgentHandle> }
  runtime.handles.set(sessionId, handle)
}

test('STOP-01: a handle that never settles is reported as a straggler, never as released', async () => {
  const bench = await fixture(TIMEOUT_WINDOW_MS)
  let real: AgentHandle | undefined
  try {
    real = installFakeHandle(bench.kernel, bench.childSession, () => new Promise<void>(() => undefined))

    const started = Date.now()
    const report = await bench.kernel.ctx.atn.stop(bench.networkId, 'user stopped the network')
    assert.equal(report.status, 'stopped')
    assert.ok(Date.now() - started >= TIMEOUT_WINDOW_MS - 10, 'stop waited for its cleanup window')
    assert.ok(!report.released.includes(bench.childNodeId), 'an unsettled handle is never reported as released')
    assert.ok(report.stragglers.includes(bench.childNodeId), 'the unsettled handle is a straggler')
    const detail = report.stragglerDetails.find((entry) => entry.nodeId === bench.childNodeId)!
    assert.equal(detail.status, 'timed-out')
    assert.match(detail.reason, /did not settle/)
    assert.equal(detail.sessionId, bench.childSession)
  } finally {
    // The straggling handle is by design still tracked, so the test resolves the
    // real handle directly before tearing the whole kernel down.
    if (real !== undefined) {
      restoreRealHandle(bench.kernel, bench.childSession, real)
      await real.dispose().catch(() => undefined)
    }
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('STOP-02: an immediately rejected dispose is reported as a failure, not as released', async () => {
  const bench = await fixture()
  let real: AgentHandle | undefined
  try {
    real = installFakeHandle(bench.kernel, bench.childSession, () => Promise.reject(new Error('driver refused to stop')))

    const report = await bench.kernel.ctx.atn.stop(bench.networkId, 'network stopped after a failure')
    assert.ok(!report.released.includes(bench.childNodeId), 'a failed dispose is not a release')
    const detail = report.stragglerDetails.find((entry) => entry.nodeId === bench.childNodeId)!
    assert.equal(detail.status, 'failed')
    assert.match(detail.reason, /driver refused to stop/)
    assert.equal(bench.kernel.ctx.atn.ownsHandle(bench.childNodeId), true, 'a failed dispose must retain ownership until release is confirmed')
    assert.ok(bench.kernel.ctx.agents.get(SessionId(bench.childSession)), 'failed disposal does not prove the Agent was removed')
  } finally {
    if (real !== undefined) {
      restoreRealHandle(bench.kernel, bench.childSession, real)
      await real.dispose().catch(() => undefined)
    }
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('STOP-03: a normal stop releases the ATN-owned node and keeps the entry agent', async () => {
  const bench = await fixture()
  try {
    const report = await bench.kernel.ctx.atn.stop(bench.networkId, 'normal stop')
    assert.equal(report.status, 'stopped')
    assert.ok(report.released.includes(bench.childNodeId), 'the ATN-owned handle was released')
    assert.deepEqual(report.stragglers, [], 'nothing straggled')
    assert.equal(bench.kernel.ctx.agents.get(SessionId('session-host')), bench.host, 'the host entry agent survives')
    const record = await bench.kernel.ctx.atn.network(bench.networkId)
    assert.equal(record.status, 'stopped')
    assert.ok(Object.values(record.tasks).every((task) => task.status !== 'open'), 'no task is left open by a stop')
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})

test('STOP-04: stop is idempotent and no operation reopens a stopped network', async () => {
  const bench = await fixture()
  try {
    const first = await bench.kernel.ctx.atn.stop(bench.networkId, 'first stop')
    const record = await bench.kernel.ctx.atn.network(bench.networkId)
    const second = await bench.kernel.ctx.atn.stop(bench.networkId, 'second stop')
    assert.equal(second.status, 'stopped')
    assert.deepEqual(second.released, first.released, 'a repeated stop reports the same released set')
    assert.deepEqual(second.stragglers, first.stragglers)
    assert.equal(second.reason, first.reason)

    // The host entry agent is still live, so the runtime refuses on the network
    // state rather than on identity.
    await assert.rejects(
      () => bench.kernel.ctx.atn.spawn(bench.host, { task: 'too late', context: '' }),
      (error: unknown) => /is stopped|network-closed|not-active/i.test(String((error as Error).message)),
    )
    await assert.rejects(
      () => bench.kernel.ctx.atn.renew(bench.host, { extendMs: 1000, taskId: Object.keys(record.tasks)[0]! }),
      (error: unknown) => /stopped|closed/i.test(String((error as Error).message)),
    )
    const after = await bench.kernel.ctx.atn.network(bench.networkId)
    assert.equal(after.status, 'stopped', 'the network stays stopped')
    assert.equal(Object.keys(after.nodes).length, Object.keys(record.nodes).length, 'no node was created after the stop')
    assert.equal(Object.keys(after.tasks).length, Object.keys(record.tasks).length, 'no task was created after the stop')
  } finally {
    await bench.kernel.ctx.fiber.dispose()
    await rm(bench.scratch, { recursive: true, force: true })
  }
})
