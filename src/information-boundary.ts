/** Host-only outbound admission and authoritative artifact custody. */
import type {
  StartInput, SpawnInput, SendInput, DeliverInput, ProposeInput, VoteInput, RenewInput, RewireInput,
} from './runtime.ts'
import type { RequesterFeedbackInput } from './requester-feedback.ts'
import type { NetworkRecord, NodeRecord } from './schema.ts'
import { AtnRefusal } from './refusal.ts'

/** Explicit protocol inventory; additions require an audit and a coverage case. */
export const OUTBOUND_CHANNELS = [
  'start', 'spawn', 'send.task', 'send.note', 'send.result',
  'status.review', 'status.claim', 'status.rewire',
  'finish.node', 'finish.network', 'propose', 'vote', 'renew',
] as const
export type OutboundChannel = (typeof OUTBOUND_CHANNELS)[number]

/** Complete caller input, including optional transport fields. No text is stripped. */
export type OutboundOperation =
  | { channel: 'start'; input: StartInput }
  | { channel: 'spawn'; input: SpawnInput }
  | { channel: 'send.task' | 'send.note' | 'send.result'; input: SendInput }
  | { channel: 'status.review'; input: RequesterFeedbackInput }
  | { channel: 'status.claim'; input: { taskId: string } }
  | { channel: 'status.rewire'; input: RewireInput }
  | { channel: 'finish.node'; input: { reason?: string } }
  | { channel: 'finish.network'; input: DeliverInput }
  | { channel: 'propose'; input: ProposeInput }
  | { channel: 'vote'; input: VoteInput }
  | { channel: 'renew'; input: RenewInput }

export type ArtifactIds = ReadonlySet<string> | readonly string[]
/** Actual host-held artifacts; receiving or mentioning an id does not confer custody. */
export type CustodyResolver = (nodeId: string, record: NetworkRecord) => ArtifactIds
/** Optional host catalog: topics are derived only for ids in the custody set. */
export type ArtifactDescriptor = (artifactId: string, record: NetworkRecord) => { topics?: readonly string[] }

export interface NetworkOutboundPolicy {
  (record: NetworkRecord, sender: NodeRecord, operation: OutboundOperation): void
  readonly custody?: CustodyResolver
  readonly describeArtifact?: ArtifactDescriptor
}

export interface CustodyPolicyOptions {
  custody: CustodyResolver
  /** The host defines claim syntax. Inspect the entire input, not only its body. */
  extractClaims: (input: OutboundOperation['input'], operation: OutboundOperation,
    record: NetworkRecord, sender: NodeRecord) => ArtifactIds
  describeArtifact?: ArtifactDescriptor
  /** Domain rules run first, preserving their established refusal precedence. */
  validate?: (record: NetworkRecord, sender: NodeRecord, operation: OutboundOperation) => void
  onRefusal?: (error: unknown, record: NetworkRecord, sender: NodeRecord, operation: OutboundOperation) => void
}

/** A promise is not an admission decision and cannot be silently accepted. */
export function assertSynchronousAdmission(result: unknown): void {
  if (result !== null && (typeof result === 'object' || typeof result === 'function') &&
    'then' in result && typeof result.then === 'function') {
    void Promise.resolve(result).catch(() => undefined)
    throw new AtnRefusal('async-policy', 'async-policy: outbound admission must finish synchronously before persistence')
  }
}

/**
 * One custody source serves both admission and discovery. Synchronous checks run
 * inside the network transaction; throwing commits neither ids nor business state.
 * This checks artifact identities recognized by the host's extractor, not semantics.
 */
export function defineCustodyPolicy(options: CustodyPolicyOptions): NetworkOutboundPolicy {
  const policy: NetworkOutboundPolicy = (record, sender, operation) => {
    try {
      assertSynchronousAdmission(options.validate?.(record, sender, operation))
      const owned = new Set(options.custody(sender.id, record))
      for (const artifactId of options.extractClaims(operation.input, operation, record, sender)) {
        if (!owned.has(artifactId)) {
          throw new AtnRefusal('evidence-not-owned',
            `evidence-not-owned: node ${sender.id} does not hold artifact ${artifactId}`)
        }
      }
    } catch (error) {
      options.onRefusal?.(error, record, sender, operation)
      throw error
    }
  }
  return Object.assign(policy, { custody: options.custody, describeArtifact: options.describeArtifact })
}
