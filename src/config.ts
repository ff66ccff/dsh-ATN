/**
 * Deployment-varying bounds of the ATN runtime.
 *
 * Every bound is a Cordis `Config` field so a profile can change it without a
 * code change; the schema validates each field on its own and
 * {@link resolveLimits} validates the relations between fields. No bound is a
 * hardcoded constant in the runtime.
 * @module dsh-atn/config
 */
import z from '@deepseek-ai/schemastery'
import { ATN_DOMAIN_NAME, type NetworkLimits } from './schema.ts'

/** Plugin configuration of the ATN runtime service. */
export interface Config {
  /** Resident working nodes; `provisioning` and `draining` nodes still consume a slot. */
  maxResidentNodes: number
  /** Cumulative nodes ever created in one network. */
  maxTotalNodes: number
  /** Cumulative formal tasks in one network. */
  maxTasks: number
  /** Cumulative proposals in one network. */
  maxProposals: number
  /** Ordinary pending outbound mail per node; accepted tasks retain one result slot each. */
  maxPendingMailPerNode: number
  /** Ordinary retained mail allowance; at most maxTasks extra first-result settlement records. */
  maxRetainedMail: number
  /** Maximum UTF-8 bytes of one mail body, envelope included. */
  maxMessageBytes: number
  /** Maximum UTF-8 bytes of the goal document body. */
  maxDocumentBytes: number
  /** Default lease granted at creation, in milliseconds. */
  defaultLeaseMs: number
  /** Maximum single lease extension, in milliseconds. */
  maxLeaseExtensionMs: number
  /** Hard wall-clock deadline of a network, in milliseconds. */
  networkDeadlineMs: number
  /** Wall-clock deadline of one proposal, in milliseconds. */
  proposalDeadlineMs: number
  /** Admitted model-step budget per node, including the entry after network creation. */
  stepBudget: number
  /** Storage-domain name holding network records. */
  domainName: string
}

/** Validated plugin configuration. */
export const Config: z<Config> = z.object({
  maxResidentNodes: z.natural().default(8),
  maxTotalNodes: z.natural().default(32),
  maxTasks: z.natural().default(256),
  maxProposals: z.natural().default(64),
  maxPendingMailPerNode: z.natural().default(64),
  maxRetainedMail: z.natural().default(1024),
  maxMessageBytes: z.natural().default(8192),
  maxDocumentBytes: z.natural().default(8192),
  defaultLeaseMs: z.natural().default(5 * 60 * 1000),
  maxLeaseExtensionMs: z.natural().default(30 * 60 * 1000),
  networkDeadlineMs: z.natural().default(60 * 60 * 1000),
  proposalDeadlineMs: z.natural().default(2 * 60 * 1000),
  stepBudget: z.natural().default(64),
  domainName: z.string().default(ATN_DOMAIN_NAME),
})

/**
 * Reject a configuration whose individual fields are valid but whose relations
 * are not, at load time rather than at the first write.
 *
 * A count or a duration of `0` is not a bound the runtime could honour: it
 * would fail on the first write instead of at load, so it is rejected here. The
 * durable medium also restricts the domain name, so an illegal one fails now
 * rather than when the store is opened.
 *
 * @param config - Validated plugin configuration.
 * @throws Error naming the first broken relation, field or domain name.
 */
export function assertConfigRelations(config: Config): void {
  const problems: string[] = []
  const positive: [string, number][] = [
    ['maxResidentNodes', config.maxResidentNodes],
    ['maxTotalNodes', config.maxTotalNodes],
    ['maxTasks', config.maxTasks],
    ['maxProposals', config.maxProposals],
    ['maxPendingMailPerNode', config.maxPendingMailPerNode],
    ['maxRetainedMail', config.maxRetainedMail],
    ['maxMessageBytes', config.maxMessageBytes],
    ['maxDocumentBytes', config.maxDocumentBytes],
    ['defaultLeaseMs', config.defaultLeaseMs],
    ['maxLeaseExtensionMs', config.maxLeaseExtensionMs],
    ['networkDeadlineMs', config.networkDeadlineMs],
    ['proposalDeadlineMs', config.proposalDeadlineMs],
    ['stepBudget', config.stepBudget],
  ]
  for (const [field, value] of positive) {
    if (!Number.isInteger(value) || value <= 0) {
      problems.push(`${field} must be a positive integer, got ${String(value)}`)
    }
  }
  if (!/^[a-z][a-z0-9_]*$/.test(config.domainName)) {
    problems.push(`domainName must match [a-z][a-z0-9_]*, got "${config.domainName}"`)
  }
  if (config.maxTotalNodes < config.maxResidentNodes) {
    problems.push('maxTotalNodes must be at least maxResidentNodes')
  }
  if (config.maxLeaseExtensionMs < config.defaultLeaseMs) {
    problems.push('maxLeaseExtensionMs must be at least defaultLeaseMs')
  }
  if (config.networkDeadlineMs < config.defaultLeaseMs) {
    problems.push('networkDeadlineMs must be at least defaultLeaseMs')
  }
  if (config.proposalDeadlineMs > config.networkDeadlineMs) {
    problems.push('proposalDeadlineMs must not exceed networkDeadlineMs')
  }
  if (config.maxPendingMailPerNode > config.maxRetainedMail) {
    problems.push('maxPendingMailPerNode must not exceed maxRetainedMail')
  }
  if (problems.length > 0) {
    throw new Error(`dsh-atn configuration is inconsistent: ${problems.join('; ')}`)
  }
}

/**
 * Project a plugin configuration onto the bounds frozen into a new network.
 *
 * @param config - Validated plugin configuration.
 * @returns The bounds recorded in the network record.
 */
export function limitsFromConfig(config: Config): NetworkLimits {
  return {
    maxResidentNodes: config.maxResidentNodes,
    maxTotalNodes: config.maxTotalNodes,
    maxTasks: config.maxTasks,
    maxProposals: config.maxProposals,
    maxPendingMailPerNode: config.maxPendingMailPerNode,
    maxRetainedMail: config.maxRetainedMail,
    maxMessageBytes: config.maxMessageBytes,
    maxDocumentBytes: config.maxDocumentBytes,
    defaultLeaseMs: config.defaultLeaseMs,
    maxLeaseExtensionMs: config.maxLeaseExtensionMs,
    networkDeadlineMs: config.networkDeadlineMs,
    proposalDeadlineMs: config.proposalDeadlineMs,
    stepBudget: config.stepBudget,
  }
}

/**
 * Count the UTF-8 bytes of a string, matching what the durable medium stores.
 *
 * @param value - Text to measure.
 * @returns Byte length of the UTF-8 encoding.
 */
export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}
