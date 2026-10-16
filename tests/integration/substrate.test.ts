/** Real kernel substrate calls: pure pull, atomic refusals, lifecycle and cold replay. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bootKernel, createHostAgent, drive, settle } from '../fixtures/kernel.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { defineCustodyPolicy } from '../../src/information-boundary.ts'
import { evidenceChain, searchSubstrate } from '../../src/substrate.ts'
import { replayWeights, weightAt } from '../../src/substrate-ranking.ts'
import { makeChain, makeTask, testGoal } from '../fixtures/network.ts'
import { AtnObserver } from '../../src/observer.ts'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { observerSnapshotSchema } from '../../src/observer-schema.ts'

test('SUBSTRATE-KERNEL: A publish, B search/visit/cite is bounded, sender-authentic and never wakes others', async () => {
  const scratch=await mkdtemp(join(tmpdir(),'atn-substrate-'))
  const kernel=await bootKernel(scratch,{clock:()=>100})
  try {
    const a=await createHostAgent(kernel,'substrate-A')
    const started=await kernel.atn.start(a,testGoal)
    const b=await kernel.atn.spawn(a,{task:'Read findings',context:''})
    await settle(kernel)
    const agent=kernel.ctx.agents.get(SessionId(b.sessionId))!
    const before=await kernel.atn.network(started.networkId)
    const requests=kernel.model.requests.length
    const events=kernel.ctx.agents.list().map(a=>[a.id,a.session.snapshotEvents().length])
    const first=await kernel.atn.publish(a,{sub_task:'parser boundary',artifact:'partial parser',rationale:'local test'})
    assert.equal(first.address,'msg:1')
    assert.equal(first.epoch,before.stepsUsed)
    assert.equal((await kernel.atn.network(started.networkId)).substrate!.messages[0].authorId,started.nodeId)
    const search=await kernel.atn.search(agent,{query:'parser'})
    assert.equal(search.messages[0].address,'msg:1')
    assert.deepEqual((await kernel.atn.visit(agent,{addresses:['msg:1']})).messages,search.messages)
    await kernel.atn.publish(agent,{sub_task:'parser extension',artifact:'reusable extension',rationale:'msg:1 provides the parser',refs:['msg:1']})
    const record=await kernel.atn.network(started.networkId)
    assert.equal(weightAt(record,'msg:1'),300000)
    assert.deepEqual((await kernel.atn.visit(a,{addresses:['msg:1']})).messages[0].citedBy,['msg:2'])
    assert.deepEqual(record.mails,before.mails)
    assert.equal(record.stepsUsed,before.stepsUsed)
    assert.equal(kernel.model.requests.length,requests)
    assert.deepEqual(kernel.ctx.agents.list().map(a=>[a.id,a.session.snapshotEvents().length]),events)
    assert.doesNotMatch(JSON.stringify(search),/author|weight|publishedEpoch|node-\d/)
    assert.equal(record.substrate!.metrics.publishCalls,2)
    assert.equal(record.substrate!.metrics.readCalls,2)
    assert.ok(record.substrate!.metrics.publishedBytes>0)
    assert.ok(record.substrate!.metrics.readBytes>0)
    // The tool executes through the real model-step driver and does not expose author/weight metadata.
    kernel.model.enqueue(agent.id,[{tool:'atn_search',args:{query:'parser'}}])
    await drive(agent,'Retrieve intermediate work.')
    const results=agent.session.snapshotEvents().filter(e=>e.type==='tool/result')
    assert.ok(results.some(e=>JSON.stringify(e).includes('parser extension')))
    const exportRecord=await kernel.atn.network(started.networkId)
    const exported=await kernel.atn.exportSubstrate(started.networkId)
    assert.equal(exported.messages[0].authorId,started.nodeId)
    assert.deepEqual(exported.messages.map(m=>m.weight),exported.messages.map(m=>replayWeights(exportRecord)[m.address]))
    await kernel.ctx.plugin(TypertRegistry)
    await kernel.ctx.plugin(AtnObserver)
    const snap=await kernel.ctx.atnObserver.snapshot(a.id,new AbortController().signal)
    assert.equal(snap.network!.substrate!.messages.length,2)
    assert.equal(snap.network!.substrate!.epoch,(await kernel.atn.network(started.networkId)).stepsUsed)
    assert.throws(()=>observerSnapshotSchema.parse({...snap,network:{...snap.network,substrate:{...snap.network!.substrate,leak:true}}}))
  } finally {await kernel.ctx.fiber.dispose();await rm(scratch,{recursive:true,force:true})}
})


test('SUBSTRATE-ATOMIC: all refusals preserve messages, cursor, weights, steps, events, store writes and agents', async () => {
  const scratch=await mkdtemp(join(tmpdir(),'atn-substrate-atomic-'))
  const original=makeChain(['A','B','C'])
  original.limits={...original.limits,maxSubstrateMessages:2}
  original.tasks.mine=makeTask('mine')
  original.tasks.hidden=makeTask('hidden',{holderId:'B',requesterId:'C'})
  const store=new MemoryNetworkStore([original])
  const kernel=await bootKernel(scratch,{store,clock:()=>100})
  try {
    const a=await createHostAgent(kernel,'session-A')
    await kernel.atn.publish(a,{sub_task:'parser',artifact:'first',rationale:'local'})
    const cases=[
      {refs:['msg:2'],rationale:'msg:2',code:'ref-unresolved'},
      {refs:['task:no'],rationale:'task:no',code:'ref-unresolved'},
      {refs:['task:hidden'],rationale:'task:hidden',code:'ref-not-visible'},
      {refs:['artifact:no'],rationale:'artifact:no',code:'custody-unavailable'},
      {refs:['msg:1'],rationale:'not named',code:'rationale-missing-ref'},
      {refs:['msg:1','msg:1'],rationale:'msg:1',code:'ref-unresolved'},
    ]
    for(const row of cases) {
      const before=await kernel.atn.network(original.id)
      const writes=store.writes,agents=kernel.ctx.agents.list().length,requests=kernel.model.requests.length
      const events=a.session.snapshotEvents()
      await assert.rejects(kernel.atn.publish(a,{sub_task:'parser',artifact:'second',refs:row.refs,rationale:row.rationale}),{code:row.code})
      assert.equal((await kernel.atn.network(original.id)).substrate!.messages.length,before.substrate!.messages.length)
      assert.equal((await kernel.atn.network(original.id)).substrate!.nextAddress,before.substrate!.nextAddress)
      assert.deepEqual((await kernel.atn.network(original.id)).substrate!.weights,before.substrate!.weights)
      assert.equal((await kernel.atn.network(original.id)).stepsUsed,before.stepsUsed)
      assert.deepEqual(await kernel.atn.network(original.id),before)
      assert.equal(store.writes,writes);assert.equal(kernel.ctx.agents.list().length,agents);assert.equal(kernel.model.requests.length,requests)
      assert.deepEqual(a.session.snapshotEvents(),events)
    }
    const dispose=kernel.atn.installOutboundPolicy(original.id,defineCustodyPolicy({custody:()=>['owned'],extractClaims:()=>[]}))
    const before=await kernel.atn.network(original.id)
    await assert.rejects(kernel.atn.publish(a,{sub_task:'x',artifact:'x',rationale:'artifact:foreign',refs:['artifact:foreign']}),{code:'ref-not-owned'})
    assert.deepEqual(await kernel.atn.network(original.id),before)
    await kernel.atn.publish(a,{sub_task:'x',artifact:'x',rationale:'artifact:owned supplies it',refs:['artifact:owned']})
    dispose()
    const full=await kernel.atn.network(original.id)
    const fullWrites=store.writes
    const fullEvents=a.session.snapshotEvents()
    await assert.rejects(kernel.atn.publish(a,{sub_task:'x',artifact:'x',rationale:'local'}),{code:'substrate-full'})
    assert.deepEqual(await kernel.atn.network(original.id),full)
    assert.equal(store.writes,fullWrites)
    assert.deepEqual(a.session.snapshotEvents(),fullEvents)
    // Size validation precedes capacity; it also allocates no address or weight state.
    await assert.rejects(kernel.atn.publish(a,{sub_task:'x',artifact:'中'.repeat(2048),rationale:'local'}),{bound:'maxSubstrateMessageBytes'})
    assert.deepEqual(await kernel.atn.network(original.id),full)
    const writes=store.writes
    await assert.rejects(kernel.atn.visit(a,{addresses:['msg:1','msg:99']}),{code:'ref-unresolved'})
    assert.equal(store.writes,writes)
    kernel.atn.installOutboundPolicy(original.id,()=>{throw new Error('publish blocked')})
    await store.update(original.id,current=>({...current,limits:{...current.limits,maxSubstrateMessages:3}}))
    const prePolicy=await kernel.atn.network(original.id)
    await assert.rejects(kernel.atn.publish(a,{sub_task:'x',artifact:'x',rationale:'local'}),/publish blocked/)
    assert.deepEqual(await kernel.atn.network(original.id),prePolicy)
  } finally {await kernel.ctx.fiber.dispose();await rm(scratch,{recursive:true,force:true})}
})

test('SUBSTRATE-LIFETIME: failure, orphan claim, cold records and stopped read-only archives retain findings', async () => {
  const scratch=await mkdtemp(join(tmpdir(),'atn-substrate-life-'))
  let kernel=await bootKernel(scratch,{clock:()=>100})
  try {
    const root=await createHostAgent(kernel,'substrate-life')
    const start=await kernel.atn.start(root,testGoal)
    const worker=await kernel.atn.spawn(root,{task:'Incomplete parser',context:''})
    const replacement=await kernel.atn.spawn(root,{task:'Waiting replacement',context:''})
    await settle(kernel)
    const agent=kernel.ctx.agents.get(SessionId(worker.sessionId))!
    const reader=kernel.ctx.agents.get(SessionId(replacement.sessionId))!
    await kernel.atn.publish(agent,{sub_task:'parser context',artifact:'recoverable lead',rationale:'local'})
    await kernel.atn.send(reader,{to:start.nodeId,kind:'result',taskId:replacement.taskId,summary:'Available',body:'Available',evidence:[]})
    await settle(kernel)
    await kernel.atn.failNode(start.networkId,worker.nodeId,'fault fixture')
    await kernel.atn.status(reader,{claimTaskId:worker.taskId})
    assert.equal((await kernel.atn.search(reader,{query:'parser'})).messages[0].artifact,'recoverable lead')
    await kernel.atn.publish(reader,{sub_task:'parser recovery',artifact:'continued',rationale:'msg:1 supplies context',refs:['msg:1']})
    const persisted=await kernel.atn.network(start.networkId)
    const ranking=searchSubstrate(persisted,'parser')
    const weights=replayWeights(persisted)
    await writeFile(join(scratch,'replay.json'),JSON.stringify(persisted))
    await kernel.ctx.fiber.dispose()
    kernel=await bootKernel(scratch,{clock:()=>100})
    await kernel.atn.openStore()
    const cold=await kernel.atn.network(start.networkId)
    assert.deepEqual(searchSubstrate(cold,'parser'),ranking)
    assert.deepEqual(replayWeights(cold),weights)
    assert.equal(cold.substrate!.nextAddress,3)
    const resumed=(await kernel.ctx.agents.resume({resumeSessionId:SessionId('substrate-life'),agentOptions:{provider:'atn-script',model:'deterministic'}})).agent
    await kernel.atn.recover()
    await settle(kernel)
    await kernel.atn.stop(start.networkId,'archive')
    const stopped=await kernel.atn.network(start.networkId)
    await assert.rejects(kernel.atn.publish(resumed,{sub_task:'x',artifact:'x',rationale:'x'}),{code:'network-closed'})
    assert.equal((await kernel.atn.search(resumed,{query:'parser'})).messages.length,2)
    assert.deepEqual(await kernel.atn.network(start.networkId),stopped,'archive reads do not write telemetry')
  } finally {await kernel.ctx.fiber.dispose();await rm(scratch,{recursive:true,force:true})}
})

test('SUBSTRATE-COLD-LEGACY: a domain-v1 record with no substrate or substrate limits loads unchanged', async () => {
  const scratch=await mkdtemp(join(tmpdir(),'atn-substrate-legacy-'))
  let kernel=await bootKernel(scratch,{clock:()=>100})
  const legacy=makeChain(['A'])
  for(const key of Object.keys(legacy.limits).filter(key=>/substrate/i.test(key))) delete (legacy.limits as any)[key]
  try {
    await (await kernel.atn.openStore()).create(legacy)
    await kernel.ctx.fiber.dispose()
    kernel=await bootKernel(scratch,{clock:()=>100})
    await kernel.atn.openStore()
    assert.deepEqual(await kernel.atn.network(legacy.id),legacy)
    const a=await createHostAgent(kernel,'session-A')
    assert.deepEqual((await kernel.atn.search(a,{query:'parser'})).messages,[])
    const published=await kernel.atn.publish(a,{sub_task:'parser',artifact:'lead',rationale:'local'})
    assert.equal(published.address,'msg:1')
  } finally {await kernel.ctx.fiber.dispose();await rm(scratch,{recursive:true,force:true})}
})

test('SUBSTRATE-CONCURRENT: atomic allocation, store failure and retired producers preserve the append-only log', async () => {
  const scratch=await mkdtemp(join(tmpdir(),'atn-substrate-concurrent-'))
  const record=makeChain(['A','B'])
  const store=new MemoryNetworkStore([record])
  const kernel=await bootKernel(scratch,{store,clock:()=>100})
  try {
    const a=await createHostAgent(kernel,'session-A')
    const b=await createHostAgent(kernel,'session-B')
    const published=await Promise.all(Array.from({length:12},(_,index)=>kernel.atn.publish(a,{sub_task:`parser ${index}`,artifact:'lead',rationale:'local'})))
    assert.equal(new Set(published.map(m=>m.address)).size,12)
    assert.deepEqual(published.map(m=>m.address),Array.from({length:12},(_,i)=>`msg:${i+1}`))
    const before=await kernel.atn.network(record.id)
    store.failNextUpdate=new Error('disk refusal')
    await assert.rejects(kernel.atn.publish(a,{sub_task:'parser',artifact:'lead',rationale:'local'}),/disk refusal/)
    assert.deepEqual(await kernel.atn.network(record.id),before)
    await kernel.atn.finish(a,'producer retired')
    const retired=await kernel.atn.network(record.id)
    assert.ok(['draining','retired'].includes(retired.nodes.A.lifecycle))
    await kernel.atn.tick()
    assert.equal((await kernel.atn.network(record.id)).nodes.A.lifecycle,'retired')
    const found=await kernel.atn.search(b,{query:'parser'})
    assert.equal(found.messages.length,8)
    assert.ok(Buffer.byteLength(JSON.stringify(found))<=14+8*(2048+256))
    assert.equal((await kernel.atn.network(record.id)).substrate!.messages.length,12)
    await kernel.atn.publish(b,{sub_task:'parser continued',artifact:'lead',rationale:'msg:1 supplies the lead',refs:['msg:1']})
    assert.equal((await kernel.atn.network(record.id)).substrate!.nextAddress,14)
    const current=await kernel.atn.network(record.id)
    const weights=replayWeights(current)
    const replay={...current,substrate:{...current.substrate!,weights:Object.fromEntries(Object.entries(weights).map(([address,value])=>[address,{value,epoch:current.stepsUsed}]))}}
    assert.deepEqual(searchSubstrate(replay,'parser'),searchSubstrate(current,'parser'))
  } finally {await kernel.ctx.fiber.dispose();await rm(scratch,{recursive:true,force:true})}
})

test('SUBSTRATE-DELIVERY: finish.network evidence exports the message transitive closure after completion', async () => {
  const scratch=await mkdtemp(join(tmpdir(),'atn-substrate-delivery-'))
  const kernel=await bootKernel(scratch,{clock:()=>100})
  try {
    const root=await createHostAgent(kernel,'substrate-delivery')
    const start=await kernel.atn.start(root,testGoal)
    for(const refs of [[],['msg:1'],['msg:1'],['msg:2','msg:3']]) await kernel.atn.publish(root,{sub_task:'parser',artifact:'result',rationale:`used ${refs.join(' ')}`,refs})
    await kernel.atn.send(root,{to:start.nodeId,kind:'result',taskId:start.taskId,body:'Done',summary:'Done',evidence:['msg:4']})
    await settle(kernel)
    await kernel.atn.deliver(root,{summary:'Delivery',evidence:['msg:4'],goalVersion:1})
    const record=await kernel.atn.network(start.networkId)
    assert.equal(record.status,'completed')
    assert.deepEqual(evidenceChain(record,['msg:4']),['msg:1','msg:2','msg:3','msg:4'])
    const exported=await kernel.atn.exportSubstrate(start.networkId)
    assert.ok(exported.evidenceChains.some(row=>row.addresses.join(',')==='msg:1,msg:2,msg:3,msg:4'))
    await assert.rejects(kernel.atn.publish(root,{sub_task:'late',artifact:'late',rationale:'late'}),{code:'network-closed'})
  } finally {await kernel.ctx.fiber.dispose();await rm(scratch,{recursive:true,force:true})}
})

test('SUBSTRATE-PRIORITY: existing task-holder and delivery blockers precede new evidence validation', async () => {
  const scratch=await mkdtemp(join(tmpdir(),'atn-substrate-priority-'))
  const record=makeChain(['A','B'])
  record.tasks.work=makeTask('work')
  const store=new MemoryNetworkStore([record])
  const kernel=await bootKernel(scratch,{store,clock:()=>100})
  try {
    const a=await createHostAgent(kernel,'session-A')
    const b=await createHostAgent(kernel,'session-B')
    await assert.rejects(kernel.atn.send(a,{to:'A',kind:'result',taskId:'work',body:'x',summary:'x',evidence:['msg:99']}),{code:'not-holder'})
    assert.deepEqual(await kernel.atn.network(record.id),record)
    const delivery=await kernel.atn.deliver(a,{summary:'x',goalVersion:1,evidence:['msg:99']})
    assert.equal(delivery.accepted,false)
    assert.match(delivery.reason!,/open task/)
    const before=await kernel.atn.network(record.id)
    await assert.rejects(kernel.atn.send(b,{to:'A',kind:'result',taskId:'work',body:'x',summary:'x',evidence:['msg:99']}),{code:'ref-unresolved'})
    assert.deepEqual(await kernel.atn.network(record.id),before)
  } finally {await kernel.ctx.fiber.dispose();await rm(scratch,{recursive:true,force:true})}
})
