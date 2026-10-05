/** Synchronous experiment admission: a hard visible-call count and a per-request output ceiling. */
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'

export interface ExperimentBudgetOptions {
  provider: string
  model: string
  maxCalls: number
  maxOutputTokens: number
  /** null disables only this threshold for an explicitly marked calibration run. */
  observedTokenLimit: number | null
}
export interface BudgetObservation {
  ended: boolean
  knownTotalTokens: number
  unknownUsageCalls: number
}
export type BudgetRejection = 'ended' | 'route-not-allowed' | 'output-limit-not-applied' | 'call-limit' | 'observed-token-limit' | 'invalid-observation'
export type BudgetAdmission = { allowed: true; issued: number } | { allowed: false; reason: BudgetRejection; issued: number }
export interface ExperimentBudgetSnapshot {
  issued: number
  denied: number
  lastRejection: BudgetRejection | null
  unknownUsageCalls: number
  /** Final usage arrives after a call; concurrent calls and hidden retries can exceed this threshold. */
  tokenLimitKind: 'observed-total-token admission threshold, not a hard token ceiling'
}

/**
 * Materialize the cap before request logging/freezing for every loop Agent.
 * Never mutate `llm/stream` requests: Harness freezes those after the logged
 * request/header has been committed. Non-loop calls remain checked by admission.
 */
export function installExperimentOutputCap(ctx: Context, maxOutputTokens: number): () => void {
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) throw new TypeError('Output limit must be a positive safe integer')
  return ctx.on('agent/request', async (_payload, next) => {
    const config = await next()
    if (config.maxTokens !== undefined && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
      throw new TypeError('Agent requested an invalid output token limit')
    }
    return { ...config, maxTokens: Math.min(config.maxTokens ?? maxOutputTokens, maxOutputTokens) }
  }, { global: true, prepend: true })
}

/**
 * Reserve an invocation synchronously, before calling the next stream listener.
 * Register its middleware after telemetry with `{ global: true, prepend: true }`
 * so refused requests never appear as adapter invocations in telemetry.
 */
export function createExperimentBudget(options: ExperimentBudgetOptions) {
  const config = { ...options }
  for (const value of [config.maxCalls, config.maxOutputTokens, ...(config.observedTokenLimit === null ? [] : [config.observedTokenLimit])]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Experiment limits must be positive safe integers')
  }
  if (!config.provider || !config.model) throw new TypeError('Experiment requires an exact provider and model')
  let issued = 0
  let denied = 0
  let unknownUsageCalls = 0
  let lastRejection: BudgetRejection | null = null
  const refuse = (reason: BudgetRejection): BudgetAdmission => {
    denied++
    lastRejection = reason
    return { allowed: false, reason, issued }
  }
  return {
    admit(request: Pick<GenerateOptions, 'provider' | 'model' | 'maxTokens'>, observation: BudgetObservation): BudgetAdmission {
      if (!Number.isSafeInteger(observation.knownTotalTokens) || observation.knownTotalTokens < 0
        || !Number.isSafeInteger(observation.unknownUsageCalls) || observation.unknownUsageCalls < 0) return refuse('invalid-observation')
      unknownUsageCalls = observation.unknownUsageCalls
      if (observation.ended) return refuse('ended')
      if (request.provider !== config.provider || request.model !== config.model) return refuse('route-not-allowed')
      if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens! <= 0 || request.maxTokens! > config.maxOutputTokens) return refuse('output-limit-not-applied')
      if (issued >= config.maxCalls) return refuse('call-limit')
      if (config.observedTokenLimit !== null && observation.knownTotalTokens >= config.observedTokenLimit) return refuse('observed-token-limit')
      issued++
      return { allowed: true, issued }
    },
    snapshot(): ExperimentBudgetSnapshot {
      return { issued, denied, lastRejection, unknownUsageCalls, tokenLimitKind: 'observed-total-token admission threshold, not a hard token ceiling' }
    },
  }
}
