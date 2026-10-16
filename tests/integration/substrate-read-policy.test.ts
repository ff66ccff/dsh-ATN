import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import * as api from '../../src/index.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { appendSubstrate, searchSubstrate } from '../../src/substrate.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'
import { bootKernel, createHostAgent } from '../fixtures/kernel.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
 interface PrincipalMap { 'substrate-node': { readonly kind: 'substrate-node'; readonly id: string } }
}
const feature = api as any // Red-first: exercise the public host API before it exists.

function record() {
 let value = makeChain(['A', 'B'])
 value.tasks.work = makeTask('work')
 for (const [artifact, refs] of [['public parser', []], ['hidden parser', ['msg:1']], ['hidden ancestor parser', ['msg:2']], ['public parser independent', []]] as [string, string[]][]) {
  value = appendSubstrate(value, 'A', { sub_task: 'parser', artifact, rationale: refs.join(' ') || 'local', refs })
 }
 return value
}

test('READ-POLICY: filter before ranking/k, hide citers/ancestors/weights and indistinguishably refuse visit/refs', async () => {
 const scratch = await mkdtemp(join(tmpdir(), 'atn-read-policy-'))
 const original = record()
 const kernel = await bootKernel(scratch, { store: new MemoryNetworkStore([original]), clock: () => 100 })
 try {
  const a = await createHostAgent(kernel, 'session-A'), b = await createHostAgent(kernel, 'session-B')
  await kernel.ctx.plugin(RemoteAccess)
  kernel.ctx.remoteAccess.registerPolicy('substrate-node', { bindings: principal =>
   (principal.id === 'A' ? ['msg:1', 'msg:3', 'msg:4'] : ['msg:1', 'msg:2', 'msg:3', 'msg:4']).map(address => ({
    role: feature.ATN_SUBSTRATE_READER, resource: { kind: 'atn-substrate' as any, id: feature.substrateResourceId(original.id, address) },
   })) })
  const policy = feature.defineSubstrateReadPolicy({
   principalFor: (node: { id: string }) => ({ kind: 'substrate-node', id: node.id }),
   decide: (request: any) => kernel.ctx.remoteAccess.decide(request),
  })
  const dispose = (kernel.atn as any).installSubstrateReadPolicy(original.id, policy)
  const visible = (await kernel.atn.search(a, { query: 'parser' })).messages
  assert.deepEqual(visible.map(m => m.address), ['msg:1', 'msg:4'])
  assert.deepEqual(visible[0].citedBy, [])
  assert.equal((await kernel.atn.search(b, { query: 'parser' })).messages.length, 4)
  for (const address of ['msg:2', 'msg:3', 'msg:99']) {
   const before = await kernel.atn.network(original.id)
   await assert.rejects(kernel.atn.visit(a, { addresses: [address] }), { code: 'ref-unresolved', message: `unresolved reference ${address}` })
   await assert.rejects(kernel.atn.publish(a, { sub_task: 'x', artifact: 'x', rationale: address, refs: [address] }),
    { code: 'ref-unresolved', message: `unresolved or future reference ${address}` })
   assert.deepEqual(await kernel.atn.network(original.id), before)
  }
  // Domain holder checks still precede evidence visibility; an authorized holder cannot cite a hidden root.
  const denyB = feature.defineSubstrateReadPolicy({ principalFor: () => undefined, decide: () => ({ kind: 'allow' }) })
  dispose()
  const revoke = (kernel.atn as any).installSubstrateReadPolicy(original.id, denyB)
  const before = await kernel.atn.network(original.id)
  await assert.rejects(kernel.atn.send(a, { to: 'A', kind: 'result', taskId: 'work', body: 'x', summary: 'x', evidence: ['msg:2'] }), { code: 'not-holder' })
  await assert.rejects(kernel.atn.send(b, { to: 'A', kind: 'result', taskId: 'work', body: 'x', summary: 'x', evidence: ['msg:2'] }), { code: 'ref-unresolved' })
  assert.deepEqual(await kernel.atn.network(original.id), before)
  revoke()
  assert.deepEqual((await kernel.atn.search(a, { query: 'parser' })).messages, searchSubstrate(original, 'parser'))
 } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})

test('READ-POLICY-K: invisible matches take no result slots and hidden citation weights cannot change visible ordering', async () => {
 const scratch = await mkdtemp(join(tmpdir(), 'atn-read-k-'))
 let value = makeChain(['A'])
 for (let i = 0; i < 12; i++) value = appendSubstrate(value, 'A', { sub_task: 'parser', artifact: `parser ${i}`, rationale: 'local' })
 const store = new MemoryNetworkStore([value]), kernel = await bootKernel(scratch, { store, clock: () => 100 })
 try {
  const a = await createHostAgent(kernel, 'session-A')
  const policy = feature.defineSubstrateReadPolicy({ principalFor: () => ({ kind: 'substrate-node', id: 'A' }),
   decide: (request: any) => ({ kind: JSON.parse(request.resources[0].id)[1] === 'msg:1' ? 'deny' : 'allow', reason: 'no-allow' }) })
  ;(kernel.atn as any).installSubstrateReadPolicy(value.id, policy)
  const before = JSON.stringify((await kernel.atn.search(a, { query: 'parser' })).messages)
  assert.equal(JSON.parse(before).length, 8)
  assert.ok(!JSON.parse(before).some((m: any) => m.address === 'msg:1'))
  // Hidden msg:1 can carry arbitrary persisted citer weight, but cannot influence the readable corpus.
  await store.update(value.id, current => ({ ...current, substrate: { ...current.substrate!, weights: {
   ...current.substrate!.weights, 'msg:1': { value: 999999, epoch: current.stepsUsed },
  } } }))
  assert.equal(JSON.stringify((await kernel.atn.search(a, { query: 'parser' })).messages), before)
 } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})

test('READ-POLICY-TASKS: status evidence and review cannot tunnel a hidden message root', async () => {
 const scratch = await mkdtemp(join(tmpdir(), 'atn-read-task-'))
 const original = record()
 original.tasks.done = makeTask('done', { status: 'completed', result: { summary: 'Done', evidence: ['msg:2'] }, settledBy: 'B', settledAt: 1 })
 const store = new MemoryNetworkStore([original]), kernel = await bootKernel(scratch, { store, clock: () => 100 })
 try {
  const a = await createHostAgent(kernel, 'session-A')
  ;(kernel.atn as any).installSubstrateReadPolicy(original.id, feature.defineSubstrateReadPolicy({
   principalFor: () => undefined, decide: () => ({ kind: 'allow' }),
  }))
  assert.deepEqual((await kernel.atn.status(a, { taskIds: ['done'] })).tasks[0].result!.evidence, [])
  const before = await kernel.atn.network(original.id)
  await assert.rejects(kernel.atn.feedback(a, { taskId: 'done', status: 'accepted', summary: 'Reviewed', evidence: ['msg:2'] }), { code: 'ref-unresolved' })
  assert.deepEqual(await kernel.atn.network(original.id), before)
 } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})

test('READ-POLICY-FAILURE: throw/async fail closed, cold replay matches and missing policy preserves bytes', async () => {
 const scratch = await mkdtemp(join(tmpdir(), 'atn-read-replay-'))
 const original = record(), store = new MemoryNetworkStore([original])
 let kernel = await bootKernel(scratch, { store, clock: () => 100 })
 try {
  let a = await createHostAgent(kernel, 'session-A')
  const baseline = JSON.stringify((await kernel.atn.search(a, { query: 'parser' })).messages)
  for (const decide of [() => { throw new Error('secret host fault') }, async () => ({ kind: 'allow' })]) {
   const policy = feature.defineSubstrateReadPolicy({ principalFor: () => ({ kind: 'substrate-node', id: 'A' }), decide })
   const dispose = (kernel.atn as any).installSubstrateReadPolicy(original.id, policy)
   const before = await kernel.atn.network(original.id), writes = store.writes, requests = kernel.model.requests.length
   await assert.rejects(kernel.atn.search(a, { query: 'parser' }), { code: decide.constructor.name === 'AsyncFunction' ? 'async-policy' : 'custody-unavailable' })
   assert.deepEqual(await kernel.atn.network(original.id), before)
   assert.equal(store.writes, writes); assert.equal(kernel.model.requests.length, requests)
   dispose()
  }
  const makePolicy = () => feature.defineSubstrateReadPolicy({ principalFor: () => ({ kind: 'substrate-node', id: 'A' }),
   decide: (request: any) => ({ kind: request.resources[0].id === feature.substrateResourceId(original.id, 'msg:1') ? 'allow' : 'deny', reason: 'no-allow' }),
  })
  const dispose = (kernel.atn as any).installSubstrateReadPolicy(original.id, makePolicy())
  const warm = JSON.stringify((await kernel.atn.search(a, { query: 'parser' })).messages)
  dispose()
  assert.equal(JSON.stringify((await kernel.atn.search(a, { query: 'parser' })).messages), baseline)
  await kernel.ctx.fiber.dispose()
  kernel = await bootKernel(scratch, { store, clock: () => 100 }); a = await createHostAgent(kernel, 'session-A')
  ;(kernel.atn as any).installSubstrateReadPolicy(original.id, makePolicy())
  assert.equal(JSON.stringify((await kernel.atn.search(a, { query: 'parser' })).messages), warm)
 } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})
