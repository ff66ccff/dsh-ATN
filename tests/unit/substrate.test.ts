/** Zero-model admission, durable replay and integer ranking contracts. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { appendSubstrate, searchSubstrate, visitSubstrate, evidenceChain, substrateBytes } from '../../src/substrate.ts'
import { tokenize, fixedLn, bm25Relevance, weightAt, replayWeights, SCALE } from '../../src/substrate-ranking.ts'
import { networkRecordSchema, ATN_DOMAIN_VERSION } from '../../src/schema.ts'
import { assertConfigRelations, limitsFromConfig } from '../../src/config.ts'
import { makeChain, makeTask, testConfig } from '../fixtures/network.ts'
import type { NetworkRecord } from '../../src/schema.ts'

const input = (sub_task = 'parser boundary', refs: string[] = []) => ({ sub_task, artifact: 'reusable intermediate result', rationale: `checked ${refs.join(' ')}`, refs })
const add = (r: NetworkRecord, refs: string[] = [], title?: string) => appendSubstrate(r, 'A', input(title, refs))

test('SUBSTRATE-CONFIG: defaults, frozen limits, relations and strict legacy compatibility', () => {
  const config = testConfig()
  assert.equal(config.substrateEnabled, true)
  assert.equal(config.substrateCitationWeight, true)
  assert.equal(config.maxSubstrateMessages, 128)
  assert.equal(config.maxSubstrateMessageBytes, 2048)
  assert.equal(config.maxSubstrateTotalBytes, 131072)
  assert.equal(config.substrateSearchResults, 8)
  assert.equal(config.substrateVisitLimit, 8)
  assert.equal(config.substrateRefsPerMessage, 32)
  assert.equal(config.substrateCitersShown, 8)
  for (const field of ['maxSubstrateMessages', 'maxSubstrateMessageBytes', 'maxSubstrateTotalBytes', 'substrateSearchResults', 'substrateVisitLimit', 'substrateRefsPerMessage', 'substrateCitersShown'] as const) {
    assert.throws(() => assertConfigRelations({ ...config, [field]: 0 }), new RegExp(field))
  }
  for (const [field, value] of [['substrateSearchResults',17],['substrateVisitLimit',17],['substrateRefsPerMessage',33],['substrateCitersShown',9]] as const) {
    assert.throws(() => assertConfigRelations({ ...config, [field]: value }), new RegExp(field))
  }
  assert.throws(() => assertConfigRelations({ ...config, maxSubstrateTotalBytes: 100 }), /maxSubstrateTotalBytes/)
  assert.equal(limitsFromConfig(config).substrateEnabled, true)
  const legacy = makeChain(['A'])
  assert.deepEqual(networkRecordSchema.parse(legacy), legacy)
  assert.equal(ATN_DOMAIN_VERSION, 1)
  assert.throws(() => networkRecordSchema.parse({ ...legacy, substrate: { unexpected: true } }))
  const published=add(legacy)
  assert.throws(()=>networkRecordSchema.parse({...published,substrate:{...published.substrate!,messages:[{...published.substrate!.messages[0],refs:['msg:1']}]}}))
})

test('SUBSTRATE-ADMISSION: every invalid reference/field refuses atomically and names the reference', () => {
  const original = add(makeChain(['A', 'B', 'C']))
  original.tasks.mine = makeTask('mine')
  original.tasks.hidden = makeTask('hidden', { requesterId:'B', holderId:'C' })
  const cases = [
    { value: input('x',['msg:2']), code:'ref-unresolved', ref:'msg:2' },
    { value: input('x',['msg:99']), code:'ref-unresolved', ref:'msg:99' },
    { value: input('x',['task:missing']), code:'ref-unresolved', ref:'task:missing' },
    { value: input('x',['task:hidden']), code:'ref-not-visible', ref:'task:hidden' },
    { value: input('x',['artifact:missing']), code:'custody-unavailable', ref:'artifact:missing' },
    { value: input('x',['other:x']), code:'ref-unresolved', ref:'other:x' },
    ...['msg:1','task:mine','artifact:owned'].map(ref => ({ value:{...input('x',[ref]),rationale:'no citation'}, code:'rationale-missing-ref',ref, custody:()=>['owned'] })),
  ]
  for (const row of cases) {
    const before = structuredClone(original)
    assert.throws(() => appendSubstrate(original,'A',row.value,{custody:'custody' in row ? row.custody : undefined}), (error: any) => error.code===row.code && error.message.includes(row.ref))
    assert.deepEqual(original,before, `no address/weight/step/event change: ${row.ref}`)
  }
  assert.throws(() => appendSubstrate(original,'A',input('x',['artifact:foreign']),{custody:()=>['owned']}), {code:'ref-not-owned'})
  for (const value of [{...input(),sub_task:' '},{...input(),artifact:''},{...input(),rationale:''},{...input(),refs:['msg:1','msg:1']},{...input(),refs:Array.from({length:33},(_,i)=>`msg:${i+1}`)}, {...input(),artifact:'中'.repeat(2048)}]) {
    const before=structuredClone(original)
    assert.throws(() => appendSubstrate(original,'A',value))
    assert.deepEqual(original,before)
  }
  // Exact token boundaries, not substring matches (msg:1 is not msg:10).
  assert.throws(() => appendSubstrate(original,'A',{...input('x',['msg:1']), rationale:'msg:10 supplied it'}),{code:'rationale-missing-ref'})
  const accepted=appendSubstrate(original,'A',input('x',['msg:1','task:mine','artifact:owned']),{custody:()=>['owned']})
  assert.equal(accepted.substrate!.nextAddress,3)
  assert.equal(accepted.substrate!.messages.length,2)
  assert.deepEqual(original.substrate!.messages[0],accepted.substrate!.messages[0],'old messages are immutable')
  assert.throws(() => appendSubstrate(original,'A',input(),{admit:()=>{throw new Error('host policy')}}),/host policy/)
  const second=appendSubstrate(original,'A',input('x',['msg:1','task:mine']),{custody:()=>[]})
  assert.equal(second.substrate!.weights!['msg:1'].value,300000,'task references add no weight')
})

test('SUBSTRATE-CAPACITY: envelope bytes, count and total caps never evict or consume addresses', () => {
  let record=makeChain(['A'])
  record.limits={...record.limits,maxSubstrateMessages:1}
  record=add(record)
  const before=structuredClone(record)
  assert.throws(()=>add(record),{code:'substrate-full'})
  assert.deepEqual(record,before)
  const bytes=substrateBytes(record.substrate!.messages[0])
  const exact=makeChain(['A'],{limits:{...record.limits,maxSubstrateMessages:128,maxSubstrateMessageBytes:bytes,maxSubstrateTotalBytes:bytes}})
  const full=add(exact)
  assert.equal(full.substrate!.totalBytes,bytes)
  assert.throws(()=>add(full),{code:'substrate-full'})
  assert.throws(()=>add({...exact,limits:{...exact.limits,maxSubstrateMessageBytes:bytes-1}}))
  assert.deepEqual(full.substrate!.messages,record.substrate!.messages)
})

test('SUBSTRATE-TOKENIZE: NFKC, mixed CJK, punctuation and case are deterministic', () => {
  assert.deepEqual(tokenize('ＡＢＣ，中文测试! Foo-42'), ['abc','中文测试','中文','文测','测试','foo','42'])
  assert.deepEqual(tokenize('Parser/BOUNDARY'),tokenize('parser boundary'))
  assert.deepEqual(tokenize('---'),[])
})

test('SUBSTRATE-LN: monotone deterministic logarithm is within two fixed units of reference', () => {
  let last=-1n
  for(let n=100;n<=10000;n++) {
    const value=fixedLn(BigInt(n),100n)
    assert.ok(value>=last);last=value
    assert.ok(Math.abs(Number(value)/Number(SCALE)-Math.log(n/100))<2/Number(SCALE))
  }
  assert.equal(fixedLn(1n,1n),0n)
})

test('SUBSTRATE-BM25: integer score matches float reference with a bounded truncation error', () => {
  let record=add(makeChain(['A']),[],'parser parser boundary')
  record=add(record,[],'boundary edge cases')
  record=add(record,[],'totally different finding')
  const messages=record.substrate!.messages
  const scores=bm25Relevance(messages,'parser boundary')
  const docs=messages.map(m=>tokenize(`${m.sub_task} ${m.artifact} ${m.rationale}`))
  const avg=docs.reduce((s,d)=>s+d.length,0)/docs.length
  docs.forEach((doc,i)=>{
    let expected=0
    for(const term of ['parser','boundary']) {
      const tf=doc.filter(t=>t===term).length
      const df=docs.filter(d=>d.includes(term)).length
      expected+=Math.log(1+(docs.length-df+0.5)/(df+0.5))*tf*2.5/(tf+1.5*(0.25+0.75*doc.length/avg))
    }
    assert.ok(Math.abs(Number(scores.get(messages[i].address)??0n)/Number(SCALE)-expected)<7/Number(SCALE))
  })
})

test('SUBSTRATE-RANK: relevance gate, early ties, empty/k limits, order-independent replay and hidden fields', () => {
  let record=add(makeChain(['A']))
  record=add(record)
  record=add(record,['msg:2'],'unrelated note')
  const result=searchSubstrate(record,'parser')
  assert.equal(result[0].address,'msg:2','citation reorders related messages')
  assert.deepEqual(searchSubstrate(record,'absent'),[])
  assert.ok(!result.some(m=>m.address==='msg:3'))
  const pure={...record,limits:{...record.limits,substrateCitationWeight:false,substrateSearchResults:1}}
  assert.deepEqual(searchSubstrate(pure,'parser').map(m=>m.address),['msg:1'])
  assert.deepEqual(searchSubstrate({...record,substrate:{...record.substrate!,messages:[...record.substrate!.messages].reverse()}},'parser'),result)
  assert.doesNotMatch(JSON.stringify(result),/author|weight|epoch|publishedEpoch|authorId/)
  assert.deepEqual(result.find(m=>m.address==='msg:2')!.citedBy,['msg:3'])
  assert.deepEqual(visitSubstrate(record,['msg:1','msg:2']),[...result].reverse())
  assert.throws(()=>visitSubstrate(record,['msg:1','msg:99']),{code:'ref-unresolved'})
  assert.throws(()=>visitSubstrate(record,Array(9).fill('msg:1')))
})

test('SUBSTRATE-WEIGHTS: exact hand examples, lazy step decay, disabled mode and history replay', () => {
  let record=add(makeChain(['A']))
  record=add(record,['msg:1'])
  assert.equal(weightAt(record,'msg:1'),300000)
  record=add(record,['msg:1'])
  assert.equal(weightAt(record,'msg:1'),510000)
  record={...record,stepsUsed:2}
  assert.equal(weightAt(record,'msg:1'),489804)
  record=add(record,['msg:1'])
  assert.equal(weightAt(record,'msg:1'),642862)
  for(const epoch of [0,1,2,7,100000]) {
    const snapshot={...record,stepsUsed:epoch,substrate:{...record.substrate!,messages:record.substrate!.messages.filter(m=>m.publishedEpoch<=epoch)}}
    const weights=replayWeights(snapshot)
    if(epoch>=2) assert.equal(weights['msg:1'],weightAt(snapshot,'msg:1'))
  }
  const disabled=add(makeChain(['A'],{limits:{...record.limits,substrateCitationWeight:false}}))
  const next=add(disabled,['msg:1'])
  assert.equal(next.substrate!.weights,undefined)
  assert.equal(weightAt(next,'msg:1'),undefined)
  assert.deepEqual(replayWeights(next),{})
  const independent=add(makeChain(['A']),[],'parser')
  assert.equal(weightAt({...independent,stepsUsed:100000},'msg:1'),0)
})

test('SUBSTRATE-CHAIN: transitive chain/branch closure deduplicates, sorts addresses and includes resources', () => {
  let r=add(makeChain(['A']))
  r=add(r,['msg:1'])
  r=add(r,['msg:1'])
  r=add(r,['msg:2','msg:3'])
  assert.deepEqual(evidenceChain(r,['msg:4','msg:2']),['msg:1','msg:2','msg:3','msg:4'])
})

test('SUBSTRATE-INTEGER-AUDIT: no float literal, Math or clock in ranking/weight path', () => {
  const source=readFileSync(new URL('../../src/substrate-ranking.ts',import.meta.url),'utf8')
  const file=ts.createSourceFile('ranking.ts',source,ts.ScriptTarget.Latest,true)
  const inspect=(node:ts.Node)=>{
    if(ts.isNumericLiteral(node)) assert.doesNotMatch(node.text,/[.eE]/)
    if(ts.isPropertyAccessExpression(node)) assert.ok(!['Math','Date','performance'].includes(node.expression.getText(file)))
    ts.forEachChild(node,inspect)
  }
  inspect(file)
})
