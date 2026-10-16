/** Business partitions and authenticated observation are deliberately separate claims. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import { AtnObserver } from '../../src/observer.ts'
import { ATN_CONTENT_READER } from '../../src/observer-access.ts'
import { appendSubstrate, visitSubstrate } from '../../src/substrate.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { defineCustodyPolicy } from '../../src/information-boundary.ts'
import { makeChain, makeTask } from '../fixtures/network.ts'
import { bootKernel, createHostAgent, drive } from '../fixtures/kernel.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
 interface PrincipalMap { 'namespace-reader': { readonly kind: 'namespace-reader'; readonly id: string } }
}

function partition(id: string) {
 const record = makeChain(['A', 'B', 'C'], { id, entrySessionId: `${id}-A` })
 for (const node of Object.values(record.nodes)) node.sessionId = `${id}-${node.id}`
 record.tasks.same = makeTask('same', { description: `${id} task` })
 record.tasks.hidden = makeTask('hidden', { requesterId: 'B', holderId: 'C' })
 return appendSubstrate(record, 'A', { sub_task: 'parser', artifact: `${id} artifact`, rationale: 'local' })
}

test('NAMESPACE-STRUCTURE: local collisions resolve locally; foreign-only refs disclose nothing', () => {
 let a = partition('alpha'), b = partition('beta')
 b = appendSubstrate(b, 'A', { sub_task: 'parser', artifact: 'beta only', rationale: 'local' })
 b.tasks.foreign = makeTask('foreign')
 // Deliberately defective resolver control: proves the collision assertion detects a cross-network read.
 const candidate = process.env.ATN_NAMESPACE_NEGATIVE_CONTROL === '1' ? b : a
 assert.equal(visitSubstrate(candidate, ['msg:1'])[0].artifact, 'alpha artifact')
 assert.throws(() => appendSubstrate(a, 'A', { sub_task: 'x', artifact: 'x', rationale: 'msg:2', refs: ['msg:2'] }), { code: 'ref-unresolved' })
 a = appendSubstrate(a, 'A', { sub_task: 'parser', artifact: 'local refs',
  rationale: 'msg:1 task:same artifact:same', refs: ['msg:1', 'task:same', 'artifact:same'] }, { custody: () => ['same'] })
 assert.equal(a.substrate!.messages[1].authorId, 'A')
 for (const [ref, code] of [['msg:3', 'ref-unresolved'], ['task:foreign', 'ref-unresolved'], ['task:hidden', 'ref-not-visible'], ['artifact:foreign', 'ref-not-owned']]) {
  // Same failure whether the other partition contains the identifier or not.
  assert.throws(() => appendSubstrate(a, 'A', { sub_task: 'x', artifact: 'x', rationale: ref, refs: [ref] },
   { custody: () => ['same'] }), { code })
 }
 assert.equal(visitSubstrate(b, ['msg:1'])[0].artifact, 'beta artifact')
})

test('NAMESPACE-LIVE: live Agent identity, script tool calls and authenticated RPC preserve partitions', async () => {
 const scratch = await mkdtemp(join(tmpdir(), 'atn-namespace-'))
 const a = partition('alpha'), b = partition('beta')
 b.tasks.foreign = makeTask('foreign')
 const beta = appendSubstrate(b, 'A', { sub_task: 'beta', artifact: 'foreign-only', rationale: 'local' })
 const kernel = await bootKernel(scratch, { store: new MemoryNetworkStore([a, beta]), clock: () => 100 })
 try {
  const aa = await createHostAgent(kernel, 'alpha-A'), ba = await createHostAgent(kernel, 'beta-A')
  kernel.atn.installOutboundPolicy('alpha', defineCustodyPolicy({ custody: () => ['same'], extractClaims: () => [] }))
  kernel.atn.installOutboundPolicy('beta', defineCustodyPolicy({ custody: () => ['same', 'foreign'], extractClaims: () => [] }))
  for (const [agent, label] of [[aa, 'alpha'], [ba, 'beta']] as const) {
   assert.equal((await kernel.atn.visit(agent, { addresses: ['msg:1'] })).messages[0].artifact, `${label} artifact`)
   kernel.model.enqueue(agent.id, [{ tool: 'atn_visit', args: { addresses: ['msg:1'] } }])
   await drive(agent, 'Visit local message')
   const result = JSON.stringify(agent.session.snapshotEvents().filter(e => e.type === 'tool/result'))
   assert.match(result, new RegExp(`${label} artifact`))
   assert.doesNotMatch(result, new RegExp(`${label === 'alpha' ? 'beta' : 'alpha'} artifact`))
   await kernel.atn.publish(agent, { sub_task: 'local', artifact: 'shared spelling', rationale: 'task:same artifact:same', refs: ['task:same', 'artifact:same'] })
  }
  for (const [ref, code] of [['msg:3', 'ref-unresolved'], ['msg:99', 'ref-unresolved'], ['task:foreign', 'ref-unresolved'], ['artifact:foreign', 'ref-not-owned'], ['task:hidden', 'ref-not-visible']]) {
   const before = await kernel.atn.network('alpha')
   await assert.rejects(kernel.atn.publish(aa, { sub_task: 'x', artifact: 'x', rationale: ref, refs: [ref] }), { code })
   assert.deepEqual(await kernel.atn.network('alpha'), before)
  }
  // Complete host exports intentionally cross partitions under B-HOST-EXPORT.
  assert.equal((await kernel.atn.exportSubstrate('beta')).messages[0].artifact, 'beta artifact')
  await kernel.ctx.plugin(TypertRegistry); await kernel.ctx.plugin(RemoteAccess); await kernel.ctx.plugin(TypertGateway); await kernel.ctx.plugin(AtnObserver)
  kernel.ctx.remoteAccess.registerPolicy('namespace-reader', { bindings: principal => [{
   role: ATN_CONTENT_READER, resource: { kind: 'atn-observation', id: `${principal.id}-A` },
  }] })
  const invoke = (id: string, sessionId: string) => kernel.ctx.typertGateway.invoke({
   peer: new Peer(kernel.ctx, { principal: { kind: 'namespace-reader', id } }), namespace: 'atnObserver', method: 'snapshot',
   args: { sessionId }, signal: new AbortController().signal,
  }) as Promise<{ network: { id: string } | null }>
  for (const id of ['alpha', 'beta']) {
   assert.equal((await invoke(id, `${id}-A`)).network!.id, id)
   for (const sessionId of [`${id === 'alpha' ? 'beta' : 'alpha'}-A`, 'unknown']) await assert.rejects(invoke(id, sessionId), { code: 'remote-access/denied' })
  }
  // An authorized but unknown alias has the same null result as any other authorized unknown alias.
  const dispose = kernel.ctx.remoteAccess.registerPolicy('atn-test-operator', { bindings: () => ['absent-one', 'absent-two'].map(id => ({
   role: ATN_CONTENT_READER, resource: { kind: 'atn-observation' as const, id },
  })) })
  const peer = new Peer(kernel.ctx, { principal: { kind: 'atn-test-operator', id: 'null-reader' } })
  for (const sessionId of ['absent-one', 'absent-two']) {
   const value = await kernel.ctx.typertGateway.invoke({ peer, namespace: 'atnObserver', method: 'snapshot', args: { sessionId }, signal: new AbortController().signal }) as { network: unknown }
   assert.equal(value.network, null)
  }
  dispose()
 } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
})
