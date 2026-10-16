import assert from 'node:assert/strict'
import test from 'node:test'
import { defineSubstrateReadPolicy, substrateReadView, substrateResourceId } from '../../src/substrate-read-policy.ts'
import { appendSubstrate, searchSubstrate, evidenceChain } from '../../src/substrate.ts'
import { makeChain } from '../fixtures/network.ts'

test('READ-POLICY-PURE: persisted facts plus the same policy replay byte-identically without mutating the record', () => {
 let record = makeChain(['A'])
 for (const refs of [[], ['msg:1'], [], ['msg:2']]) record = appendSubstrate(record, 'A', { sub_task: 'parser', artifact: 'parser', rationale: refs.join(' ') || 'local', refs })
 const before = JSON.stringify(record)
 const policy = defineSubstrateReadPolicy({ principalFor: () => ({ kind: 'substrate-node', id: 'A' }),
  decide: request => request.resources[0].id === substrateResourceId(record.id, 'msg:2') ? { kind: 'deny', reason: 'no-allow' } : { kind: 'allow' },
 })
 const visible = substrateReadView(record, record.nodes.A, policy)
 assert.deepEqual(visible.substrate!.messages.map(m => m.address), ['msg:1', 'msg:3'])
 assert.equal(JSON.stringify(searchSubstrate(visible, 'parser')), JSON.stringify(searchSubstrate(substrateReadView(JSON.parse(before), record.nodes.A, policy), 'parser')))
 assert.throws(() => evidenceChain(visible, ['msg:4']), { code: 'ref-unresolved' })
 assert.equal(JSON.stringify(record), before)
 assert.equal(substrateReadView(record, record.nodes.A), record)
})

test('READ-POLICY-IDENTITY: resource IDs cannot collide and missing/owner mappings cannot authorize nodes', () => {
 const record = appendSubstrate(makeChain(['A']), 'A', { sub_task: 'x', artifact: 'x', rationale: 'x' })
 assert.notEqual(substrateResourceId('a,b', 'msg:1'), substrateResourceId('a', 'b,msg:1'))
 const missing = defineSubstrateReadPolicy({ principalFor: () => undefined, decide: () => { throw new Error('must not decide without a principal') } })
 assert.deepEqual(searchSubstrate(substrateReadView(record, record.nodes.A, missing), 'x'), [])
 const owner = defineSubstrateReadPolicy({ principalFor: () => ({ kind: 'owner' }), decide: () => ({ kind: 'allow' }) })
 assert.throws(() => substrateReadView(record, record.nodes.A, owner), { code: 'custody-unavailable', message: 'substrate read policy unavailable' })
})
