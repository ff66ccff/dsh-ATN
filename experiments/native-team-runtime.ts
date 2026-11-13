/** Experiment-side directory and birth admission over official continuable providers. */
import type { Context } from '@deepseek-ai/cordis'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'

export const NATIVE_TEAM_PROTOCOL = 'task-board-continuable-subagents-v1' as const
export const NATIVE_TEAM_BASELINE = 'harness-0.2.2-rc.2-native-team-v1' as const

export async function installTeamDirectory(ctx: Context, cwd: string): Promise<void> {
  await ctx.plugin(LocalFileSystem, { cwd })
  await ctx.plugin(WorkingDirectory, { defaultDirectory: cwd })
}

/** A prepared birth consumes budget even if startup fails; cold resumes reuse its identity. */
export function installNativeTeamBirthLimit(ctx: Context, maxAgents: number, rejected: () => void = () => {}) {
  if (!Number.isSafeInteger(maxAgents) || maxAgents < 2) throw new TypeError('native-team requires at least two agent slots')
  const identities = new Set<string>()
  let rejectedCreations = 0
  const providers = { spawn: 'bounded-spawn', fork: 'bounded-fork' } as const
  for (const [backend, name] of Object.entries(providers)) {
    const official = ctx.subagents.getProvider(backend)
    if (!official?.prepareContinuable) throw new Error(`Missing official continuable ${backend} provider`)
    const prepare = official.prepareContinuable.bind(official)
    const bounded: SubagentProvider = {
      name, capabilities: official.capabilities, inheritsParentContext: official.inheritsParentContext,
      async prepareContinuable(request) {
        request.signal.throwIfAborted()
        if (identities.size >= maxAgents - 1 && !identities.has(request.sessionId)) {
          rejectedCreations++; rejected()
          throw new Error('pilot-native-team-total-agent-cap')
        }
        identities.add(request.sessionId)
        try { return await prepare(request) }
        catch (error) { identities.delete(request.sessionId); throw error }
      },
    }
    ctx.subagents.registerProvider(bounded)
  }
  return { providers, snapshot: () => ({ limitIncludingEntry: maxAgents, admittedChildIdentities: identities.size,
    rejectedCreations, unit: 'distinct child creation identities; cold resumes reuse identity and step allocation',
    startupFailurePolicy: 'post-preparation failures retain a consumed reservation' }) }
}
