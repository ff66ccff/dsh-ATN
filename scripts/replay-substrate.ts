/** Produce a zero-model runtime response and independently rebuild weights/ranking from its durable message prefix. */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootKernel, createHostAgent, settle } from '../tests/fixtures/kernel.ts'
import { searchSubstrate } from '../src/substrate.ts'
import { replayWeights } from '../src/substrate-ranking.ts'
import { networkRecordSchema } from '../src/schema.ts'

const destination='docs/execution-evidence/substrate-2026-10-16'
const scratch=await mkdtemp(join(tmpdir(),'atn-substrate-replay-'))
const kernel=await bootKernel(scratch,{clock:()=>100})
try {
  const caller=await createHostAgent(kernel,'substrate-replay')
  const start=await kernel.atn.start(caller,{objective:'Replay shared work',successCriteria:'Exact ranks',constraints:'Zero model calls'})
  await settle(kernel)
  const setupRequests=kernel.model.requests.length
  for(const refs of [[],[],['msg:2'],['msg:1','msg:3']]) {
    await kernel.atn.admitStep(start.networkId,caller.id)
    await kernel.atn.publish(caller,{sub_task:'parser boundary',artifact:'intermediate lead',rationale:`checked ${refs.join(' ')}`,refs})
  }
  await kernel.atn.admitStep(start.networkId,caller.id)
  const actual=(await kernel.atn.search(caller,{query:'parser'})).messages
  const persisted=networkRecordSchema.parse(JSON.parse(JSON.stringify(await kernel.atn.network(start.networkId))))
  const rebuilt=replayWeights(persisted)
  const replay={...persisted,substrate:{...persisted.substrate!,weights:Object.fromEntries(Object.entries(rebuilt)
    .map(([address,value])=>[address,{value,epoch:persisted.stepsUsed}]))}}
  const result=searchSubstrate(replay,'parser')
  assert.deepEqual(result,actual)
  assert.equal(kernel.model.requests.length,setupRequests)
  const summary={epoch:persisted.stepsUsed,actual,replayed:result,weights:rebuilt,byteIdentical:JSON.stringify(actual)===JSON.stringify(result),
    scriptedSetupRequests:setupRequests,substrateAdditionalModelRequests:0,externalModelCalls:0}
  await mkdir(destination,{recursive:true})
  await writeFile(join(destination,'replay-record.json'),JSON.stringify(persisted,null,2)+'\n')
  await writeFile(join(destination,'replay-result.json'),JSON.stringify(summary,null,2)+'\n')
  console.log(JSON.stringify(summary,null,2))
} finally {await kernel.ctx.fiber.dispose();await rm(scratch,{recursive:true,force:true})}
