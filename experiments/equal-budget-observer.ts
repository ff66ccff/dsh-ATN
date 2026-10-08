/** Read-only experiment hooks; never add model instructions or alter an ATN mutation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-agent-team'
import type {} from '../src/observer.ts'
import type {} from '../src/runtime.ts'
import type { NetworkRecord } from '../src/schema.ts'
import type { EqualBudgetTask } from './equal-budget-task.ts'
import { auditEqualBudgetFactFlow, buildEqualBudgetAuditFacts, type EqualBudgetFactEvent,
  type EqualBudgetSubmission } from './equal-budget-audit.ts'

interface Publication { from: string; sentSeq: number; content: string }

export function installEqualBudgetObserver(ctx: Context, task: EqualBudgetTask, alias: (session: string) => string) {
  const events: EqualBudgetFactEvent[] = []
  const errors: string[] = []
  const mails = new Map<string, Publication>()
  const delivered = new Set<string>()
  const taskResults = new Map<string, Publication>()
  const networks = new Map<string, NetworkRecord>()
  const sessionNetworks = new Map<string, string>()
  let seq = 0, submission: EqualBudgetSubmission | null = null
  const next = () => seq++
  const observe = (operation: () => void) => {
    try { operation() } catch { errors.push('observer-hook-error') }
  }
  const transport = (publication: Publication | undefined, to: string, kind: 'atn' | 'native' | 'independent', content?: string) => {
    if (!publication) { errors.push('unobserved-publication-boundary'); return }
    events.push({ kind: 'transport', seq: next(), sentSeq: publication.sentSeq, from: publication.from,
      to: alias(to), transport: kind, content: content ?? publication.content, delivered: true })
  }
  const observeNetwork = (record: NetworkRecord) => {
    networks.set(record.id, record)
    for (const node of Object.values(record.nodes)) sessionNetworks.set(node.sessionId, record.id)
    for (const mail of Object.values(record.mails)) {
      const key = `atn:${record.id}:${mail.id}`
      if (!mails.has(key)) {
        const sender = record.nodes[mail.fromId]?.sessionId
        const result = mail.kind === 'result' && mail.taskId ? record.tasks[mail.taskId]?.result : null
        if (sender && mail.status === 'queued') mails.set(key, { from: alias(sender), sentSeq: next(),
          content: mail.body + (result ? `\nSummary: ${result.summary}\nEvidence:\n${result.evidence.join('\n')}` : '') })
      }
      if (mail.status === 'delivered' && !delivered.has(key)) {
        delivered.add(key)
        const recipient = record.nodes[mail.toId]?.sessionId
        if (recipient) transport(mails.get(key), recipient, 'atn')
        else errors.push('unidentified-atn-mail-recipient')
      }
    }
    for (const item of Object.values(record.tasks)) {
      if (!item.result) continue
      const key = `${record.id}:${item.id}:${JSON.stringify(item.result)}`
      const sender = record.nodes[item.settledBy ?? item.holderId]?.sessionId
      if (sender && !taskResults.has(key)) taskResults.set(key, { from: alias(sender), sentSeq: next(), content: JSON.stringify(item.result) })
    }
  }
  const removeNetwork = ctx.on('atn/network-updated', ({ record }) => observe(() => observeNetwork(record)), { global: true })
  const removeSession = ctx.on('session/event', (_session, event) => observe(() => {
    if (event.type === 'team/message/queued') {
      const { message, teamId } = event.data
      const key = `native:${teamId}:${message.id}`
      if (!mails.has(key)) mails.set(key, { from: alias(message.senderId), sentSeq: next(),
        content: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') })
    } else if (event.type === 'team/message/delivered') {
      const key = `native:${event.data.teamId}:${event.data.messageId}`
      if (!delivered.has(key)) {
        delivered.add(key)
        transport(mails.get(key), event.data.targetId, 'native')
      }
    }
  }), { global: true })
  const atn = ctx.get('atn')
  const originalStatus = atn?.status
  if (atn && originalStatus) {
    // status() internally validates via tasks() before finishing; only its
    // successful, actually returned records are model-visible reads.
    atn.status = async (agent, input) => {
      const result = await originalStatus.call(atn, agent, input)
      observe(() => {
        const network = sessionNetworks.get(agent.id)
        for (const item of result.tasks) if (item.result) {
          transport(taskResults.get(`${network}:${item.id}:${JSON.stringify(item.result)}`), agent.id, 'atn', JSON.stringify(item.result))
        }
      })
      return result
    }
  }
  return {
    recordRead(session: string, documentId: string) {
      observe(() => events.push({ kind: 'read', seq: next(), agent: alias(session), documentId }))
    },
    recordSubmission(session: string, answer: string) {
      observe(() => {
        if (submission) { errors.push('multiple-submission-boundaries'); return }
        submission = { seq: next(), agent: alias(session), answer }
      })
    },
    recordIndependent(fromSession: string, toSession: string, content: string) {
      observe(() => transport({ from: alias(fromSession), sentSeq: next(), content }, toSession, 'independent'))
    },
    finish(answer: string | null | undefined, submitterSession?: string) {
      if (!submission && answer !== undefined && answer !== null && submitterSession) {
        submission = { seq: next(), agent: alias(submitterSession), answer }
        errors.push('submission-boundary-inferred-at-finish')
      }
      const submitted = submission as EqualBudgetSubmission | null
      if (submitted && answer !== undefined && answer !== null && submitted.answer !== answer) errors.push('submission-answer-mismatch')
      const facts = buildEqualBudgetAuditFacts(task, submitted?.answer ?? '')
      const audit = auditEqualBudgetFactFlow({ documents: task.documents, facts, events, submission: submitted })
      const observerErrors = [...new Set(errors)]
      return { audit: { ...audit, observerErrors,
        passed: audit.passed && observerErrors.length === 0,
        positiveCompletionEvidence: audit.positiveCompletionEvidence && observerErrors.length === 0 },
        events: structuredClone(events), submission: submitted, facts,
        coverage: { forwardingAllowed: true, oracleValuesUsed: false, aclInference: false,
          sources: ['successful-document-reads', 'delivered-atn-mail', 'delivered-native-mail', 'independent-candidate-input', 'successful-atn-status-task-result'],
          limitation: 'Unstructured prose, native shared task/fork context and ATN peer-summary or assignment-context transfers are not reconstructed. Missing witnesses remain audit gaps.' } }
    },
    dispose() {
      removeNetwork(); removeSession()
      if (atn && originalStatus) atn.status = originalStatus
      networks.clear()
    },
  }
}
