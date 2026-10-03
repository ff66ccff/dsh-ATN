/**
 * Durable mailbox semantics.
 *
 * Everything here operates on a `NetworkRecord` and returns a new record, so a
 * caller can put enqueue, task settlement and its outbox row in ONE atomic
 * network update. Enqueue is always persisted before any delivery is attempted:
 * `queued` means durable-but-not-in-the-target's-input, `delivered` means the
 * target's persisted input holds it.
 * @module dsh-atn/mailbox
 */
import { allocateId, LimitExceededError, NetworkStoreError, pendingMailFor } from './domain.ts'
import type { MailId, MailKind, MailRecord, NetworkRecord, NodeId } from './schema.ts'
import { utf8Bytes } from './config.ts'

/** Input for enqueueing one mail. */
export interface EnqueueInput {
  /** Real sender, resolved from the calling agent. */
  readonly fromId: NodeId
  /** Intended recipient. */
  readonly toId: NodeId
  /** Mail kind. */
  readonly kind: MailKind
  /** Related task, when this mail carries or settles work. */
  readonly taskId: string | null
  /** Related proposal, when this mail concerns document review. */
  readonly proposalId: string | null
  /** Body text. */
  readonly body: string
  /** Enqueue timestamp (epoch ms). */
  readonly now: number
  /** Stable id chosen by the caller; falls back to the network counter. */
  readonly id?: MailId
}

/** Result of a durable enqueue. */
export interface EnqueueResult {
  /** Network record with the mail committed. */
  readonly record: NetworkRecord
  /** Identifier of the committed mail; a duplicate id returns the existing record unchanged. */
  readonly mailId: MailId
  /** `true` when the id already existed, so no second row was written. */
  readonly duplicate: boolean
}

/**
 * Compute the envelope-inclusive size of a mail body.
 *
 * @param mail - Envelope fields that travel with the body.
 * @returns UTF-8 byte length of the envelope and body together.
 */
export function mailBytes(mail: Pick<EnqueueInput, 'fromId' | 'toId' | 'kind' | 'taskId' | 'proposalId' | 'body'>): number {
  const envelope = [mail.fromId, mail.toId, mail.kind, mail.taskId ?? '', mail.proposalId ?? ''].join('\u0000')
  return utf8Bytes(envelope) + utf8Bytes(mail.body)
}

/** Raised when a caller reuses a stable mail id for a different message. */
export class MailIdentityError extends NetworkStoreError {
  /**
   * @param message - Human-readable detail naming the reused id.
   */
  constructor(message: string) {
    super('exists', message)
    this.name = 'MailIdentityError'
  }
}

/**
 * Whether an existing mail row is the same business message a retry describes.
 *
 * Sender, recipient and content must all agree; a reused stable id for a
 * different message is a caller bug, not an idempotent retry.
 *
 * @param mail - Existing stored row.
 * @param input - Retry envelope.
 * @returns True when the row is exactly the message being retried.
 */
export function mailMatches(mail: MailRecord, input: EnqueueInput): boolean {
  return (
    mail.fromId === input.fromId &&
    mail.toId === input.toId &&
    mail.kind === input.kind &&
    mail.taskId === input.taskId &&
    mail.proposalId === input.proposalId &&
    mail.body === input.body
  )
}

/**
 * Persist one mail row before any delivery is attempted.
 *
 * A caller-supplied stable id makes the write idempotent: the identical
 * message returns the existing row, while a different message under the same id
 * is refused instead of silently overwriting the mailbox.
 *
 * @param record - Current network record.
 * @param input - Envelope and body to enqueue.
 * @returns The updated record and the mail id.
 * @throws MailIdentityError when the stable id already names a different message.
 * @throws LimitExceededError when the message, per-node pending or retention bound is hit.
 */
export function enqueueMail(record: NetworkRecord, input: EnqueueInput): EnqueueResult {
  if (input.id !== undefined) {
    const existing = record.mails[input.id]
    if (existing !== undefined) {
      if (!mailMatches(existing, input)) {
        throw new MailIdentityError(
          `mail ${input.id} already exists from ${existing.fromId} to ${existing.toId} as ${existing.kind}; a stable id cannot be reused for a different message`,
        )
      }
      return { record, mailId: input.id, duplicate: true }
    }
  }
  const limits = record.limits
  if (mailBytes(input) > limits.maxMessageBytes) {
    throw new LimitExceededError(
      'maxMessageBytes',
      `mail from ${input.fromId} to ${input.toId} is ${mailBytes(input)} bytes, above the ${limits.maxMessageBytes} byte bound`,
    )
  }
  if (pendingMailFor(record, input.fromId) >= limits.maxPendingMailPerNode) {
    throw new LimitExceededError(
      'maxPendingMailPerNode',
      `node ${input.fromId} already has ${limits.maxPendingMailPerNode} undelivered mails`,
    )
  }
  if (Object.keys(record.mails).length >= limits.maxRetainedMail) {
    throw new LimitExceededError('maxRetainedMail', `network ${record.id} retains ${limits.maxRetainedMail} mail records`)
  }

  let allocated = input.id === undefined ? allocateId(record, 'mail') : { id: input.id, next: record }
  while (input.id === undefined && Object.hasOwn(allocated.next.mails, allocated.id)) {
    allocated = allocateId(allocated.next, 'mail')
  }
  const mailId = allocated.id
  const mails = {
    ...allocated.next.mails,
    [mailId]: {
      id: mailId,
      fromId: input.fromId,
      toId: input.toId,
      kind: input.kind,
      taskId: input.taskId,
      proposalId: input.proposalId,
      body: input.body,
      status: 'queued' as const,
      enqueuedAt: input.now,
      settledAt: null,
      note: null,
    },
  }
  return { record: { ...allocated.next, mails }, mailId, duplicate: false }
}

/**
 * Mark a queued mail as present in the target's persisted input.
 *
 * @param record - Current network record.
 * @param mailId - Mail to confirm.
 * @param now - Confirmation timestamp (epoch ms).
 * @returns The updated record; a mail that is missing or no longer queued is returned unchanged.
 */
export function markDelivered(record: NetworkRecord, mailId: MailId, now: number): NetworkRecord {
  const mail = record.mails[mailId]
  if (mail === undefined || mail.status !== 'queued') return record
  return {
    ...record,
    mails: { ...record.mails, [mailId]: { ...mail, status: 'delivered', settledAt: now, note: null } },
  }
}

/**
 * Mark a queued mail as permanently undeliverable, keeping the record so the
 * real producer and the original recipient stay readable.
 *
 * @param record - Current network record.
 * @param mailId - Mail that cannot be delivered.
 * @param note - Why delivery is impossible.
 * @param now - Settlement timestamp (epoch ms).
 * @returns The updated record; a mail that is missing or no longer queued is returned unchanged.
 */
export function markUndeliverable(record: NetworkRecord, mailId: MailId, note: string, now: number): NetworkRecord {
  const mail = record.mails[mailId]
  if (mail === undefined || mail.status !== 'queued') return record
  return {
    ...record,
    mails: { ...record.mails, [mailId]: { ...mail, status: 'undeliverable', settledAt: now, note } },
  }
}

/**
 * List mails that must be replayed after a restart: everything still queued.
 *
 * @param record - Current network record.
 * @returns Queued mails in enqueue order.
 */
export function pendingMails(record: NetworkRecord): NetworkRecord['mails'][string][] {
  return Object.values(record.mails)
    .filter((mail) => mail.status === 'queued')
    .sort((left, right) => left.enqueuedAt - right.enqueuedAt || left.id.localeCompare(right.id))
}

/**
 * List the mails one node still owes delivery for.
 *
 * @param record - Current network record.
 * @param nodeId - Recipient node.
 * @returns Queued mails addressed to that node, in enqueue order.
 */
export function inboxOf(record: NetworkRecord, nodeId: NodeId): NetworkRecord['mails'][string][] {
  return pendingMails(record).filter((mail) => mail.toId === nodeId)
}
