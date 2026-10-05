import { Config } from '../src/config.ts'
import { runReference } from './reference-run.ts'
import { isTopologyTask, type TopologyTaskId } from './topology-task.ts'

export interface MeasurementLimits {
  maxAgents: number
  perNodeSteps: number
  timeoutMs: number
  maxCalls: number
  recoveryMode?: 'self-organized' | 'preassigned-backup'
}

/** The very same assembly is passed to the offline reference and live runtime. */
export function topologyRuntimeConfig(limits: MeasurementLimits): Config {
  return Config({ ...Config(), maxResidentNodes: limits.maxAgents, maxTotalNodes: limits.maxAgents,
    maxTasks: 128, maxProposals: 8, maxPendingMailPerNode: 32, maxRetainedMail: 128,
    networkDeadlineMs: limits.timeoutMs, proposalDeadlineMs: Math.min(limits.timeoutMs, 60_000),
    defaultLeaseMs: limits.timeoutMs, maxLeaseExtensionMs: limits.timeoutMs, stepBudget: limits.perNodeSteps })
}

/** Runs before loading any model provider. No persisted baseline can bypass this gate. */
export async function assertReferenceFeasible(task: string, limits: MeasurementLimits) {
  if (!isTopologyTask(task)) throw new Error('Reference gate: no deterministic reference exists for this ATN task')
  const result = await runReference({ policy: 'hub', task: task as TopologyTaskId, agents: limits.maxAgents,
    limits: topologyRuntimeConfig(limits), enforceSteps: true, maxActions: limits.maxCalls,
    recoveryMode: limits.recoveryMode })
  if (!result.delivered || result.issuedModelCalls !== 0 || !result.manipulation.valid) {
    throw new Error(`Reference gate refused model execution: ${result.failure ?? 'invalid reference manipulation'}`)
  }
  return result
}

export const PRIMARY_METRICS = ['answerPassRate', 'relativeMessages', 'relativePayloadBytes'] as const

export function relativeAtnMetrics(messages: number, payloadBytes: number, reference: { messages: number; maxContextBytes: number; payloadBytes: number }) {
  return { relativeMessages: messages / reference.messages,
    // Required design metric compares TOTAL wire bytes to MAX per-node reference context.
    relativePayloadBytes: payloadBytes / reference.maxContextBytes,
    relativeTotalPayloadBytes: payloadBytes / reference.payloadBytes,
    payloadDenominator: 'reference.maxContextBytes' as const }
}
