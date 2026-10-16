/** Browser-safe codecs for the operator-only observation endpoint. */
import { z } from 'zod'
import { MAX_COLLABORATION_PEERS } from './topology.ts'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import type { AtnObserverSnapshot } from './observer-types.ts'

export const OBSERVER_MAX_TASKS = 200
export const OBSERVER_MAX_EVENTS = 120
export const OBSERVER_TEXT_LIMIT = 512
export const OBSERVER_MAX_SUBSTRATE = 128
export const observerSessionIdSchema = z.string().min(1).max(4096)
const text = z.string().max(OBSERVER_TEXT_LIMIT)
const id = z.string()
const timestamp = z.number().finite().nonnegative()
const count = z.number().int().safe().nonnegative()
const substrate = z.object({
  epoch: count,
  capacity: z.object({ messages:count, maxMessages:count, bytes:count, maxBytes:count }).strict(),
  metrics: z.object({ publishCalls:count, publishedBytes:count, readCalls:count, readMessages:count, readBytes:count }).strict(),
  messages:z.array(z.object({ address:id, sub_task:text, authorId:id,
    weight:z.number().int().min(0).max(1000000).optional(), refCount:count, citerCount:count }).strict()).max(OBSERVER_MAX_SUBSTRATE),
  evidenceChains:z.array(z.object({ taskId:id, addresses:z.array(id).max(OBSERVER_MAX_SUBSTRATE), total:count, truncated:z.boolean() }).strict()).max(OBSERVER_MAX_TASKS),
}).strict()

/** Exact wire shape; arbitrary host properties cannot cross this boundary. */
export const observerSnapshotSchema: z.ZodType<AtnObserverSnapshot> = z.object({
  observedAt: timestamp,
  network: z.object({
    id, status: z.enum(['open', 'completed', 'stopped']), entryNodeId: id,
    goalVersion: z.number().int().positive(), objective: text,
    stepsUsed: z.number().int().nonnegative(), stepBudget: z.number().int().positive(),
    maxCollaborationPeers: z.number().int().min(1).max(MAX_COLLABORATION_PEERS).optional(),
    deadlineAt: timestamp,
    substrate: substrate.optional(),
    nodes: z.array(z.object({
      id, sessionId: id, isEntry: z.boolean(), creatorId: id.nullable(),
      lifecycle: z.enum(['provisioning', 'active', 'draining', 'retired', 'failed']),
      agentStatus: z.enum(['running', 'idle', 'unloaded']), peers: z.array(id).max(MAX_COLLABORATION_PEERS),
      openTasks: z.number().int().nonnegative(), pendingVotes: z.number().int().nonnegative(),
      stepsUsed: z.number().int().nonnegative(),
      currentTool: text.nullable(),
    }).strict()),
    edges: z.array(z.object({ source: id, target: id, kind: z.enum(['collaboration', 'birth']) }).strict()),
    tasks: z.array(z.object({
      id, holderId: id, requesterId: id, description: text,
      status: z.enum(['open', 'completed', 'failed', 'unreachable']), summary: text.nullable(),
      createdAt: timestamp, settledAt: timestamp.nullable(),
    }).strict()).max(OBSERVER_MAX_TASKS),
    events: z.array(z.object({
      id, kind: id, at: timestamp, nodeId: id, targetId: id.nullable(), taskId: id.nullable(), summary: text,
    }).strict()).max(OBSERVER_MAX_EVENTS),
  }).strict().nullable(),
}).strict()

/** Browser transport's public validation name. */
export const atnObserverSnapshotSchema = observerSnapshotSchema

/** Public Typert contribution, shared by the host and browser without a code generator. */
export function createObserverDescriptor(): InvocationDescriptor {
  return {
    id: 'dsh-atn#atnObserver/snapshot', service: 'atnObserver', namespace: 'atnObserver', method: 'snapshot',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'sessionId', wire: 'sessionId', source: 'json',
      codec: { mode: 'strict', typeSymbol: 'dsh-atn#ObserverSessionId', create: () => observerSessionIdSchema },
    }],
    cancellation: { parameter: 'signal' },
    result: {
      mode: 'strict', typeSymbol: 'dsh-atn#AtnObserverSnapshot', create: () => observerSnapshotSchema,
      decode: value => observerSnapshotSchema.parse(value),
    },
  }
}
