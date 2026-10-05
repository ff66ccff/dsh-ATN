/** Real Harness agents and durable ATN storage, with a synchronous script input sink. */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorageBackend from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { join } from 'node:path'
import AtnRuntimePlugin from '../src/index.ts'
import { Config } from '../src/config.ts'
import type { TopologyScenario } from './topology-task.ts'

export async function referenceKernel(directory: string, scenario: TopologyScenario, limits: Partial<Config> = {}) {
  const ctx = new Context()
  ctx.baseUrl = import.meta.url
  let issuedModelCalls = 0
  try {
    await ctx.plugin(LlmRuntime)
    // No provider or credentials are installed. Even an accidental loop is refused.
    ctx.on('llm/stream', () => (async function* () {
      issuedModelCalls++
      throw new Error('Reference policy must never invoke a model')
    })(), { global: true, prepend: true })
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.on('agent/created', ({ agent }) => {
      scenario.register(agent.id)
      // The script is the consumer. Log actual inputs so the UNCHANGED runtime
      // flushes its real receipts; never fabricate delivered mail in storage.
      const consume = (message: UserMessage): void => {
        if (agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.id === message.id)) return
        ;(agent.session as Session).append('user/message', message, { surfaceOp: 'append' })
      }
      agent.followup = consume
      agent.send = consume
      agent.inject = consume
      return undefined
    })
    await ctx.plugin(Storage)
    await ctx.plugin(JsonStorageBackend, { root: join(directory, 'storage') })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(AtnRuntimePlugin, Config({ ...Config(), maxResidentNodes: scenario.task.agents,
      maxTotalNodes: scenario.task.agents, maxTasks: 128, maxPendingMailPerNode: 32, maxRetainedMail: 128,
      stepBudget: 16, ...limits }))
    const handle = await ctx.agents.create({ sessionId: SessionId('reference-entry'),
      agentOptions: { provider: 'reference-disabled', model: 'no-model' }, meta: { cwd: directory } })
    return { ctx, entry: handle.agent, modelCalls: () => issuedModelCalls }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}
