/** A fixed final-answer extraction rule; deliberately independent of task schemas and the oracle. */
import { lastAssistantStreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session'
import type { AtnRuntime, DeliverInput } from '../src/runtime.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Successful ATN delivery is itself a submission; no post-completion tool is required. */
export function installAtnSubmissionBridge(runtime: AtnRuntime, validate: (input: DeliverInput) => void,
  submitted: (answer: string, agent: Agent) => void): void {
  const deliver = runtime.deliver.bind(runtime)
  runtime.deliver = async (agent, input) => {
    validate(input)
    const result = await deliver(agent, input)
    if (result.accepted) submitted(input.summary, agent)
    return result
  }
}

/** Public Session facts needed for extraction; full live Session events are accepted directly. */
export type SubmissionEvent = {
  [T in SessionEventType]: Pick<SessionEvent<T>, 'seq' | 'type' | 'data'>
}[SessionEventType]

export interface FinalTextOptions {
  /** Last Session sequence observed before this experiment's input was submitted. */
  afterSeq: number
  maxBytes?: number
}
export type FinalTextRejection = 'no-current-turn' | 'turn-not-completed' | 'no-final-step' | 'step-not-completed'
  | 'no-final-message' | 'interrupted-message' | 'stream-not-stopped' | 'non-text-content' | 'empty-text' | 'answer-too-large'
export type FinalTextSubmission = {
  accepted: true
  answer: string
  turn: number
  step: number
  messageSeq: number
  rule: 'latest-completed-turn-final-step-visible-text-v1'
} | { accepted: false; reason: FinalTextRejection }

/**
 * Examine only the newest turn started after the experiment boundary, and only
 * its final step. Never fall back to a previous answer or inspect correctness.
 * Reasoning blocks are discarded; tool calls and other non-text payloads refuse
 * submission. Text blocks retain order and are separated by one newline.
 */
export function extractFinalTextSubmission(events: readonly SubmissionEvent[], options: FinalTextOptions): FinalTextSubmission {
  const maxBytes = options.maxBytes ?? 16_384
  if (!Number.isSafeInteger(options.afterSeq) || options.afterSeq < -1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('Extraction needs a valid experiment sequence boundary and a positive byte limit')
  }
  const reject = (reason: FinalTextRejection): FinalTextSubmission => ({ accepted: false, reason })
  const current = events.filter(event => event.seq > options.afterSeq)
  const start = current.findLast(event => event.type === 'turn/start')
  if (start?.type !== 'turn/start') return reject('no-current-turn')
  const turn = start.data.turn
  const turnEvents = current.filter(event => event.seq >= start.seq)
  const end = turnEvents.findLast(event => event.type === 'turn/end')
  if (end?.type !== 'turn/end' || end.data.turn !== turn || end.data.reason.kind !== 'completed') return reject('turn-not-completed')
  const withinTurn = turnEvents.filter(event => event.seq < end.seq)
  const stepStart = withinTurn.findLast(event => event.type === 'step/start')
  if (stepStart?.type !== 'step/start' || stepStart.data.turn !== turn) return reject('no-final-step')
  const step = stepStart.data.step
  const withinStep = withinTurn.filter(event => event.seq > stepStart.seq)
  const stepEnd = withinStep.findLast(event => event.type === 'step/end')
  if (stepEnd?.type !== 'step/end' || stepEnd.data.turn !== turn || stepEnd.data.step !== step) return reject('step-not-completed')
  const settlement = withinStep.filter(event => event.seq < stepEnd.seq)
    .findLast(event => event.type === 'assistant/message' || event.type === 'assistant/attempt')
  if (settlement?.type !== 'assistant/message' || settlement.data.turn !== turn || settlement.data.step !== step) return reject('no-final-message')
  if (settlement.data.interrupted) return reject('interrupted-message')
  const finish = lastAssistantStreamChunk(settlement.data.stream, 'finish')
  if (finish?.reason.kind !== 'stop') return reject('stream-not-stopped')
  const content = settlement.data.message.content
  if (content.some(block => block.type !== 'text' && block.type !== 'reasoning')) return reject('non-text-content')
  const answer = content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  if (!answer.trim()) return reject('empty-text')
  if (Buffer.byteLength(answer, 'utf8') > maxBytes) return reject('answer-too-large')
  return { accepted: true, answer, turn, step, messageSeq: settlement.seq, rule: 'latest-completed-turn-final-step-visible-text-v1' }
}
