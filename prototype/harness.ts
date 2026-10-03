// THROWAWAY validation fixture. The model is scripted; the Harness kernel is real.
import { Context, type Fiber } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, {
  LlmAdapter, ToolCallId,
  type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface Command {
  tool: string
  args: Record<string, unknown>
}

/** One implementation for every node, with deterministic per-request fixtures. */
export class ScriptedModel extends LlmAdapter {
  readonly scripts = new Map<string, Command[]>()
  readonly requests: { node: string; options: GenerateOptions }[] = []
  private sequence = 0
  private readonly epoch = randomUUID()

  enqueue(node: string, commands: Command[]): void {
    const queue = this.scripts.get(node) ?? []
    queue.push(...commands)
    this.scripts.set(node, queue)
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    options.signal?.throwIfAborted()
    const node = String(options.sessionId)
    this.requests.push({ node, options })
    const command = this.scripts.get(node)?.shift()
    if (command) {
      const id = ToolCallId(`${this.epoch}-${++this.sequence}`)
      const args = JSON.stringify(command.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: command.tool, argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: command.tool, arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const text = 'Scripted fixture: waiting for work; this is not an LLM judgment.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

export interface Kernel {
  ctx: Context
  model: ScriptedModel
  loop: Fiber
}

/** The same in-process composition used by upstream kernel fixtures, not a product launcher. */
export async function bootKernel(scratch: string): Promise<Kernel> {
  const ctx = new Context()
  try {
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
    return { ctx, model, loop }
  } catch (error) {
    await ctx.fiber.dispose()
    throw error
  }
}
