/** Explicit scheduler passes must finish even when another pass is in flight. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { requestDrain } from '../../src/lifecycle.ts'
import { bootKernel } from '../fixtures/kernel.ts'
import { makeChain } from '../fixtures/network.ts'

function barrier() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

class PausingStore extends MemoryNetworkStore {
  beforeNextLoad: (() => Promise<void>) | null = null
  beforeNextList: (() => Promise<void>) | null = null

  override async load(id: string) {
    const pause = this.beforeNextLoad
    this.beforeNextLoad = null
    await pause?.()
    return super.load(id)
  }

  override async list() {
    const pause = this.beforeNextList
    this.beforeNextList = null
    await pause?.()
    return super.list()
  }
}

test('SCHEDULER-01: an overlapping tick waits and processes changes made after the active lifecycle pass', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-scheduler-'))
  const store = new PausingStore([makeChain(['entry', 'worker'])])
  const kernel = await bootKernel(scratch, { store, clock: () => 1000 })
  const paused = barrier()
  const resume = barrier()
  const runs: Promise<string[]>[] = []
  try {
    // Hold the first pass after its lifecycle mutation but before mailbox reads.
    store.updateHook = () => {
      store.updateHook = null
      store.beforeNextLoad = async () => {
        paused.release()
        await resume.promise
      }
    }
    runs.push(kernel.atn.tick())
    await paused.promise
    await store.update('net-1', record => requestDrain(record, 'worker', 'Work finished.'))

    let finished = false
    const followup = kernel.atn.tick().then(changed => { finished = true; return changed })
    runs.push(followup)
    await setImmediate()
    assert.equal(finished, false, 'await tick() must not return while its pass is still pending')
    assert.equal((await store.load('net-1'))!.nodes.worker.lifecycle, 'draining')

    resume.release()
    const [first, second] = await Promise.all(runs)
    assert.deepEqual(first, [], 'the earlier pass did not observe the later drain request')
    assert.deepEqual(second, ['net-1'], 'the requested pass processes the newer state')
    assert.equal((await store.load('net-1'))!.nodes.worker.lifecycle, 'retired')
  } finally {
    resume.release()
    await Promise.allSettled(runs)
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

test('SCHEDULER-02: a failed pass rejects its caller without dropping or poisoning queued passes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-atn-scheduler-failure-'))
  const record = requestDrain(makeChain(['entry', 'worker']), 'worker', 'Work finished.')
  const store = new PausingStore([record])
  const kernel = await bootKernel(scratch, { store, clock: () => 1000 })
  const paused = barrier()
  const resume = barrier()
  const runs: Promise<unknown>[] = []
  try {
    store.beforeNextList = async () => {
      paused.release()
      await resume.promise
      throw new Error('Injected scheduler read failure')
    }
    runs.push(assert.rejects(kernel.atn.tick(), /Injected scheduler read failure/))
    await paused.promise
    const followup = kernel.atn.tick()
    runs.push(followup)
    resume.release()
    await Promise.all(runs)
    assert.deepEqual(await followup, ['net-1'])
    assert.equal((await store.load('net-1'))!.nodes.worker.lifecycle, 'retired')
    assert.deepEqual(await kernel.atn.tick(), [], 'later passes still run normally')
  } finally {
    resume.release()
    await Promise.allSettled(runs)
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
