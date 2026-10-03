/**
 * Deterministic kernel fixture.
 *
 * The Harness kernel is real — Cordis scopes, the Agent factory and loop, the
 * tool registry, JSONL session persistence, the storage hub, the domain layer
 * and the ATN plugins all run for real. Only the model decision is scripted, so
 * the tests never call a paid provider.
 *
 * This file mirrors what a `dsh` profile does, minus the profile launcher: it
 * passes the plugin objects through the same `ctx.plugin` entry the Loader
 * uses, including the Loader's `exports.default ?? exports` unwrapping.
 * @module dsh-atn/tests/fixtures/kernel
 */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  LlmAdapter,
  ReasoningEffortId,
  ToolCallId,
  createUserMessage,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorageBackend from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import AtnRuntimePlugin from '../../src/index.ts'
import * as AtnTools from '../../src/tools.ts'
import { AtnRuntime } from '../../src/runtime.ts'
import { assertConfigRelations, type Config as AtnConfig } from '../../src/config.ts'
import type { NetworkStore } from '../../src/domain.ts'
import { testConfig } from './network.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** One scripted model decision. */
export interface Command {
  /** Tool the scripted model calls. */
  tool: string
  /** Tool arguments. */
  args: Record<string, unknown>
}

/** Scripted model adapter: same implementation for every node. */
export class ScriptedModel extends LlmAdapter {
  /** Per-session queues of scripted decisions. */
  readonly scripts = new Map<string, Command[]>()
  /** Every request the runtime actually issued. */
  readonly requests: { sessionId: string; options: GenerateOptions }[] = []
  /** Tool names advertised on each request, for capability comparisons. */
  readonly toolSets: { sessionId: string; tools: string[] }[] = []
  private sequence = 0
  private readonly epoch = randomUUID()

  /**
   * Queue scripted decisions for one session.
   *
   * @param sessionId - Session the decisions answer.
   * @param commands - Decisions in order.
   */
  enqueue(sessionId: string, commands: Command[]): void {
    const queue = this.scripts.get(sessionId) ?? []
    queue.push(...commands)
    this.scripts.set(sessionId, queue)
  }

  /** @inheritdoc */
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    // The fixture route advertises the three common efforts so a test can prove
    // that a recorded effort survives into the child's and the resumed node's
    // requests instead of being dropped as unsupported.
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'low' },
          { id: ReasoningEffortId('medium'), name: 'medium' },
          { id: ReasoningEffortId('high'), name: 'high' },
        ],
      },
    })
  }

  /** @inheritdoc */
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    const sessionId = String(options.sessionId)
    this.requests.push({ sessionId, options })
    const advertised = (options.tools ?? []).map((tool) => tool.name).sort()
    this.toolSets.push({ sessionId, tools: advertised })
    const command = this.scripts.get(sessionId)?.shift()
    if (command !== undefined) {
      const id = ToolCallId(`${this.epoch}-${++this.sequence}`)
      const args = JSON.stringify(command.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: command.tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: command.tool, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = 'Scripted fixture: no further decision queued.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** A booted deterministic kernel. */
export interface Kernel {
  /** Root context. */
  ctx: Context
  /** Scripted model adapter. */
  model: ScriptedModel
  /** Agent loop fiber. */
  loop: Fiber
  /** The mounted ATN runtime. */
  atn: AtnRuntime
  /** Scratch directory this kernel owns. */
  scratch: string
}

/**
 * Boot the deterministic kernel and mount the ATN bundle rows.
 *
 * @param scratch - Directory for sessions and storage; each test uses its own.
 * @param deps - Optional test seams: an explicit store and clock.
 * @returns The live kernel.
 */
export async function bootKernel(
  scratch: string,
  deps: { store?: NetworkStore; clock?: () => number; cleanupTimeoutMs?: number; presets?: boolean } = {},
): Promise<Kernel> {
  const ctx = new Context()
  try {
    ctx.baseUrl = import.meta.url
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(JsonlSessionPersistence, { root: join(scratch, 'sessions'), compression: 'none' })
    const loop = await ctx.plugin(AgentLoop, { agents: [] })
    const model = new ScriptedModel()
    ctx.llm.registerAdapter(['atn-script'], model)

    await ctx.plugin(Storage)
    await ctx.plugin(JsonStorageBackend, { root: join(scratch, 'storage') })
    await ctx.plugin(StorageDomain, { backend: 'json' })

    // The Loader unwraps `exports.default ?? exports` before calling ctx.plugin.
    const plugin = unwrap(AtnRuntimePlugin)
    if (deps.store !== undefined || deps.clock !== undefined || deps.cleanupTimeoutMs !== undefined) {
      // Same service class with explicit seams; the production entry only adds
      // configuration validation.
      class SeededAtnRuntime extends AtnRuntime {
        constructor(inner: Context, config: AtnConfig) {
          assertConfigRelations(config)
          super(inner, config, deps)
        }
      }
      await ctx.plugin(SeededAtnRuntime, testConfig())
    } else {
      await ctx.plugin(plugin, testConfig())
    }
    if (deps.presets) {
      await ctx.plugin(Loader)
      await ctx.plugin(AgentPresets, { default: 'standard' })
      await ctx.plugin(AgentPreset, { id: 'standard', name: 'Standard', plugins: [] })
      await ctx.plugin(AgentPreset, {
        id: 'atn', name: 'ATN', description: 'Adaptive topology network',
        plugins: [{ id: 'atn-tools', name: new URL('../../src/tools.ts', import.meta.url).href }],
      })
    } else {
      // Legacy preset-free assembly remains covered for embedded callers.
      await ctx.plugin(AtnTools)
    }

    return { ctx, model, loop, atn: ctx.atn, scratch }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}

function unwrap<T>(exports: T): T {
  const holder = exports as { default?: unknown }
  return (holder.default ?? exports) as T
}

/**
 * Create a host-owned entry agent, as a `dsh` profile does for the interactive
 * session, and return it without handing ownership to ATN.
 *
 * @param kernel - Booted kernel.
 * @param sessionId - Session id to create on.
 * @returns The host-owned agent.
 */
export async function createHostAgent(kernel: Kernel, sessionId: string, presetId?: string): Promise<Agent> {
  const handle = await kernel.ctx.agents.create({
    sessionId: SessionId(sessionId),
    agentOptions: { provider: 'atn-script', model: 'deterministic' },
    meta: { cwd: kernel.scratch, ...(presetId === undefined ? {} : { agentPreset: presetId }) },
    setup: async (agentCtx) => {
      const presets = kernel.ctx.get('agentPresets')
      if (presets !== undefined) await presets.mount(agentCtx, presetId)
    },
  })
  return handle.agent
}

/**
 * Drive one agent until it is idle again.
 *
 * @param agent - Agent to drive.
 * @param message - User message that starts the turn.
 */
export async function drive(agent: Agent, message: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

/**
 * Wait until every live agent is idle, so a test observes a settled runtime
 * instead of a concurrent driver.
 *
 * @param kernel - Booted kernel.
 */
export async function settle(kernel: Kernel): Promise<void> {
  for (let pass = 0; pass < 20; pass += 1) {
    const running = kernel.ctx.agents.list().filter((agent) => agent.status === 'running')
    if (running.length === 0) return
    await Promise.all(running.map((agent) => agent.whenIdle()))
  }
}

/**
 * Read every ATN-sourced user message of one session, newest last.
 *
 * @param agent - Agent whose session is inspected.
 * @returns The text of each ATN message actually landed in the log.
 */
export function atnMessages(agent: Agent): string[] {
  const events = agent.session.snapshotEvents()
  const texts: string[] = []
  for (const event of events as readonly { type: string; data?: unknown }[]) {
    if (event.type !== 'user/message') continue
    const message = event.data as { source?: { kind?: string }; content?: readonly { type: string; text?: string }[] } | undefined
    if (message?.source?.kind !== 'atn') continue
    for (const block of message.content ?? []) {
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
    }
  }
  return texts
}
