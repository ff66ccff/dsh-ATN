/** Bounded, metered stigmergy: durable publications never deliver mail or wake a peer. */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { MAX_WHITEBOARD_ENTRIES, MAX_WHITEBOARD_ENTRY_BYTES, MAX_WHITEBOARD_TOTAL_BYTES,
  MAX_KNOWLEDGE_ITEMS, MAX_KNOWLEDGE_TEXT_LENGTH, whiteboardEntrySchema, type NetworkRecord, type Whiteboard, type WhiteboardEntry, type WhiteboardUsage } from './schema.ts'

export { MAX_WHITEBOARD_ENTRIES, MAX_WHITEBOARD_ENTRY_BYTES, MAX_WHITEBOARD_TOTAL_BYTES } from './schema.ts'
export const MAX_WHITEBOARD_READ_ENTRIES = 8
export const MAX_WHITEBOARD_READ_BYTES = 16 * 1024

/** Ownership and timestamps come from the runtime, never model arguments. */
export interface WhiteboardInput {
  readonly action: 'read' | 'publish' | 'remove'
  readonly key?: string
  readonly body?: string
  readonly topics?: readonly string[]
  readonly documents?: readonly string[]
  /** 0 creates an absent key; updates and removals require the exact current revision. */
  readonly expectedRevision?: number
  readonly query?: string
  readonly limit?: number
  /** Opaque read continuation. Any publication/removal invalidates older cursors. */
  readonly cursor?: string
}

export interface WhiteboardCapacity {
  entries: number
  bytes: number
  maxEntries: number
  maxBytes: number
  maxEntryBytes: number
}

interface WhiteboardResultBase {
  snapshotRevision: number
  usage: WhiteboardUsage
  capacity: WhiteboardCapacity
}

export type WhiteboardResult = WhiteboardResultBase & ({
  action: 'read'
  entries: WhiteboardEntry[]
  totalMatches: number
  nextCursor: string | null
  returnedBytes: number
} | {
  action: 'publish' | 'remove'
  key: string
  revision: number
  entry: WhiteboardEntry | null
})

export class WhiteboardError extends Error {
  constructor(readonly code: 'invalid-input' | 'unavailable' | 'not-author' | 'revision-conflict' |
    'capacity-exceeded' | 'stale-cursor' | 'counter-exhausted', message: string) {
    super(message)
    this.name = 'WhiteboardError'
  }
}

const keySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,95}$/)
const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('read'), key: keySchema.optional(), query: z.string().max(256).optional(),
    limit: z.number().int().min(1).max(MAX_WHITEBOARD_READ_ENTRIES).optional(), cursor: z.string().min(1).max(512).optional() }).strict(),
  z.object({ action: z.literal('publish'), key: keySchema, body: z.string().min(1).max(MAX_WHITEBOARD_ENTRY_BYTES),
    documents: z.array(z.string().trim().min(1).max(MAX_KNOWLEDGE_TEXT_LENGTH)).max(MAX_KNOWLEDGE_ITEMS).optional(),
    topics: z.array(z.string().trim().min(1).max(80)).max(8).optional(), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('remove'), key: keySchema, expectedRevision: z.number().int().positive() }).strict(),
])

const cursorSchema = z.object({ generation: z.number().int().nonnegative(), filter: z.string().regex(/^[a-f0-9]{64}$/),
  after: keySchema }).strict()

function bytes(value: unknown): number { return Buffer.byteLength(JSON.stringify(value), 'utf8') }
function normalize(value: string): string { return value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ') }
function ascending(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0 }
function emptyBoard(): Whiteboard {
  return { generation: 0, entries: [], usage: { reads: 0, writes: 0, readBytes: 0, writeBytes: 0 } }
}

function capacity(entries: WhiteboardEntry[]): WhiteboardCapacity {
  return { entries: entries.length, bytes: bytes(entries), maxEntries: MAX_WHITEBOARD_ENTRIES,
    maxBytes: MAX_WHITEBOARD_TOTAL_BYTES, maxEntryBytes: MAX_WHITEBOARD_ENTRY_BYTES }
}

function addUsage(usage: WhiteboardUsage, action: 'read' | 'write', payloadBytes: number): WhiteboardUsage {
  const next = action === 'read'
    ? { ...usage, reads: usage.reads + 1, readBytes: usage.readBytes + payloadBytes }
    : { ...usage, writes: usage.writes + 1, writeBytes: usage.writeBytes + payloadBytes }
  if (!Object.values(next).every(Number.isSafeInteger)) throw new WhiteboardError('counter-exhausted', 'whiteboard usage counter is exhausted')
  return next
}

function score(entry: WhiteboardEntry, query: string): number {
  if (query.length === 0 || query === '*') return 1
  const terms = [...new Set(query.split(' '))]
  const index = normalize([entry.key, ...entry.topics, ...(entry.documents ?? [])].join(' '))
  const body = normalize(entry.body)
  return terms.reduce((sum, term) => sum + (index.includes(term) ? 2 : 0) + (body.includes(term) ? 1 : 0), 0)
}

/**
 * Atomic transform for all three operations, including metered reads. It never
 * writes another node, mailbox, task, lease or step counter. Exact revisions
 * implement compare-and-swap: a stale retry must reread, never silently replace
 * a concurrent update. A removed key may be recreated with a new global revision.
 */
export function accessWhiteboard(
  record: NetworkRecord,
  nodeId: string,
  input: WhiteboardInput,
  now: number,
): { record: NetworkRecord; result: WhiteboardResult } {
  const node = record.nodes[nodeId]
  if (!Number.isSafeInteger(now) || now < record.createdAt || record.status !== 'open' || now >= record.deadlineAt ||
    node === undefined || node.creationState !== 'published' || (node.lifecycle !== 'active' && node.lifecycle !== 'draining')) {
    throw new WhiteboardError('unavailable', 'the whiteboard requires a live published caller in an open network')
  }
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new WhiteboardError('invalid-input', parsed.error.message)
  const request = parsed.data
  const board = record.whiteboard ?? emptyBoard()
  if (request.action === 'read') {
    const query = normalize(request.query ?? '')
    const filter = createHash('sha256').update(JSON.stringify([request.key ?? null, query])).digest('hex')
    const matches = board.entries.filter(entry => request.key === undefined || entry.key === request.key)
      .map(entry => ({ entry, score: score(entry, query) })).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || ascending(a.entry.key, b.entry.key)).map(item => item.entry)
    let start = 0
    if (request.cursor !== undefined) {
      let cursor: z.infer<typeof cursorSchema>
      try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(request.cursor, 'base64url').toString('utf8'))) }
      catch { throw new WhiteboardError('invalid-input', 'invalid whiteboard read cursor') }
      if (cursor.generation !== board.generation || cursor.filter !== filter) {
        throw new WhiteboardError('stale-cursor', 'whiteboard or query changed; restart reading without a cursor')
      }
      const previous = matches.findIndex(entry => entry.key === cursor.after)
      if (previous < 0) throw new WhiteboardError('invalid-input', 'whiteboard cursor does not name a matching entry')
      start = previous + 1
    }
    const entries: WhiteboardEntry[] = []
    const limit = request.limit ?? MAX_WHITEBOARD_READ_ENTRIES
    for (const entry of matches.slice(start, start + limit)) {
      if (bytes([...entries, entry]) > MAX_WHITEBOARD_READ_BYTES) break
      entries.push(entry)
    }
    const returnedBytes = bytes(entries)
    const usage = addUsage(board.usage, 'read', returnedBytes)
    const nextCursor = start + entries.length < matches.length && entries.length > 0
      ? Buffer.from(JSON.stringify({ generation: board.generation, filter, after: entries.at(-1)!.key })).toString('base64url') : null
    return { record: { ...record, whiteboard: { ...board, usage } }, result: {
      action: 'read', entries: structuredClone(entries), totalMatches: matches.length, nextCursor, returnedBytes,
      snapshotRevision: board.generation, usage: { ...usage }, capacity: capacity(board.entries),
    } }
  }

  const existing = board.entries.find(entry => entry.key === request.key)
  if (existing !== undefined && existing.authorId !== nodeId) {
    throw new WhiteboardError('not-author', `only author ${existing.authorId} can update or remove ${request.key}`)
  }
  if (request.expectedRevision !== (existing?.revision ?? 0)) {
    throw new WhiteboardError('revision-conflict', `expected revision ${request.expectedRevision} but current revision is ${existing?.revision ?? 0}; reread before retrying`)
  }
  if (existing !== undefined && now < existing.updatedAt) throw new WhiteboardError('invalid-input', 'publication time cannot precede the previous update')
  const revision = Math.max(record.sequence, board.generation) + 1
  if (!Number.isSafeInteger(revision)) throw new WhiteboardError('counter-exhausted', 'whiteboard revision counter is exhausted')
  let entry: WhiteboardEntry | null = null
  if (request.action === 'publish') {
    const topics = [...new Map((request.topics ?? []).map(topic => [normalize(topic), topic])).values()]
    const published = whiteboardEntrySchema.safeParse({ key: request.key, authorId: nodeId, body: request.body, topics,
      ...(request.documents === undefined ? {} : { documents: [...new Map(request.documents.map(document => [normalize(document), document])).values()] }),
      revision, createdAt: existing?.createdAt ?? now, updatedAt: now })
    if (!published.success) throw new WhiteboardError('invalid-input', published.error.message)
    entry = published.data
  }
  const entries = board.entries.filter(item => item.key !== request.key)
  if (entry !== null) entries.push(entry)
  entries.sort((a, b) => ascending(a.key, b.key))
  const capacityNow = capacity(entries)
  if (capacityNow.entries > MAX_WHITEBOARD_ENTRIES || capacityNow.bytes > MAX_WHITEBOARD_TOTAL_BYTES) {
    throw new WhiteboardError('capacity-exceeded', 'whiteboard capacity reached; update or remove your own entries before publishing more')
  }
  const payload = entry ?? { key: request.key, revision, entry: null }
  const usage = addUsage(board.usage, 'write', bytes(payload))
  const whiteboard: Whiteboard = { generation: revision, entries, usage }
  return { record: { ...record, sequence: revision, whiteboard }, result: {
    action: request.action, key: request.key, revision, entry: entry === null ? null : structuredClone(entry),
    snapshotRevision: revision, usage: { ...usage }, capacity: capacityNow,
  } }
}
