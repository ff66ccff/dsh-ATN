/** Deterministic zero-provider policy: every decision uses only rendered inputs. */
import { createHash } from 'node:crypto'
import { LlmAdapter, ToolCallId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { assembleChain } from './shifting-evidence-reference.ts'
import { validateRequestedEvidence, type EvidenceFact } from './shifting-evidence-task.ts'

type Command = { tool: string; args: Record<string, unknown> }
type Lookup = { phase: 1 | 2; key: string; target: string; visited: string[] }
type Incoming = { taskId: string; requester: string; self: string; lookup: Lookup }
type Task = { id: string; result?: { summary: string }; localFeedback?: { status: string } }
type Flow = { stage: 'stale' | 'current' | 'complete'; taskId?: string; sent?: boolean; reviewed?: boolean; rewired?: boolean }

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
const pause = () => new Promise<void>(done => setTimeout(done, 30))
function lastTask(results: Array<Record<string, unknown>>, id: string): Task | undefined {
  for (const result of [...results].reverse()) {
    const task = (result.tasks as Task[] | undefined)?.find(row => row.id === id)
    if (task) return task
  }
  return undefined
}

export class ShiftingBoardScript extends LlmAdapter {
  private sequence = 0
  private published = new Set<string>()
  private submitted = new Set<string>()
  private answered = new Set<string>()
  private flows = new Map<string, Flow>()
  private relays = new Map<string, { sent: boolean; childTaskId?: string }>()
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: 'Deterministic board and requester-review policy (not a real model)' })
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
    else if (!this.published.has(key)) {
      this.published.add(key)
      const hints = local.discoveryHints as { documents: string[]; topics: string[] }
      command = { tool: 'atn_board', args: { action: 'publish', key: `phase-${phase}:${createHash('sha256').update(session).digest('hex').slice(0, 12)}`,
        expectedRevision: 0, body: JSON.stringify(local.documents), documents: hints.documents, topics: hints.topics } }
    } else {
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
            const child = relay.childTaskId ? lastTask(results, relay.childTaskId) : undefined
            if (child?.result) {
              this.answered.add(incoming.taskId)
              command = { tool: 'atn_send', args: { to: incoming.requester, kind: 'result', taskId: incoming.taskId,
                body: child.result.summary, summary: child.result.summary, evidence: ['unchanged-relayed-evidence'] } }
            } else { await pause(); command = { tool: 'atn_status', args: { ...(relay.childTaskId ? { taskIds: [relay.childTaskId] } : {}) } } }
          }
        }
      } else if (session.startsWith('shifting-') && !this.submitted.has(key)) {
        const evidence = new Map<string, { fact: EvidenceFact; holder: string }>()
        for (const result of results) if (result.action === 'read' && Array.isArray(result.entries)) {
          for (const entry of result.entries as Array<{ body: string; authorId: string; key: string }>) {
            if (!entry.key.startsWith(`phase-${phase}:`)) continue
            try { for (const fact of JSON.parse(entry.body) as EvidenceFact[]) evidence.set(fact.id, { fact, holder: entry.authorId }) } catch { /* malformed claims are not facts */ }
          }
        }
        const facts = [...evidence.values()].map(row => row.fact)
        let answer: ReturnType<typeof assembleChain> | undefined
        try { answer = assembleChain('key-00', phase, facts) } catch { /* Read more bounded board pages below. */ }
        const stale = [...evidence.values()].find(row => row.fact.key === 'key-00' && validateRequestedEvidence(row.fact, { phase, key: 'key-00' }).status === 'rejected')
        const current = [...evidence.values()].find(row => row.fact.key === 'key-00' && validateRequestedEvidence(row.fact, { phase, key: 'key-00' }).status === 'accepted')
        const flow = this.flows.get(key) ?? { stage: 'stale' as const }; this.flows.set(key, flow)
        if (!status) command = { tool: 'atn_status', args: { query: 'key-00' } }
        else if (!answer || !stale || !current) {
          await pause()
          const lastRead = results.findLast(row => row.action === 'read' && Array.isArray(row.entries))
          const currentPage = (lastRead?.entries as Array<{ key?: string }> | undefined)?.some(entry => entry.key?.startsWith(`phase-${phase}:`))
          command = { tool: 'atn_board', args: { action: 'read', query: `phase-${phase}`, limit: 8,
            ...(currentPage && typeof lastRead?.nextCursor === 'string' ? { cursor: lastRead.nextCursor } : {}) } }
        } else if (flow.stage === 'complete') {
          this.submitted.add(key)
          command = { tool: 'submit_checkpoint', args: { phase, answer: JSON.stringify(answer) } }
        } else {
          const holder = flow.stage === 'stale' ? stale.holder : current.holder
          const neighbours = status.neighbours as string[]
          if (!fixed && !neighbours.includes(holder) && !flow.rewired) {
            flow.rewired = true
            command = { tool: 'atn_status', args: { rewire: { peers: [holder, ...neighbours.filter(id => id !== stale.holder && id !== holder)].slice(0, 2) } } }
          } else if (!flow.sent) {
            flow.sent = true
            command = lookupCommand(neighbours.includes(holder) ? holder : neighbours.find(id => id !== stale.holder) ?? neighbours[0],
              { phase, key: 'key-00', target: holder, visited: [status.self as string] })
          } else {
            flow.taskId ??= results.findLast(row => typeof row.settledTaskId === 'string')?.settledTaskId as string | undefined
            const task = flow.taskId ? lastTask(results, flow.taskId) : undefined
            if (!task?.result) { await pause(); command = { tool: 'atn_status', args: { ...(flow.taskId ? { taskIds: [flow.taskId] } : {}) } } }
            else if (!flow.reviewed && !noFeedback) {
              flow.reviewed = true
              let value: unknown
              try { value = JSON.parse(task.result.summary) } catch { value = undefined }
              const verdict = validateRequestedEvidence(value, { phase, key: 'key-00' })
              command = { tool: 'atn_status', args: { review: { taskId: task.id, status: verdict.status,
                summary: verdict.reasons.join(', ') || 'Requested phase, version, key and required fields match.',
                evidence: [(value as EvidenceFact | undefined)?.id ?? 'missing-required-evidence'], comparisonKey: 'versioned-fact:v1' } } }
            } else {
              this.flows.set(key, { stage: flow.stage === 'stale' ? 'current' : 'complete' })
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
      const text = 'Local facts published; await a lookup or the host phase change.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    // A scripted decision never invents provider token consumption.
  }
}
