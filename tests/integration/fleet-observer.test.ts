import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import { AtnObserver } from '../../src/observer.ts'
import * as access from '../../src/observer-access.ts'
import * as schema from '../../src/observer-schema.ts'
import { bootKernel, createHostAgent } from '../fixtures/kernel.ts'
import { testGoal } from '../fixtures/network.ts'
import { makeChain } from '../fixtures/network.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
declare module '@deepseek-ai/dsh-typert-protocol' {
 interface PrincipalMap { 'fleet-operator': { readonly kind: 'fleet-operator'; readonly id: string } }
}

test('FLEET-AUTH: default deny, independent index/network grants, two principals, strict schema, no owner bypass or side effects', async () => {
 const scratch = await mkdtemp(join(tmpdir(), 'atn-fleet-'))
 const kernel = await bootKernel(scratch, { clock: () => 100 })
 try {
  const a = await createHostAgent(kernel, 'fleet-a'), b = await createHostAgent(kernel, 'fleet-b')
  const na = await kernel.atn.start(a, testGoal), nb = await kernel.atn.start(b, testGoal)
  await kernel.ctx.plugin(TypertRegistry); await kernel.ctx.plugin(RemoteAccess); await kernel.ctx.plugin(TypertGateway); await kernel.ctx.plugin(AtnObserver)
  const pa = new Peer(kernel.ctx, { principal: { kind: 'fleet-operator', id: 'a' } }), pb = new Peer(kernel.ctx, { principal: { kind: 'fleet-operator', id: 'b' } })
  const call = (peer: Peer, args = {}) => kernel.ctx.typertGateway.invoke({ peer, namespace: 'atnObserver', method: 'fleet', args, signal: new AbortController().signal })
  await assert.rejects(call(pa), { code: 'remote-access/denied' })
  const feature = access as any
  let mode = 'index-only'
  kernel.ctx.remoteAccess.registerPolicy('fleet-operator', { bindings: principal => [
   { role: feature.ATN_FLEET_READER, resource: { kind: 'atn-fleet' as any, id: 'index' } },
   ...(mode === 'index-only' ? [] : [{ role: feature.ATN_FLEET_READER, resource: { kind: 'atn-fleet' as any,
    id: feature.fleetNetworkResourceId(principal.id === 'a' ? na.networkId : nb.networkId) } }]),
  ] })
  assert.deepEqual((await call(pa) as any).networks, [])
  mode = 'networks'
  const before = await Promise.all([kernel.atn.network(na.networkId), kernel.atn.network(nb.networkId)])
  const histories = kernel.ctx.agents.list().map(agent => agent.session.snapshotEvents()), requests = kernel.model.requests.length
  const parse = (schema as any).fleetSnapshotSchema
  const sa = parse.parse(await call(pa)), sb = parse.parse(await call(pb))
  assert.deepEqual(sa.networks.map((n: any) => n.id), [na.networkId])
  assert.deepEqual(sb.networks.map((n: any) => n.id), [nb.networkId])
  assert.throws(() => parse.parse({ ...sa, networks: [{ ...sa.networks[0], objective: 'secret' }] }))
  await assert.rejects(call(pa, { networkId: nb.networkId }), /unexpected|unknown|argument/i)
  await assert.rejects(call(new Peer(kernel.ctx, { principal: { kind: 'owner' } })), { code: 'remote-access/denied' })
  assert.deepEqual(await Promise.all([kernel.atn.network(na.networkId), kernel.atn.network(nb.networkId)]), before)
  assert.deepEqual(kernel.ctx.agents.list().map(agent => agent.session.snapshotEvents()), histories)
  assert.equal(kernel.model.requests.length, requests)
  await assert.rejects(kernel.atn.publish(a, { sub_task: 'x', artifact: 'secret rejected payload', rationale: 'msg:999', refs: ['msg:999'] }), { code: 'ref-unresolved' })
  const counted = parse.parse(await call(pa))
  assert.equal(counted.networks[0].refusals.buckets['ref-unresolved'], 1)
  assert.ok(!JSON.stringify(counted).includes('secret rejected payload'))
  assert.deepEqual(await kernel.atn.network(na.networkId), before[0], 'refusal counters never dirty business records')
  if (process.env.ATN_FLEET_EVIDENCE) await writeFile(process.env.ATN_FLEET_EVIDENCE, JSON.stringify({ ...counted, networks: [...counted.networks, ...sb.networks] }, null, 2))
 } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})

test('FLEET-COLD: no unauthorized storage access; bounded authorized cold rows, unknown names and revocation fail closed', async () => {
 const scratch = await mkdtemp(join(tmpdir(), 'atn-fleet-cold-'))
 const records = Array.from({ length: 40 }, (_, index) => {
  const record = makeChain(['A'], { id: `net-${String(index).padStart(2, '0')}` })
  record.nodes.A.sessionId = `${record.id}-A`
  return record
 })
 class BarrierStore extends MemoryNetworkStore {
  blocked = false
  revokeAfterRead: (() => void) | undefined
  override async load(id: string) { assert.equal(this.blocked, false, 'authorization must precede storage'); const value = await super.load(id); this.revokeAfterRead?.(); return value }
  override async list() { assert.equal(this.blocked, false); return super.list() }
 }
 const store = new BarrierStore(records), kernel = await bootKernel(scratch, { store, clock: () => 100 })
 try {
  await kernel.ctx.plugin(TypertRegistry); await kernel.ctx.plugin(RemoteAccess); await kernel.ctx.plugin(TypertGateway); await kernel.ctx.plugin(AtnObserver)
  const peer = new Peer(kernel.ctx, { principal: { kind: 'fleet-operator', id: 'cold' } })
  const call = () => kernel.ctx.typertGateway.invoke({ peer, namespace: 'atnObserver', method: 'fleet', args: {}, signal: new AbortController().signal })
  store.blocked = true
  await assert.rejects(call(), { code: 'remote-access/denied' })
  let indexGrant = false, networkGrants = records.map(r => r.id)
  const feature = access as any
  kernel.ctx.remoteAccess.registerPolicy('fleet-operator', { bindings: () => [
   ...(indexGrant ? [{ role: feature.ATN_FLEET_READER, resource: { kind: 'atn-fleet' as any, id: 'index' } }] : []),
   ...networkGrants.map(id => ({ role: feature.ATN_FLEET_READER, resource: { kind: 'atn-fleet' as any, id: feature.fleetNetworkResourceId(id) } })),
  ] })
  await assert.rejects(call(), { code: 'remote-access/denied' })
  store.blocked = false; indexGrant = true
  const value = (schema as any).fleetSnapshotSchema.parse(await call())
  assert.equal(value.networks.length, 32); assert.equal(value.truncated, true)
  assert.ok(value.networks.every((r: any) => r.refusals.total === 0), 'legacy records cold-load with empty volatile counters')
  assert.equal(kernel.ctx.agents.list().length, 0); assert.equal(kernel.model.requests.length, 0); assert.equal(store.writes, 0)
  networkGrants = ['unknown-one', 'unknown-two']
  assert.deepEqual((await call() as any).networks, [])
  networkGrants = ['net-00']; store.revokeAfterRead = () => { networkGrants = [] }
  assert.deepEqual((await call() as any).networks, [], 'post-load recheck drops revoked row')
  assert.equal(store.writes, 0)
 } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})
