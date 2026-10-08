/** Preregistered visible model-step allocations; these are not token or HTTP ceilings. */
export const EQUAL_BUDGET_MODES = ['single', 'independent-pool', 'native-team', 'atn-adaptive'] as const
/** Legacy four-arm schedules stay frozen; round 11 explicitly selects this arm set. */
export const EQUAL_BUDGET_V3_MODES = ['single', 'single-scaffolded', 'independent-pool', 'native-team', 'atn-adaptive'] as const
export type EqualBudgetMode = typeof EQUAL_BUDGET_V3_MODES[number]
export interface EqualBudgetAllocation { mode: EqualBudgetMode; agents: number; perAgentSteps: number[]; totalSteps: number }

export function equalBudgetAllocations(agents: number, steps: number, modes: readonly EqualBudgetMode[] = EQUAL_BUDGET_MODES): EqualBudgetAllocation[] {
  if (!Number.isSafeInteger(agents) || agents < 2 || agents > 16 || !Number.isSafeInteger(steps) || steps < 1 || steps > 64) {
    throw new Error('Equal-budget design requires 2..16 agents and 1..64 steps per node')
  }
  if (!modes.length || new Set(modes).size !== modes.length || modes.some(mode => !EQUAL_BUDGET_V3_MODES.includes(mode))) {
    throw new Error('Equal-budget design requires distinct registered arms')
  }
  return modes.map(mode => ({ mode, agents: mode === 'single' || mode === 'single-scaffolded' ? 1 : agents,
    perAgentSteps: mode === 'single' || mode === 'single-scaffolded' ? [agents * steps] : Array<number>(agents).fill(steps), totalSteps: agents * steps }))
}

/** Slot registration and admission are synchronous, so concurrent workers cannot steal allocations. */
export function createEqualBudgetAdmission(allocation: EqualBudgetAllocation) {
  const sessions = new Map<string, { alias: string; limit: number; used: number }>()
  return {
    register(session: string) {
      if (sessions.has(session)) return
      const slot = sessions.size
      if (slot >= allocation.agents) throw new Error('equal-budget-agent-cap')
      sessions.set(session, { alias: `agent-${slot + 1}`, limit: allocation.perAgentSteps[slot]!, used: 0 })
    },
    canAdmit(session: string | undefined) { const row = session ? sessions.get(session) : undefined; return !!row && row.used < row.limit },
    admit(session: string) {
      const row = sessions.get(session)
      if (!row || row.used >= row.limit) throw new Error('equal-budget-agent-step-cap')
      row.used++
    },
    alias(session: string) { return sessions.get(session)?.alias ?? 'unregistered' },
    snapshot() { return [...sessions.values()].map(row => ({ ...row })) },
  }
}
