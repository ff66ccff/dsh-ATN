/** Optional host mapping into the existing principal/resource/action authorization model. */
import type { Principal, TypertResource } from '@deepseek-ai/dsh-typert-protocol'
import type { NetworkRecord, NodeRecord } from './schema.ts'
import { AtnRefusal } from './refusal.ts'
import { assertSynchronousAdmission } from './information-boundary.ts'
import { replayWeights } from './substrate-ranking.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
 interface TypertResourceMap { 'atn-substrate': TypertResource<string> }
}
export const ATN_SUBSTRATE_READER = {
 name: 'atn-substrate-reader', resource: 'atn-substrate', actions: ['atnSubstrate/read'],
} as const
/** Collision-free network-local resource identity, supplied to the host's existing bindings. */
export function substrateResourceId(networkId: string, address: string): string { return JSON.stringify([networkId, address]) }
export interface SubstrateReadPolicyOptions {
 /** Trusted mapping of the authenticated live node, never a model argument. No mapping grants nothing. */
 principalFor(node: NodeRecord, record: NetworkRecord): Principal | undefined
 /** Use the same synchronous remoteAccess.decide as RPC; no parallel ACL evaluator. */
 decide(request: { principal: Principal; action: 'atnSubstrate/read';
  resources: readonly { kind: 'atn-substrate'; id: string }[] }): { kind: 'allow' } | { kind: 'deny'; reason: string }
}
export type SubstrateReadPolicy = (node: NodeRecord, record: NetworkRecord) => ReadonlySet<string>

/** Host policy and bindings must be pure replayable functions of durable facts; weights never grant access. */
export function defineSubstrateReadPolicy(options: SubstrateReadPolicyOptions): SubstrateReadPolicy {
 return (node, record) => {
  try {
   const principal = options.principalFor(node, record)
   assertSynchronousAdmission(principal)
   const visible = new Set<string>()
   if (principal === undefined) return visible
   // A node must have its own host identity; owner bypass is not a node mapping.
   if (principal.kind === 'owner') throw new Error('node principal must be explicitly mapped')
   for (const message of record.substrate?.messages ?? []) {
    const decision = options.decide({ principal, action: 'atnSubstrate/read', resources: [
     { kind: 'atn-substrate', id: substrateResourceId(record.id, message.address) },
    ] })
    assertSynchronousAdmission(decision)
    if (decision?.kind === 'allow') visible.add(message.address)
    else if (decision?.kind !== 'deny') throw new Error('invalid access decision')
   }
   return visible
  } catch (error) {
   if (error instanceof AtnRefusal && error.code === 'async-policy') throw error
   throw new AtnRefusal('custody-unavailable', 'substrate read policy unavailable')
  }
 }
}

/** Ephemeral model-read projection; NEVER persist this filtered record or its weights. */
export function substrateReadView(record: NetworkRecord, node: NodeRecord, policy?: SubstrateReadPolicy): NetworkRecord {
 if (policy === undefined) return record
 let allowed: ReadonlySet<string>
 try {
  allowed = policy(node, record)
  assertSynchronousAdmission(allowed)
  if (!(allowed instanceof Set)) throw new Error('invalid read scope')
 } catch (error) {
  if (error instanceof AtnRefusal && ['async-policy', 'custody-unavailable'].includes(error.code)) throw error
  throw new AtnRefusal('custody-unavailable', 'substrate read policy unavailable')
 }
 if (record.substrate === undefined) return record
 // Addresses are backward-only, so one ordered pass also closes over every ancestor.
 const visible = new Set<string>()
 const messages = record.substrate.messages.filter(message => {
  if (!allowed.has(message.address) || message.refs.some(ref => ref.startsWith('msg:') && !visible.has(ref))) return false
  visible.add(message.address)
  return true
 })
 const projected: NetworkRecord & { substrate: NonNullable<NetworkRecord['substrate']> } = { ...record, substrate: { ...record.substrate, messages, weights: undefined } }
 if (record.limits.substrateCitationWeight !== false) projected.substrate.weights = Object.fromEntries(
  Object.entries(replayWeights(projected)).map(([address, value]) => [address, { value, epoch: record.stepsUsed }]))
 return projected
}
