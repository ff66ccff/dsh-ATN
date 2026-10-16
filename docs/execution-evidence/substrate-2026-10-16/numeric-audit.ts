/** Float reference is confined to this audit, never the ranking/weight module. */
import assert from 'node:assert/strict'
import { fixedLn, SCALE, bm25Relevance, tokenize, citeWeight, decayWeight } from '../../../src/substrate-ranking.ts'
import { appendSubstrate } from '../../../src/substrate.ts'
import { makeChain } from '../../../tests/fixtures/network.ts'

let maxLnError=0, previous=-1n
for(let numerator=100; numerator<=10000; numerator++) {
  const fixed=fixedLn(BigInt(numerator),100n)
  assert.ok(fixed>=previous); previous=fixed
  maxLnError=Math.max(maxLnError,Math.abs(Number(fixed)/Number(SCALE)-Math.log(numerator/100)))
}
let record=makeChain(['A'])
let maxRelError=0
for(let n=1;n<=128;n++) {
  record=appendSubstrate(record,'A',{sub_task:`parser ${'boundary '.repeat(n%7)}${'edge '.repeat(n%3)}`,artifact:'intermediate reusable lead',rationale:'local'})
  const messages=record.substrate!.messages
  const scores=bm25Relevance(messages,'parser boundary')
  const documents=messages.map(m=>tokenize(`${m.sub_task} ${m.artifact} ${m.rationale}`))
  const avg=documents.reduce((s,d)=>s+d.length,0)/n
  documents.forEach((doc,i)=>{
    let expected=0
    for(const term of ['parser','boundary']) {
      const tf=doc.filter(t=>t===term).length
      const df=documents.filter(d=>d.includes(term)).length
      expected+=Math.log(1+(n-df+0.5)/(df+0.5))*tf*2.5/(tf+1.5*(0.25+0.75*doc.length/avg))
    }
    maxRelError=Math.max(maxRelError,Math.abs(Number(scores.get(messages[i].address)??0n)/Number(SCALE)-expected))
  })
}
let value=0, ideal=0, maxWeightError=0
for(let epoch=1;epoch<=100000;epoch++) {
  value=decayWeight({value,epoch:epoch-1},epoch);ideal*=0.98
  if(epoch%23===0){value=citeWeight(value);ideal+=0.3*(1-ideal)}
  maxWeightError=Math.max(maxWeightError,Math.abs(value/Number(SCALE)-ideal))
}
assert.ok(maxLnError<2e-6)
assert.ok(maxRelError<7e-6)
assert.ok(maxWeightError<50e-6)
console.log(JSON.stringify({scale:Number(SCALE),ln:{samples:9901,maxAbsoluteError:maxLnError,assertedBound:2e-6},
  bm25:{corpusSizes:128,queryTerms:2,maxAbsoluteError:maxRelError,assertedBound:7e-6},
  weight:{steps:100000,maxAbsoluteError:maxWeightError,analyticBound:50e-6}},null,2))
