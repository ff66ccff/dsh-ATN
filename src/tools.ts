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
  'You are in ATN mode with equal peers and one goal. For new user work call atn_start once; received work already belongs to a network.',
  'Read local evidence and search host custody metadata with atn_status before asking a relevant neighbour. Discovery hints are host-derived; messages must respect the installed custody policy.',
  'Check requested results: phase/version, key and required fields. Reject phase/version mismatch, missing required fields or wrong key via atn_status review with evidence. comparisonKey groups comparable work. Ratings are not host verification or human permission.',
  'Query atn_status before rewiring; call atn_status rewire={peers:[nodeIds]} with the full list. Choose by relevance, ratings, load and cost; explore unobserved peers. Gains are not causal proof. Reuse before spawning.',
  'Settle held tasks with atn_send kind=result, taskId, summary and evidence; use outcome=failed on failure. Completed means submitted. Keep messages short.',
  'Reserve budget for delivery. Idle peers can claim orphan tasks with atn_status. Finish settled work with atn_finish scope=node; the delivery holder uses scope=network, summary, evidence and goalVersion.',
].join('\n')

/** UTF-8 fixed protocol cost, measured from the actual advertised ATN schemas. */
export function measureAtnFixedContext(schemas: readonly { name: string }[]): {
  systemPromptBytes: number; toolSchemaBytes: number; fixedContextBytes: number
} {
  const systemPromptBytes = Buffer.byteLength(SHARED_RULES)
  const toolSchemaBytes = Buffer.byteLength(JSON.stringify(schemas.filter(row => row.name.startsWith('atn_'))))
  return { systemPromptBytes, toolSchemaBytes, fixedContextBytes: systemPromptBytes + toolSchemaBytes }
}

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
            'Start this session network once with its shared goal; returns network, node and task ids.',
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
            'Spawn an independent equal-capability peer. Prefer an existing suitable peer.',
          parameters: {
            task: { type: 'string', required: true, description: 'Local task for the new node.' },
            context: { type: 'string', description: 'Necessary local context for that task.' },
            leaseMs: { type: 'integer', description: 'Requested lifetime in ms; runtime bounded.' },
            dependsOn: { type: 'array', items: { type: 'string' }, description: 'Up to 16 completed task ids without host rejection.' },
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
            'Send task/note to an outgoing neighbour or self. Results settle held tasks and reach their requester even after disconnection; open-task notes also survive disconnection.',
          parameters: {
            to: { type: 'string', required: true, description: 'Target node id.' },
            kind: { type: 'string', required: true, enum: ['task', 'note', 'result'], description: 'Mail kind.' },
            body: { type: 'string', required: true, description: 'Body text.' },
            taskId: { type: 'string', description: 'Required for result; open-task id permits notes after disconnection.' },
            outcome: { type: 'string', enum: ['completed', 'failed'], description: 'Result only, default completed; explicitly use failed on failure.' },
            summary: { type: 'string', description: 'Short result summary; required for kind=result.' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'Reviewable evidence references for kind=result.' },
            dependsOn: { type: 'array', items: { type: 'string' }, description: 'Task only: up to 16 completed ids without host rejection.' },
            retryOf: { type: 'string', description: 'Task only: failed task you requested, now retried.' },
            messageId: {
              type: 'string',
              description:
                'Stable id: retry identical content with the same id to avoid duplicate delivery/settlement.',
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
      description: 'Discover peers, host custody metadata/tasks, ratings and budget. To reconnect call rewire={peers:[nodeIds]}. Optionally perform ONE atomic write: claimTaskId, review or rewire. Ratings are separate from host verification.',
      parameters: {
        query: { type: 'string', description: 'Search metadata/tasks; "*" rotates candidates.' },
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Up to 16 task ids; default your recent tasks.' },
        claimTaskId: { type: 'string', description: 'Claim orphan work when holding no open task.' },
        review: { type: 'object', additionalProperties: false, description: 'Rate completed work you requested. needs-more may become terminal; terminal ratings are immutable.', properties: {
          taskId: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['accepted', 'rejected', 'needs-more'] },
          summary: { type: 'string', required: true, description: 'Reason, <=1024 characters.' },
          evidence: { type: 'array', required: true, items: { type: 'string' }, description: '1–8 references, <=512 characters each.' },
          comparisonKey: { type: 'string', description: 'Same workload/acceptance contract, <=160 characters.' },
        } },
        rewire: { type: 'object', additionalProperties: false, description: 'Replace outgoing peers within budget.maxCollaborationPeers; [] disconnects. Obligations remain.', properties: {
          peers: { type: 'array', required: true, items: { type: 'string' }, description: 'Full desired list; no duplicates/self.' },
        } },
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
          name: 'atn_finish',
          description:
            'Node (default) retires after obligations settle, without completing tasks. Network delivers from entry/delivery holder with summary and goalVersion; unsettled work or stale goal blocks delivery.',
          parameters: {
            scope: { type: 'string', enum: ['node', 'network'], description: 'Default node; network submits final delivery.' },
            reason: { type: 'string', description: 'For node scope: why you are retiring.' },
            summary: { type: 'string', description: 'Network requires final result summary.' },
            evidence: { type: 'array', items: { type: 'string' }, description: 'For network scope: reviewable evidence references.' },
            goalVersion: { type: 'integer', description: 'Network requires goal revision used.' },
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
