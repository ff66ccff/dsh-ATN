/**
 * Record builders shared by the deterministic tests.
 *
 * Fixtures construct real `NetworkRecord` values, so a test failure names a
 * real stored field rather than a mock's stand-in.
 * @module dsh-atn/tests/fixtures
 */
import type { GoalRevision, NetworkLimits, NetworkRecord, NodeRecord, TaskRecord } from '../../src/schema.ts'
import { limitsFromConfig, Config as configSchema, type Config } from '../../src/config.ts'

/**
 * Resolve a plugin configuration with schema defaults applied.
 *
 * The Loader always hands the plugin a validated `Config`; tests build one from
 * partial input, and the cast is exactly the "defaults are filled in" step the
 * schema performs at runtime.
 *
 * @param overrides - Fields to replace on the default configuration.
 * @returns The resolved configuration.
 */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return configSchema(overrides as Config) as Config
}

/** Bounds used by fixtures when a test does not care about limits. */
export const testLimits: NetworkLimits = limitsFromConfig(testConfig())

/** Goal document used by fixtures. */
export const testGoal = {
  objective: 'Build the smallest verifiable thing.',
  successCriteria: 'The evidence can be re-run by a reviewer.',
  constraints: 'Do not call paid models; do not touch the user workspace.',
}

/**
 * Build one node record with explicit defaults.
 *
 * @param id - Node id.
 * @param overrides - Fields to replace on the default node.
 * @returns A complete node record.
 */
export function makeNode(id: string, overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    id,
    sessionId: `session-${id}`,
    creatorId: null,
    selectedChildId: null,
    lifecycle: 'active',
    leaseDeadlineAt: null,
    modelRoute: { provider: 'atn-test', model: 'deterministic', effort: null },
    presetId: null,
    permissionSeed: null,
    isEntry: false,
    creationState: 'published',
    note: null,
    createdAt: 0,
    ...overrides,
  }
}

/**
 * Build a linear network whose `selectedChildId` chain follows `ids`, with
 * `ids[0]` as the entry node.
 *
 * @param ids - Node ids in birth order.
 * @param overrides - Fields to replace on the default network.
 * @returns A complete network record.
 */
export function makeChain(ids: readonly string[], overrides: Partial<NetworkRecord> = {}): NetworkRecord {
  const nodes: Record<string, NodeRecord> = {}
  ids.forEach((id, index) => {
    nodes[id] = makeNode(id, {
      creatorId: index === 0 ? null : ids[index - 1]!,
      selectedChildId: index + 1 < ids.length ? ids[index + 1]! : null,
      isEntry: index === 0,
    })
  })
  const goal: GoalRevision = { version: 1, document: testGoal, proposedBy: null, approvedBy: [], committedAt: 0 }
  return {
    id: 'net-1',
    entrySessionId: 'session-entry',
    entryNodeId: ids[0] ?? 'A',
    status: 'open',
    limits: testLimits,
    goalHistory: [goal],
    stepsUsed: 0,
    nodes,
    tasks: {},
    mails: {},
    proposals: {},
    sequence: ids.length,
    createdAt: 0,
    deadlineAt: testLimits.networkDeadlineMs,
    note: null,
    ...overrides,
  }
}

/**
 * Build one task record.
 *
 * @param id - Task id.
 * @param overrides - Fields to replace on the default task.
 * @returns A complete task record.
 */
export function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    holderId: 'B',
    requesterId: 'A',
    description: 'Do the local thing.',
    context: '',
    status: 'open',
    result: null,
    settledBy: null,
    createdAt: 0,
    settledAt: null,
    ...overrides,
  }
}
