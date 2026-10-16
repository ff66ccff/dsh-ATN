/** Structured, append-only shared work; validation and transforms have no observable side effects. */
import { z } from 'zod'
import type { NetworkRecord, SubstrateMessage, SubstrateState } from './schema.ts'
import type { CustodyResolver } from './information-boundary.ts'
import { AtnRefusal } from './refusal.ts'
import { LimitExceededError } from './domain.ts'
import { utf8Bytes } from './config.ts'
import { SUBSTRATE_DEFAULTS } from './substrate-options.ts'
import { addressNumber, rankSubstrate, citeWeight, decayWeight } from './substrate-ranking.ts'

export interface PublishInput { sub_task: string; artifact: string; rationale: string; refs?: readonly string[] }
export interface SubstrateMessageView {
  address: string; sub_task: string; artifact: string; rationale: string; refs: string[]; citedBy: string[]
}
const publishSchema = z.object({
  sub_task: z.string().refine(value => value.trim().length > 0),
  artifact: z.string().refine(value => value.trim().length > 0),
  rationale: z.string().refine(value => value.trim().length > 0),
  refs: z.array(z.string().min(1)).max(32).optional(),
}).strict()

export function substrateLimits(record: NetworkRecord) { return { ...SUBSTRATE_DEFAULTS, ...record.limits } }
export function substrateBytes(message: SubstrateMessage): number { return utf8Bytes(JSON.stringify(message)) }

export function emptySubstrate(record: NetworkRecord): SubstrateState {
  return { messages: [], nextAddress: 1, epoch: record.stepsUsed, totalBytes: 0,
    ...(substrateLimits(record).substrateCitationWeight ? { weights: {} } : {}),
    metrics: { publishCalls: 0, publishedBytes: 0, readCalls: 0, readMessages: 0, readBytes: 0 } }
}

function requireEnabled(record: NetworkRecord): void {
  if (!substrateLimits(record).substrateEnabled) throw new Error('substrate is disabled for this network')
}

/** Exact token occurrence, not a prefix such as msg:1 inside msg:10 or artifact:foo inside artifact:foo/bar. */
function namesRef(rationale: string, ref: string): boolean {
  const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}_:/.-])${escaped}(?=$|[^\\p{L}\\p{N}_:/.-])`, 'u').test(rationale)
}

/** Caller holds the network mutation lock. Admission runs last, before allocating any durable state. */
export function appendSubstrate(record: NetworkRecord, authorId: string, input: PublishInput,
  host: { custody?: CustodyResolver; admit?: () => void } = {}): NetworkRecord {
  requireEnabled(record)
  if (record.status !== 'open') throw new AtnRefusal('network-closed', `network ${record.id} is ${record.status}`)
  const author = record.nodes[authorId]
  if (author === undefined || !['active','draining'].includes(author.lifecycle) || author.creationState !== 'published') {
    throw new AtnRefusal('not-active', 'substrate publication requires an active or draining published node')
  }
  const parsed = publishSchema.parse(input)
  const limits = substrateLimits(record)
  const state = record.substrate ?? emptySubstrate(record)
  const refs = [...(parsed.refs ?? [])]
  const message: SubstrateMessage = { address: `msg:${state.nextAddress}`, sub_task: parsed.sub_task, artifact: parsed.artifact,
    rationale: parsed.rationale, refs, authorId, publishedEpoch: record.stepsUsed }
  const bytes = substrateBytes(message)
  if (bytes > limits.maxSubstrateMessageBytes) throw new LimitExceededError('maxSubstrateMessageBytes', 'substrate message envelope exceeds maxSubstrateMessageBytes')
  if (refs.length > limits.substrateRefsPerMessage || new Set(refs).size !== refs.length) {
    throw new AtnRefusal('ref-unresolved', 'refs exceed the configured limit or repeat an address')
  }
  let owned: Set<string> | undefined
  for (const ref of refs) {
    const match = /^(msg|task|artifact):(.+)$/u.exec(ref)
    if (!match) throw new AtnRefusal('ref-unresolved', `unresolved reference ${ref}`)
    const [, kind, id] = match
    if (kind === 'msg' && (!/^msg:[1-9]\d*$/.test(ref) || !state.messages.some(m => m.address === ref) || addressNumber(ref) >= state.nextAddress)) {
      throw new AtnRefusal('ref-unresolved', `unresolved or future reference ${ref}`)
    }
    if (kind === 'task') {
      const task = record.tasks[id]
      if (!task) throw new AtnRefusal('ref-unresolved', `unresolved reference ${ref}`)
      if (task.holderId !== authorId && task.requesterId !== authorId) throw new AtnRefusal('ref-not-visible', `reference not visible ${ref}`)
    }
    if (kind === 'artifact') {
      if (host.custody === undefined) throw new AtnRefusal('custody-unavailable', `custody unavailable for ${ref}`)
      owned ??= new Set(host.custody(authorId, record))
      if (!owned.has(id)) throw new AtnRefusal('ref-not-owned', `reference not owned ${ref}`)
    }
  }
  for (const ref of refs) if (!namesRef(parsed.rationale, ref)) throw new AtnRefusal('rationale-missing-ref', `rationale must name ${ref}`)
  if (state.messages.length >= limits.maxSubstrateMessages || state.totalBytes + bytes > limits.maxSubstrateTotalBytes) {
    throw new AtnRefusal('substrate-full', 'substrate capacity exhausted; no messages are evicted')
  }
  host.admit?.()
  const weights = limits.substrateCitationWeight ? { ...(state.weights ?? {}), [message.address]: { value: 0, epoch: record.stepsUsed } } : undefined
  if (weights !== undefined) for (const ref of new Set(refs)) if (ref.startsWith('msg:')) {
    weights[ref] = { value: citeWeight(decayWeight(weights[ref] ?? { value: 0, epoch: record.stepsUsed }, record.stepsUsed)), epoch: record.stepsUsed }
  }
  return { ...record, substrate: { messages: [...state.messages, message], nextAddress: state.nextAddress + 1,
    epoch: record.stepsUsed, totalBytes: state.totalBytes + bytes, ...(weights === undefined ? {} : { weights }),
    metrics: { ...state.metrics, publishCalls: state.metrics.publishCalls + 1, publishedBytes: state.metrics.publishedBytes + bytes } } }
}

export function citers(record: NetworkRecord, address: string): string[] {
  return (record.substrate?.messages ?? []).filter(message => message.refs.includes(address))
    .map(message => message.address).sort((a,b) => addressNumber(b)-addressNumber(a))
}

function project(record: NetworkRecord, message: SubstrateMessage): SubstrateMessageView {
  return { address: message.address, sub_task: message.sub_task, artifact: message.artifact, rationale: message.rationale,
    refs: [...message.refs], citedBy: citers(record, message.address).slice(0,substrateLimits(record).substrateCitersShown) }
}

export function searchSubstrate(record: NetworkRecord, query: string): SubstrateMessageView[] {
  requireEnabled(record)
  if (typeof query !== 'string' || utf8Bytes(query) > substrateLimits(record).maxSubstrateMessageBytes) throw new LimitExceededError('substrateQueryBytes', 'substrate query exceeds its byte bound')
  return rankSubstrate(record,query).slice(0,substrateLimits(record).substrateSearchResults).map(message => project(record,message))
}

export function visitSubstrate(record: NetworkRecord, addresses: readonly string[]): SubstrateMessageView[] {
  requireEnabled(record)
  if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > substrateLimits(record).substrateVisitLimit) {
    throw new AtnRefusal('ref-unresolved', 'visit addresses exceed the configured limit or are empty')
  }
  // Resolve the entire call before projecting any content or recording read telemetry.
  const messages = addresses.map(address => {
    const found = record.substrate?.messages.find(message => message.address === address)
    if (!found) throw new AtnRefusal('ref-unresolved', `unresolved reference ${address}`)
    return found
  })
  return messages.map(message => project(record,message))
}

export function recordSubstrateRead(record: NetworkRecord, messages: SubstrateMessageView[]): NetworkRecord {
  const state = record.substrate ?? emptySubstrate(record)
  return { ...record, substrate: { ...state, metrics: { ...state.metrics,
    readCalls: state.metrics.readCalls + 1, readMessages: state.metrics.readMessages + messages.length,
    readBytes: state.metrics.readBytes + utf8Bytes(JSON.stringify({ messages })) } } }
}

/** Full host-only audit closure. Unknown msg evidence is refused rather than inventing a link. */
export function evidenceChain(record: NetworkRecord, evidence: readonly string[]): string[] {
  const visited = new Set<string>()
  const pending = evidence.filter(ref => ref.startsWith('msg:'))
  while (pending.length) {
    const address = pending.pop()!
    if (visited.has(address)) continue
    const message = record.substrate?.messages.find(message => message.address === address)
    if (!message) throw new AtnRefusal('ref-unresolved', `unresolved evidence ${address}`)
    visited.add(address)
    pending.push(...message.refs.filter(ref => ref.startsWith('msg:')))
  }
  return [...visited].sort((a,b) => addressNumber(a)-addressNumber(b))
}
