/**
 * Model-visible ATN context.
 *
 * Every ATN contribution to a model request is a `user` message carrying an
 * explicit ATN source, so the session log can be replayed to recover exactly
 * which goal revision, task or mail the model saw. There is no generic
 * `source.kind = plugin` in the Harness, so the kind is declared here.
 * @module dsh-atn/messages
 */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { GoalRevision, MailRecord, ProposalRecord, TaskRecord } from './schema.ts'
import { renderGoal } from './domain.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Context contributed by the ATN runtime: goal snapshots, task assignments, mail and review requests. */
    atn: { kind: 'atn' } & import('@deepseek-ai/dsh-llm').ContextFormed
  }
}

function textMessage(text: string, sections: { name: string; text: string }[]): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'atn', form: 'snapshot', sections },
  })
}

/**
 * Build the goal snapshot a node reads when it is created or when the committed
 * version changes.
 *
 * @param revision - Committed revision that is being delivered.
 * @param networkId - Network the revision belongs to.
 * @returns A logged, replayable user message.
 */
export function goalSnapshotMessage(revision: GoalRevision, networkId: string): UserMessage {
  const body = renderGoal(revision.document)
  const text = [
    `[ATN shared goal] network=${networkId} version=${revision.version}`,
    body,
    'This document is shared by every node. Changes need the unanimous consent of the frozen approver list.',
  ].join('\n')
  return textMessage(text, [{ name: 'atn/goal', text }])
}

/**
 * Build the assignment delivered with a new local task.
 *
 * @param task - Task being assigned.
 * @param networkId - Network the task belongs to.
 * @param goalVersion - Goal version current at assignment time.
 * @returns A logged, replayable user message.
 */
export function taskMessage(task: TaskRecord, networkId: string, goalVersion: number): UserMessage {
  const text = [
    `[ATN task] network=${networkId} task=${task.id} goalVersion=${goalVersion} requester=${task.requesterId}`,
    task.description,
    task.context.length > 0 ? `Context: ${task.context}` : '',
    `Settle it with atn_send kind=result taskId=${task.id} and concrete evidence.`,
  ]
    .filter((line) => line.length > 0)
    .join('\n')
  return textMessage(text, [{ name: 'atn/task', text }])
}

/**
 * Build the notice delivered for one ordinary mail.
 *
 * @param mail - Mail being delivered.
 * @param networkId - Network the mail belongs to.
 * @returns A logged, replayable user message.
 */
export function mailMessage(mail: MailRecord, networkId: string): UserMessage {
  const header = [
    `[ATN ${mail.kind}] network=${networkId} mail=${mail.id} from=${mail.fromId}`,
    mail.taskId === null ? '' : `task=${mail.taskId}`,
    mail.proposalId === null ? '' : `proposal=${mail.proposalId}`,
  ]
    .filter((part) => part.length > 0)
    .join(' ')
  const text = `${header}\n${mail.body}`
  return textMessage(text, [{ name: 'atn/mail', text }])
}

/**
 * Build the review request delivered when a proposal is opened.
 *
 * @param proposal - Proposal needing this voter's decision.
 * @param networkId - Network the proposal belongs to.
 * @returns A logged, replayable user message.
 */
export function proposalMessage(proposal: ProposalRecord, networkId: string): UserMessage {
  const text = [
    `[ATN proposal] network=${networkId} proposal=${proposal.id} proposer=${proposal.proposerId} baseVersion=${proposal.baseVersion}`,
    proposal.rationale.length > 0 ? `Rationale: ${proposal.rationale}` : '',
    renderGoal(proposal.document),
    `Decide explicitly with atn_vote proposalId=${proposal.id} approve=true|false. Silence is not consent, and the proposal expires at ${new Date(proposal.deadlineAt).toISOString()}.`,
  ]
    .filter((line) => line.length > 0)
    .join('\n')
  return textMessage(text, [{ name: 'atn/proposal', text }])
}
