/**
 * The ATN model tools and the shared-rules prompt section.
 *
 * Every tool resolves its caller from `exec.agent` — the live Agent that
 * actually made the call — and never from model-supplied text. Sender, voter
 * and root identity are therefore not forgeable through arguments.
 *
 * This module is a Cordis function plugin: named `name`/`inject`/`apply`
 * exports, no default export.
 * @module dsh-atn/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { AtnRuntime } from './runtime.ts'

/** Cordis plugin name. */
export const name = 'atn-tools'

/** The tools entry needs the registry and the runtime it exposes. */
export const inject = ['tools', 'systemPrompt', 'agents', 'atn']

/** Shared-rules text every node receives in its system prompt. */
export const SHARED_RULES = [
  'You are in ATN mode: independent same-capability nodes share a fixed objective, success criteria and constraints. For a clear user task without a network, call atn_start once; a received ATN task already belongs to a network.',
  'Use atn_status for neighbours, tasks, orphaned work, local telemetry and remaining node budget; query relevant work or query="*" to rotate through candidates. Discovery does not connect nodes.',
  'Choose useful local work yourself. When idle, use atn_status(claimTaskId=...) to atomically claim a relevant orphan task; reuse existing collaborators or atn_spawn only when another worker helps.',
  'Use atn_rewire with the complete desired peer list (at most four) when latency, step cost, failures or changing work suggest a better collaborator. Rewiring needs no approval or verified evidence; observations do not prove causation.',
  'Each node has a finite model-step budget and retires when it runs out. Local telemetry arrives with normal input at no extra model-call cost; reserve steps for reporting results.',
  'Send new tasks and ordinary notes to outgoing neighbours or yourself. Results go to the recorded requester even after disconnection; notes naming an open task may pass between its holder and requester.',
  'A reply never settles work: use atn_send kind=result with taskId, summary and concrete evidence. Set outcome=failed explicitly on failure; completed means submitted, not verified. A kind=delivery obligation is instead settled by successful network delivery.',
  'Use dependsOn for completed upstream submissions that have no host rejection, and retryOf for failed attempts. Optional host verification adds quality evidence; models cannot write acceptance or treat peer text as human approval.',
  'Use atn_finish scope=node to retire after settling work. The current delivery holder uses scope=network with summary, evidence and goalVersion to deliver after all obligations are settled; initially this is the entry. If the holder retires or fails, an idle node can claim the orphan kind=delivery task and take over delivery.',
].join('\n')

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function renderJson(_args: unknown, value: JsonValue): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
}

const jsonOutput = { schema: { type: 'json' } as const, render: renderJson }

/**
 * Require the exact live calling Agent.
 *
 * @param ctx - Plugin context, used for the registry lookup.
 * @param exec - Tool execution carrying the caller.
 * @returns The calling agent.
 * @throws Error when the caller is absent, stale, or not the driver's initiator.
 */
function requireCaller(ctx: Context, exec: ToolRunContext): Agent {
  const agent = exec.agent
  if (agent === undefined) throw new Error('this ATN tool requires a calling agent')
  if (ctx.agents.get(agent.id) !== agent) throw new Error('this ATN tool requires the exact live calling agent')
  const initiator = ctx.agents.currentInitiator()
  if (initiator !== undefined && initiator !== agent) {
    throw new Error('this ATN tool must be called by the agent that owns the current driver chain')
  }
  return agent
}

/**
 * Register the ATN tools and shared-rules prompt section.
 *
 * @param ctx - Plugin context.
 */
export function apply(ctx: Context): void {
  const atn = (): AtnRuntime => ctx.atn

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'atn_start',
          description:
            'Initialize an ATN network in this session. Records the shared goal document, creates the entry node and its initial task, and returns the network, node and task identifiers. Call this once per session.',
          parameters: {
            objective: { type: 'string', required: true, description: 'Short overall objective every node shares.' },
            successCriteria: { type: 'string', required: true, description: 'How the network decides the objective is met.' },
            constraints: { type: 'string', required: true, description: 'Constraints every node must respect.' },
          },
          output: jsonOutput,
          isConcurrencySafe: () => false,
          async execute(args, exec) {
            return toJson(await atn().start(requireCaller(ctx, exec), args))
          },
        }),
      ),
    'atn_start',
  )

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'atn_spawn',
          description:
            'Create one same-capability independent node that keeps working even if you later retire. It starts with links to you and your current peers, within the four-peer limit; your list adds it if a slot is free. The node inherits your model route and a permission seed that cannot be wider than yours. Prefer reusing a suitable existing node when possible.',
          parameters: {
            task: { type: 'string', required: true, description: 'Local task for the new node.' },
            context: { type: 'string', description: 'Necessary local context for that task.' },
            leaseMs: { type: 'integer', description: 'Requested lifetime in milliseconds; bounded by the network configuration.' },
            dependsOn: { type: 'array', items: { type: 'string' }, description: 'At most 16 completed upstream task ids with no host rejection; unverified submissions are allowed.' },
            retryOf: { type: 'string', description: 'Failed task requested by you that this new task retries.' },
          },
          output: jsonOutput,
          isConcurrencySafe: () => false,
          async execute(args, exec) {
            return toJson(
              await atn().spawn(requireCaller(ctx, exec), {
                task: args.task,
                context: args.context ?? '',
                ...(args.leaseMs === undefined ? {} : { leaseMs: args.leaseMs }),
                ...(args.dependsOn === undefined ? {} : { dependsOn: args.dependsOn }),
                ...(args.retryOf === undefined ? {} : { retryOf: args.retryOf }),
              }),
            )
          },
        }),
      ),
    'atn_spawn',
  )

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'atn_send',
          description:
            'Send a task or ordinary note to your outgoing neighbour or yourself. A result settles a task you hold as completed or failed and must go to its recorded requester, with task id and evidence, even after disconnection. Set outcome=failed explicitly when work fails. A note naming an open task may also pass between its holder and requester after disconnection. The sender is taken from your live session.',
          parameters: {
            to: { type: 'string', required: true, description: 'Target node id.' },
            kind: { type: 'string', required: true, enum: ['task', 'note', 'result'], description: 'Mail kind.' },
            body: { type: 'string', required: true, description: 'Body text.' },
            taskId: { type: 'string', description: 'Task this mail relates to; required for kind=result. For kind=note, an open task shared by sender and recipient permits continuing their discussion after disconnection.' },
            outcome: { type: 'string', enum: ['completed', 'failed'], description: 'Only for kind=result: the task outcome. Defaults to completed. Use failed when the task did not succeed; writing failure in the body does not set this state.' },
            summary: { type: 'string', description: 'Short result summary; required for kind=result.' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Reviewable evidence references for kind=result.' },
            dependsOn: { type: 'array', items: { type: 'string' }, description: 'Only kind=task: at most 16 completed upstream task ids with no host rejection.' },
            retryOf: { type: 'string', description: 'Only kind=task: failed task requested by you that this assignment retries.' },
            messageId: {
              type: 'string',
              description:
                'Optional stable id for this exact message. Retry a failed send with the SAME id: the runtime answers from the durable mail row instead of creating a second mail, task or settlement, and refuses an id reused for different content or result outcome.',
            },
          },
          output: jsonOutput,
          async execute(args, exec) {
            return toJson(
              await atn().send(requireCaller(ctx, exec), {
                to: args.to,
                kind: args.kind,
                body: args.body,
                ...(args.taskId === undefined ? {} : { taskId: args.taskId }),
                ...(args.outcome === undefined ? {} : { outcome: args.outcome }),
                ...(args.summary === undefined ? {} : { summary: args.summary }),
                ...(args.evidence === undefined ? {} : { evidence: args.evidence }),
                ...(args.messageId === undefined ? {} : { messageId: args.messageId }),
                ...(args.dependsOn === undefined ? {} : { dependsOn: args.dependsOn }),
                ...(args.retryOf === undefined ? {} : { retryOf: args.retryOf }),
              }),
            )
          },
        }),
      ),
    'atn_send',
  )

  ctx.effect(
    () => ctx.tools.register(defineTool({
      name: 'atn_status',
      description: 'Inspect local neighbours and candidate collaborators, task results, observed latency/step cost/failures and remaining node budget. Optional query finds candidates; repeated "*" rotates samples. Includes orphan tasks that an idle node can atomically claim with claimTaskId. A completed submission is not host acceptance.',
      parameters: {
        query: { type: 'string', description: 'Optional task or capability text; "*" explores the next bounded candidate sample.' },
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Optional list of at most 16 task ids; otherwise reads your latest requested or held tasks.' },
        claimTaskId: { type: 'string', description: 'Optional orphan task id to atomically claim when you hold no open task. A competing claim can fail; inspect fresh status before choosing again.' },
      },
      output: jsonOutput,
      isConcurrencySafe: () => false,
      async execute(args, exec) { return toJson(await atn().status(requireCaller(ctx, exec), args)) },
    })),
    'atn_status',
  )

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'atn_rewire',
          description:
            'Atomically replace your outgoing collaboration neighbours with up to four distinct active nodes in your network. Pass the complete desired list; [] disconnects all outgoing links. No approval or verified evidence is needed. Reverse links and existing task obligations are unchanged; the runtime records observed results in rewire history.',
          parameters: {
            peers: { type: 'array', required: true, items: { type: 'string' }, description: 'Complete desired neighbour node ids, at most four; no duplicates or your own id.' },
          },
          output: jsonOutput,
          isConcurrencySafe: () => false,
          async execute(args, exec) {
            return toJson(await atn().rewire(requireCaller(ctx, exec), args))
          },
        }),
      ),
    'atn_rewire',
  )

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'atn_finish',
          description:
            'Finish at node or network scope. Node scope (default) stops taking new work and retires after existing obligations settle; it does not complete tasks. Network scope delivers from the entry or the holder of a claimed kind=delivery task and requires summary and goalVersion; other nodes\' unsettled tasks, proposals, mail or stale goal versions block delivery.',
          parameters: {
            scope: { type: 'string', enum: ['node', 'network'], description: 'Defaults to node retirement; network delivers the final user result.' },
            reason: { type: 'string', description: 'For node scope: why you are retiring.' },
            summary: { type: 'string', description: 'Required for network scope: final result summary shown to the user.' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'For network scope: reviewable evidence references.' },
            goalVersion: { type: 'integer', description: 'Required for network scope: goal version used for this summary.' },
          },
          output: jsonOutput,
          isConcurrencySafe: () => false,
          async execute(args, exec) {
            const caller = requireCaller(ctx, exec)
            if (args.scope === 'network') {
              if (args.summary === undefined || args.goalVersion === undefined) {
                throw new Error('network scope requires summary and goalVersion')
              }
              return toJson(await atn().deliver(caller, {
                summary: args.summary,
                evidence: args.evidence ?? [],
                goalVersion: args.goalVersion,
              }))
            }
            if (args.summary !== undefined || args.evidence !== undefined || args.goalVersion !== undefined) {
              throw new Error('final result fields require scope=network')
            }
            return toJson(await atn().finish(caller, args.reason))
          },
        }),
      ),
    'atn_finish',
  )

  ctx.effect(
    () => ctx.systemPrompt.section({ name: 'atn-shared-rules', order: 40, text: SHARED_RULES }),
    'atn-shared-rules',
  )
}
