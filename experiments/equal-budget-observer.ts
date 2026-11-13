/** Read-only experiment hooks; never add model instructions or alter an ATN mutation. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-team'
import type {} from '@deepseek-ai/dsh-subagent'
import { NATIVE_TEAM_PROTOCOL } from './native-team-runtime.ts'
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
  const nativeCalls = new Map<symbol, Publication>()
  const nativePublications = new Map<string, Publication>()
  const nativeReceipts = new Map<string, { from: string; to: string; seq: number; content: string }>()
  const nativeOutputs = new Map<string, Publication>()
  const nativeDelivered = new Set<string>()
  let ignoredLegacyTeamEvents = 0
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
  const deliverNativeRelay = (id: string) => {
    const publication = nativePublications.get(id), receipt = nativeReceipts.get(id)
    if (!publication || !receipt) return
    if (publication.from !== receipt.from || !receipt.content.includes(publication.content)) {
      errors.push('native-publication-receipt-mismatch'); return
    }
    events.push({ kind: 'transport', seq: receipt.seq, sentSeq: publication.sentSeq, from: receipt.from,
      to: receipt.to, transport: 'native', content: receipt.content, delivered: true })
    nativeReceipts.delete(id); nativePublications.delete(id)
  }
  // Capture before official dispatch, then correlate with the exact accepted
  // inbox identity. A tool success alone is never a delivered-content witness.
  const removeNativeCall = ctx.on('tools/pre-execute', (execution, nextStep) => {
    observe(() => {
      const args = execution.arguments
      if (execution.name === 'send_message' && execution.agent && args && typeof args === 'object'
        && 'message' in args && typeof args.message === 'string') {
        nativeCalls.set(execution.token, { from: alias(execution.agent.id), sentSeq: next(), content: args.message })
      }
    })
    return nextStep()
  }, { global: true })
  const removeNativeResult = ctx.on('tools/result', (execution, result) => {
    observe(() => {
      const publication = nativeCalls.get(execution.token)
      nativeCalls.delete(execution.token)
      if (!publication || result.isError) return
      const value = result.value
      if (!value || typeof value !== 'object' || !('messageId' in value) || typeof value.messageId !== 'string') {
        errors.push('native-message-identity-missing'); return
      }
      nativePublications.set(value.messageId, publication)
      deliverNativeRelay(value.messageId)
    })
    return undefined
  }, { global: true })
  const removeNetwork = ctx.on('atn/network-updated', ({ record }) => observe(() => observeNetwork(record)), { global: true })
  const removeSession = ctx.on('session/event', (session, event) => observe(() => {
    if (event.type === 'assistant/message') {
      const content = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
      if (content) nativeOutputs.set(session.id, { from: alias(session.id), sentSeq: next(), content })
    } else if (event.type === 'user/message' && (event.data.source.kind === 'agent-message'
      || event.data.source.kind === 'subagent-settled')) {
      const id = event.data.id
      if (nativeDelivered.has(id)) return
      nativeDelivered.add(id)
      const from = alias(event.data.source.senderSessionId)
      const content = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
      const receipt = { from, to: alias(session.id), seq: next(), content }
      if (event.data.source.kind === 'agent-message') {
        nativeReceipts.set(id, receipt)
        deliverNativeRelay(id)
      } else {
        // The actual notice, not subagent/end output, proves receipt. Closing
        // text is sometimes deliberately suppressed after a send_message.
        const output = nativeOutputs.get(event.data.source.senderSessionId)
        events.push({ kind: 'transport', ...receipt, transport: 'native', delivered: true,
          ...(output && content.includes(output.content) ? { sentSeq: output.sentSeq } : {}) })
      }
    } else if (event.type === 'team/message/queued' || event.type === 'team/message/delivered'
      || event.type === 'team/member') {
      ignoredLegacyTeamEvents++
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
      const observedEvents: EqualBudgetFactEvent[] = [...events, ...[...nativeReceipts.values()].map(receipt => ({
        kind: 'transport' as const, ...receipt, transport: 'native' as const, delivered: true,
      }))].sort((a, b) => a.seq - b.seq)
      const audit = auditEqualBudgetFactFlow({ documents: task.documents, facts, events: observedEvents, submission: submitted })
      const observerErrors = [...new Set([...errors, ...(nativeReceipts.size ? ['unobserved-native-publication-boundary'] : [])])]
      return { nativeProtocolVersion: NATIVE_TEAM_PROTOCOL, audit: { ...audit, observerErrors,
        passed: audit.passed && observerErrors.length === 0,
        positiveCompletionEvidence: audit.positiveCompletionEvidence && observerErrors.length === 0 },
        events: structuredClone(observedEvents), submission: submitted, facts,
        coverage: { forwardingAllowed: true, oracleValuesUsed: false, aclInference: false, ignoredLegacyTeamEvents,
          nativeAcceptedSendsWithoutRecordedReceipt: nativePublications.size,
          sources: ['successful-document-reads', 'delivered-atn-mail', 'recorded-agent-relay-with-exact-send-identity',
            'recorded-subagent-settlement-with-observed-closing-text', 'independent-candidate-input', 'successful-atn-status-task-result'],
          limitation: 'Unstructured prose, shared task-board content, initial delegation prompts, fork history and ATN peer-summary or assignment-context transfers are not reconstructed. A settlement notice with suppressed or unobserved closing text has no source publication witness. Legacy Team mailbox events are excluded from current live fact paths. Missing witnesses remain audit gaps.' } }
    },
    dispose() {
      removeNetwork(); removeSession(); removeNativeCall(); removeNativeResult()
      if (atn && originalStatus) atn.status = originalStatus
      networks.clear(); nativeCalls.clear(); nativePublications.clear(); nativeReceipts.clear(); nativeOutputs.clear()
    },
  }
}
