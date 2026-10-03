/**
 * STATE-01 against the real storage stack: a corrupted durable record must
 * fail the read instead of silently initializing an empty network.
 * @module dsh-atn/tests/integration/state
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorageBackend from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { atnDomainSpec, DomainNetworkStore, MemoryNetworkStore } from '../../src/domain.ts'
import { makeChain } from '../fixtures/network.ts'
import { ATN_DOMAIN_NAME } from '../../src/schema.ts'

async function openStorage(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorageBackend, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  return ctx
}

test('STATE-01: a valid record round-trips through the real domain layer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-atn-state-'))
  let ctx: Context | undefined
  try {
    ctx = await openStorage(root)
    const domain = await ctx.storageDomain.open(atnDomainSpec(ATN_DOMAIN_NAME))
    const store = new DomainNetworkStore(domain)
    const record = makeChain(['A', 'B', 'C'])
    await store.create(record)

    const reopened = await store.load(record.id)
    assert.deepEqual(reopened, record, 'the stored record matches what was written')
    domain.close()
  } finally {
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('STATE-01: a corrupted stored record fails the read instead of becoming an empty network', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-atn-corrupt-'))
  let ctx: Context | undefined
  try {
    ctx = await openStorage(root)
    const domain = await ctx.storageDomain.open(atnDomainSpec(ATN_DOMAIN_NAME))
    const store = new DomainNetworkStore(domain)
    await store.create(makeChain(['A']))
    await domain.close()
    await ctx.fiber.dispose()
    ctx = undefined

    // Corrupt one stored field, exactly as a partial write or a foreign writer would.
    const files = await readdir(root)
    const unit = files.find((name) => name.startsWith(ATN_DOMAIN_NAME))
    assert.ok(unit !== undefined, `the medium holds a unit for ${ATN_DOMAIN_NAME}`)
    const path = join(root, unit)
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
    const text = JSON.stringify(raw).replace('"open"', '"bogus-status"')
    assert.notEqual(text, JSON.stringify(raw), 'the corruption changed the document')
    await writeFile(path, text, 'utf8')

    const reopened = await openStorage(root)
    try {
      await assert.rejects(
        () => reopened.storageDomain.open(atnDomainSpec(ATN_DOMAIN_NAME)),
        (error: unknown) => /does not match its schema|invalid-record/.test(String((error as Error).message)),
        'opening the domain reports the invalid record instead of starting empty',
      )
    } finally {
      await reopened.fiber.dispose()
    }
  } finally {
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('STATE-02: the memory store models the real ordering, so a failed write keeps the old value', async () => {
  const store = new MemoryNetworkStore()
  const original = makeChain(['A'])
  await store.create(original)
  store.failNextUpdate = new Error('simulated medium failure')
  await assert.rejects(() => store.update('net-1', (current) => ({ ...current, status: 'completed' })))
  assert.equal((await store.load('net-1'))!.status, 'open')
})
