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
import type { GoalDocument, GoalRevision, MailRecord, ProposalRecord, TaskRecord } from './schema.ts'
import { renderGoal } from './domain.ts'
import { PROTECTED_GOAL_FIELDS } from './governance.ts'

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
 * @param startup - Initial contract; required by the runtime to restore the
 * baseline when a pre-upgrade revision changed protected fields.
 * @returns A logged, replayable user message.
 */
export function goalSnapshotMessage(revision: GoalRevision, networkId: string, startup: GoalDocument = revision.document): UserMessage {
  const legacyContractChanged = PROTECTED_GOAL_FIELDS.some(field => revision.document[field] !== startup[field])
  const body = renderGoal(legacyContractChanged ? {
    ...revision.document,
    objective: startup.objective,
    successCriteria: startup.successCriteria,
    constraints: startup.constraints,
  } : revision.document)
  const text = [
    // This distinct marker supplements already logged legacy snapshots of the
    // same revision. Unchanged contracts retain the existing marker and create
    // no extra upgrade message. History and revision numbers are not rewritten.
    `[ATN shared goal] network=${networkId} version=${revision.version}${legacyContractChanged ? ' contract=initial' : ''}`,
    ...(legacyContractChanged ? ['This legacy revision changed protected fields. The original startup contract below is authoritative; the historical revision remains recorded. Its collaboration plan, if any, must obey this contract.'] : []),
    body,
    'The startup objective, success criteria and constraints are fixed. The host manages shared plan revisions.',
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
    `[ATN task] network=${networkId} task=${task.id} goalVersion=${goalVersion} holder=${task.holderId} requester=${task.requesterId}`,
    `You are node ${task.holderId}. Choose collaborators with atn_status and adjust your links with atn_rewire when useful.`,
    task.description,
    task.context.length > 0 ? `Context: ${task.context}` : '',
    (task.dependsOn?.length ?? 0) > 0 ? `Upstream submissions (check acceptance separately): ${task.dependsOn!.join(', ')}. Read results with atn_status.` : '',
    task.retryOf ? `Retry of: ${task.retryOf}. Previous attempt and evidence remain available with atn_status.` : '',
    `Settle it with atn_send to=${task.requesterId} kind=result taskId=${task.id} outcome=completed|failed and concrete evidence, even if your links change. Use outcome=failed when the work fails; describing failure in the body alone does not set the outcome.`,
    'completed records your submission; only independent host acceptance makes it a verified result. Inspect acceptance with atn_status.',
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
 * @param outcome - Durable task outcome for a result mail, including replayed results.
 * @param result - Durable conclusion and evidence belonging to the settled task.
 * @returns A logged, replayable user message.
 */
export function mailMessage(mail: MailRecord, networkId: string, outcome?: 'completed' | 'failed', result?: TaskRecord['result'], task?: TaskRecord): UserMessage {
  const header = [
    `[ATN ${mail.kind}] network=${networkId} mail=${mail.id} from=${mail.fromId}`,
    mail.taskId === null ? '' : `task=${mail.taskId}`,
    mail.proposalId === null ? '' : `proposal=${mail.proposalId}`,
  ]
    .filter((part) => part.length > 0)
    .join(' ')
  // Keep the first-line delivery marker stable for mail accepted before outcome
  // labels existed; recovery must not redeliver an already accepted result.
  const outcomeLine = mail.kind === 'result' && outcome !== undefined ? `Outcome: ${outcome}\n` : ''
  const resultLines = mail.kind === 'result' && result != null
    ? `\nSummary: ${result.summary}\nEvidence:\n${result.evidence.length === 0 ? '(none supplied)' : result.evidence.map(reference => `- ${reference}`).join('\n')}`
    : ''
  const verificationLine = mail.kind === 'result' ? '\nSubmission is not host acceptance. Inspect the task with atn_status before using it as a verified dependency.' : ''
  const taskReferences = mail.kind === 'task' ? [
    (task?.dependsOn?.length ?? 0) > 0 ? `\nUpstream submissions (check acceptance separately): ${task!.dependsOn!.join(', ')}. Read upstream results with atn_status.` : '',
    task?.retryOf ? `\nRetry of: ${task.retryOf}. Previous attempt remains available with atn_status.` : '',
  ].join('') : ''
  const text = `${header}\n${outcomeLine}${mail.body}${resultLines}${verificationLine}${taskReferences}`
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
    `This host-managed proposal requires an explicit decision recorded through ctx.atn.vote for proposalId=${proposal.id}. Silence is not consent, and the proposal expires at ${new Date(proposal.deadlineAt).toISOString()}.`,
  ]
    .filter((line) => line.length > 0)
    .join('\n')
  return textMessage(text, [{ name: 'atn/proposal', text }])
}
