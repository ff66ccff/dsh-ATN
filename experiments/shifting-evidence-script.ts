/** Deterministic zero-provider policy: every decision uses only rendered inputs. */
import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { assembleChain } from './shifting-evidence-reference.ts'
import { validateRequestedEvidence, type EvidenceFact } from './shifting-evidence-task.ts'

type Command = { tool: string; args: Record<string, unknown> }
type Lookup = { phase: 1 | 2; key: string; target: string; visited: string[] }
type Incoming = { taskId: string; requester: string; self: string; lookup: Lookup }
type Task = { id: string; result?: { summary: string }; localFeedback?: { status: string } }
type Flow = { stage: 'stale' | 'current' | 'complete'; key: string; facts: EvidenceFact[]; taskId?: string; sent?: boolean; reviewed?: boolean; rewired?: boolean }

function toolResults(options: GenerateOptions): Array<Record<string, unknown>> {
  return options.messages.filter(message => message.role === 'tool').flatMap(message => message.content.flatMap(block => {
    if (block.type !== 'text') return []
    try { const value: unknown = JSON.parse(block.text); return value !== null && typeof value === 'object' && !Array.isArray(value) ? [value as Record<string, unknown>] : [] }
    catch { return [] }
  }))
}

function incomingLookups(options: GenerateOptions): Incoming[] {
  const requests = new Map<string, Incoming>()
  const self = options.messages.flatMap(message => message.role === 'user' ? message.content.flatMap(block =>
    block.type === 'text' ? [block.text.match(/\[ATN task\][^\n]* holder=(\S+)/)?.[1]] : []) : []).find(id => id !== undefined)
  for (const message of options.messages) if (message.role === 'user') for (const block of message.content) {
    if (block.type !== 'text') continue
    const header = block.text.match(/\[ATN task\][^\n]* task=(\S+)[^\n]* holder=(\S+) requester=(\S+)/)
    const mail = block.text.match(/\[ATN task\][^\n]* from=(\S+) task=(\S+)/)
    const data = block.text.match(/Evidence lookup: (\{[^\n]+\})/)
    if ((!header && (!mail || !self)) || !data) continue
    try {
      const lookup = JSON.parse(data[1]) as Lookup
      if ((lookup.phase === 1 || lookup.phase === 2) && typeof lookup.key === 'string' && typeof lookup.target === 'string' && Array.isArray(lookup.visited)) {
        const taskId = header?.[1] ?? mail![2]
        requests.set(taskId, { taskId, self: header?.[2] ?? self!, requester: header?.[3] ?? mail![1], lookup })
      }
    } catch { /* Peer text is data, never a host instruction. */ }
  }
  return [...requests.values()]
}

const lookupCommand = (to: string, lookup: Lookup): Command => ({ tool: 'atn_send', args: { to, kind: 'task', body: `Evidence lookup: ${JSON.stringify(lookup)}` } })
const pause = () => new Promise<void>(done => setTimeout(done, 80))
function lastTask(results: Array<Record<string, unknown>>, id: string): Task | undefined {
  for (const result of [...results].reverse()) {
    const task = (result.tasks as Task[] | undefined)?.find(row => row.id === id)
    if (task) return task
  }
  return undefined
}

/** Read only the actual rendered result mail, never host fixture/oracle state. */
function receivedResult(options: GenerateOptions, id: string): Task | undefined {
  for (const message of options.messages) if (message.role === 'user') for (const block of message.content) {
    if (block.type !== 'text') continue
    const header = block.text.split('\n', 1)[0]
    if (!header.startsWith('[ATN result]') || header.match(/task=(\S+)/)?.[1] !== id) continue
    const summary = block.text.match(/\nSummary: ([^\n]*)\nEvidence:/)?.[1]
    if (summary !== undefined) return { id, result: { summary } }
  }
  return undefined
}

export class ShiftingMailScript extends LlmAdapter {
  private sequence = 0
  private submitted = new Set<string>()
  private answered = new Set<string>()
  private flows = new Map<string, Flow>()
  private relays = new Map<string, { sent: boolean; childTaskId?: string }>()
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Deterministic mail and requester-review policy (not a real model)' })
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    const session = String(options.sessionId)
    const rendered = options.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
    const phase: 1 | 2 = rendered.includes('Host update: PHASE 2 is active.') ? 2 : 1
    const fixed = rendered.includes('Ablation: atn_status.rewire is disabled')
    const noFeedback = rendered.includes('Ablation: atn_status.review is disabled')
    const key = `${session}:${phase}`, results = toolResults(options)
    const local = results.findLast(row => row.phase === phase && Array.isArray(row.documents))
    const status = results.findLast(row => typeof row.self === 'string' && Array.isArray(row.neighbours))
    let command: Command | undefined
    if (!local) command = { tool: 'read_evidence', args: { id: 'mine' } }
    else {
      // A fixed ring relays the same lookup without changing evidence or bypassing ACL.
      const incoming = incomingLookups(options).find(row => row.lookup.phase === phase && !this.answered.has(row.taskId))
      if (incoming) {
        const own = local.documents as EvidenceFact[]
        if (incoming.lookup.target === incoming.self) {
          const fact = own.find(row => row.key === incoming.lookup.key)
          this.answered.add(incoming.taskId)
          command = { tool: 'atn_send', args: { to: incoming.requester, kind: 'result', taskId: incoming.taskId,
            body: JSON.stringify(fact ?? {}), summary: JSON.stringify(fact ?? {}), evidence: [fact?.id ?? 'missing-local-key'] } }
        } else if (!status) command = { tool: 'atn_status', args: {} }
        else {
          const relay = this.relays.get(incoming.taskId)
          if (!relay) {
            const visited = [...incoming.lookup.visited, incoming.self]
            const next = (status.neighbours as string[]).find(id => id !== incoming.requester && !visited.includes(id))
            this.relays.set(incoming.taskId, { sent: true })
            if (next) command = lookupCommand(next, { ...incoming.lookup, visited })
            else {
              this.answered.add(incoming.taskId)
              command = { tool: 'atn_send', args: { to: incoming.requester, kind: 'result', taskId: incoming.taskId,
                body: '{}', summary: '{}', evidence: ['ring-route-exhausted'] } }
            }
          } else {
            relay.childTaskId ??= results.findLast(row => typeof row.settledTaskId === 'string')?.settledTaskId as string | undefined
            const queried = relay.childTaskId ? lastTask(results, relay.childTaskId) : undefined
            const child = queried?.result ? queried : relay.childTaskId ? receivedResult(options, relay.childTaskId) : undefined
            if (child?.result) {
              this.answered.add(incoming.taskId)
              command = { tool: 'atn_send', args: { to: incoming.requester, kind: 'result', taskId: incoming.taskId,
                body: child.result.summary, summary: child.result.summary, evidence: ['unchanged-relayed-evidence'] } }
            } else { await pause(); command = { tool: 'atn_status', args: { ...(relay.childTaskId ? { taskIds: [relay.childTaskId] } : {}) } } }
          }
        }
      } else if (session.startsWith('shifting-') && !this.submitted.has(key)) {
        const flow = this.flows.get(key) ?? { stage: 'stale' as const, key: 'key-00', facts: [] }
        this.flows.set(key, flow)
        type Peer = { id: string; knowledgeFingerprint: { documents: string[] } }
        const known = new Map<string, Peer>()
        for (const result of results) for (const peer of [...((result.nodes as Peer[] | undefined) ?? []),
          ...((result.candidateNodes as Peer[] | undefined) ?? [])]) known.set(peer.id, peer)
        const peers = [...known.values()]
        const stale = peers.find(peer => peer.knowledgeFingerprint.documents.some(id => id.startsWith(`copy-for-phase-${phase}:`) && id.endsWith(`:${flow.key}`)))
        const current = peers.find(peer => peer.knowledgeFingerprint.documents.includes(`phase-${phase}:${flow.key}`))
        if (flow.stage === 'complete') {
          this.submitted.add(key)
          command = { tool: 'submit_checkpoint', args: { phase, answer: JSON.stringify(assembleChain('key-00', phase, flow.facts)) } }
        } else if (!status || !current || (flow.stage === 'stale' && !stale)) {
          command = { tool: 'atn_status', args: { query: flow.key } }
        } else {
          const holder = flow.stage === 'stale' ? stale!.id : current.id
          const neighbours = status!.neighbours as string[]
          if (!fixed && !neighbours.includes(holder) && !flow.rewired) {
            flow.rewired = true
            command = { tool: 'atn_status', args: { rewire: { peers: [holder, ...neighbours.filter(id => id !== stale?.id && id !== holder)].slice(0, 2) } } }
          } else if (!flow.sent) {
            flow.sent = true
            command = lookupCommand(neighbours.includes(holder) ? holder : neighbours.find(id => id !== stale?.id) ?? neighbours[0],
              { phase, key: flow.key, target: holder, visited: [status!.self as string] })
          } else {
            flow.taskId ??= results.findLast(row => typeof row.settledTaskId === 'string')?.settledTaskId as string | undefined
            const queried = flow.taskId ? lastTask(results, flow.taskId) : undefined
            const task = queried?.result ? queried : flow.taskId ? receivedResult(options, flow.taskId) : undefined
            if (!task?.result) { await pause(); command = { tool: 'atn_status', args: { ...(flow.taskId ? { taskIds: [flow.taskId] } : {}) } } }
            else if (!flow.reviewed && !noFeedback) {
              flow.reviewed = true
              let value: unknown
              try { value = JSON.parse(task.result.summary) } catch { value = undefined }
              const verdict = validateRequestedEvidence(value, { phase, key: flow.key })
              command = { tool: 'atn_status', args: { review: { taskId: task.id, status: verdict.status,
                summary: verdict.reasons.join(', ') || 'Requested phase, version, key and required fields match.',
                evidence: [(value as EvidenceFact | undefined)?.id ?? 'missing-required-evidence'], comparisonKey: 'versioned-fact:v1' } } }
            } else {
              if (flow.stage === 'stale') this.flows.set(key, { stage: 'current', key: flow.key, facts: flow.facts })
              else {
                const fact = JSON.parse(task.result.summary) as EvidenceFact
                if (validateRequestedEvidence(fact, { phase, key: flow.key }).status !== 'accepted') throw new Error('Fixture received invalid current fact')
                this.flows.set(key, { stage: fact.next === null ? 'complete' : 'current', key: fact.next ?? flow.key, facts: [...flow.facts, fact] })
              }
              yield* this.stream(options)
              return
            }
          }
        }
      }
    }
    if (command) {
      const id = ToolCallId(`calibration-${++this.sequence}`), args = JSON.stringify(command.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: command.tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: command.tool, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = 'Local evidence read; await a lookup or the host phase change.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    // A scripted decision never invents provider token consumption.
  }
}
