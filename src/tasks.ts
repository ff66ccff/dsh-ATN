/**
 * Local tasks: creation, holder-restricted settlement and the questions the
 * completion gate asks about them.
 *
 * A task is settled only by its holder, only once, and only through an explicit
 * result operation. An idle agent is not a completed task, and a reply message
 * is not a settlement.
 * @module dsh-atn/tasks
 */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { allocateId, currentGoal, LimitExceededError, NetworkStoreError } from './domain.ts'
import { taskAcceptanceSchema, type NetworkRecord, type TaskAcceptanceMetrics, type TaskId, type TaskRecord } from './schema.ts'

/** Input for creating one task. */
export interface CreateTaskInput {
  /** Runtime-owned delivery tasks use their bounded reserve; omission means work. */
  readonly kind?: 'work' | 'delivery'
  /** Node expected to settle the task. */
  readonly holderId: string
  /** Node requesting the work. */
  readonly requesterId: string
  /** What must be done. */
  readonly description: string
  /** Context supplied with the request. */
  readonly context: string
  /** Completed upstream submissions; optional host acceptance remains distinct. */
  readonly dependsOn?: readonly TaskId[]
  /** Failed attempt this task replaces; the original record is retained. */
  readonly retryOf?: TaskId | null
  /** Creation timestamp (epoch ms). */
  readonly now: number
  /** Stable id chosen by the caller; falls back to the network counter. */
  readonly id?: TaskId
}

/** A declared result. */
export interface TaskResultInput {
  /** What the holder claims to have done. */
  readonly summary: string
  /** Reviewable evidence references. */
  readonly evidence: readonly string[]
}

/** Why task references cannot be admitted. */
export type TaskReferenceErrorCode =
  | 'duplicate-id' | 'too-many-dependencies' | 'duplicate-dependency' | 'unknown-dependency'
  | 'unaccepted-dependency' | 'unknown-retry' | 'invalid-retry' | 'retry-requester' | 'retry-dependencies'

/** A dependency or retry would violate the immutable submitted-task DAG. */
export class TaskReferenceError extends Error {
  constructor(readonly code: TaskReferenceErrorCode, message: string) {
    super(message)
    this.name = 'TaskReferenceError'
  }
}

/**
 * Validate references before expensive provisioning, then again when committing
 * task creation. Only existing completed predecessors are admitted, so appending
 * a task cannot introduce a cycle. Retrying retains the original dependencies.
 */
export function assertTaskReferences(
  record: NetworkRecord,
  input: { dependsOn?: readonly TaskId[]; retryOf?: TaskId | null; requesterId?: string },
): { dependsOn: TaskId[]; retryOf: TaskId | null } {
  const retryOf = input.retryOf ?? null
  const previous = retryOf === null ? undefined : record.tasks[retryOf]
  if (retryOf !== null && previous === undefined) {
    throw new TaskReferenceError('unknown-retry', `retry task ${retryOf} does not exist`)
  }
  if (previous !== undefined) {
    const rejected = previous.status === 'completed' && previous.acceptance?.status === 'failed'
      && previous.acceptance.resultDigest === taskResultDigest(previous)
    if (previous.status !== 'failed' && previous.status !== 'unreachable' && !rejected) {
      throw new TaskReferenceError('invalid-retry', `task ${previous.id} has no recorded failure to retry`)
    }
    if (input.requesterId !== undefined && input.requesterId !== previous.requesterId) {
      throw new TaskReferenceError('retry-requester', `only requester ${previous.requesterId} can retry task ${previous.id}`)
    }
  }
  const dependsOn = [...(input.dependsOn ?? previous?.dependsOn ?? [])]
  if (dependsOn.length > 16) throw new TaskReferenceError('too-many-dependencies', 'a task can depend on at most 16 tasks')
  if (new Set(dependsOn).size !== dependsOn.length) {
    throw new TaskReferenceError('duplicate-dependency', 'task dependencies must be unique')
  }
  if (previous?.dependsOn?.some((id) => !dependsOn.includes(id))) {
    throw new TaskReferenceError('retry-dependencies', `retry of ${previous.id} must retain its upstream dependencies`)
  }
  for (const id of dependsOn) {
    const upstream = record.tasks[id]
    if (upstream === undefined) throw new TaskReferenceError('unknown-dependency', `upstream task ${id} does not exist`)
    if (upstream.status !== 'completed' || (upstream.acceptance != null && !isTaskAccepted(upstream))) {
      throw new TaskReferenceError('unaccepted-dependency', `upstream task ${id} is unfinished, rejected, or has stale host acceptance`)
    }
  }
  return { dependsOn, retryOf }
}

/**
 * Create one formal task.
 *
 * @param record - Current network record.
 * @param input - Holder, requester and description.
 * @returns The updated record and the new task id.
 * @throws LimitExceededError when the cumulative task bound is reached.
 * @throws NetworkStoreError when the holder is not part of the network.
 */
export function createTask(record: NetworkRecord, input: CreateTaskInput): { record: NetworkRecord; taskId: TaskId } {
  if (record.nodes[input.holderId] === undefined) {
    throw new NetworkStoreError('missing', `task holder ${input.holderId} is not part of network ${record.id}`)
  }
  if (record.nodes[input.requesterId] === undefined) {
    throw new NetworkStoreError('missing', `task requester ${input.requesterId} is not part of network ${record.id}`)
  }
  const references = assertTaskReferences(record, input)
  const kind = input.kind ?? 'work'
  const recorded = Object.values(record.tasks).filter(task => (task.kind ?? 'work') === kind).length
  const bound = kind === 'delivery' ? record.limits.maxTotalNodes : record.limits.maxTasks
  if (recorded >= bound) {
    throw new LimitExceededError(kind === 'delivery' ? 'maxDeliveryTasks' : 'maxTasks',
      `network ${record.id} already recorded ${bound} ${kind} tasks`)
  }
  const allocated = input.id === undefined ? allocateId(record, 'task') : { id: input.id, next: record }
  const taskId = allocated.id
  if (record.tasks[taskId] !== undefined) {
    throw new TaskReferenceError('duplicate-id', `task ${taskId} already exists and cannot be replaced`)
  }
  const task: TaskRecord = {
    id: taskId,
    ...(input.kind === undefined ? {} : { kind }),
    holderId: input.holderId,
    requesterId: input.requesterId,
    description: input.description,
    context: input.context,
    ...references,
    acceptance: null,
    holderStepsAtCreation: record.nodes[input.holderId]!.stepsUsed ?? 0,
    status: 'open',
    result: null,
    settledBy: null,
    createdAt: input.now,
    settledAt: null,
  }
  return { record: { ...allocated.next, tasks: { ...allocated.next.tasks, [taskId]: task } }, taskId }
}

/** Raised when a caller tries to settle a task it does not hold, or settles twice. */
export class TaskSettlementError extends Error {
  /** Machine-readable cause. */
  readonly code: 'unknown-task' | 'not-holder' | 'already-settled' | 'not-open'

  /**
   * @param code - Machine-readable cause.
   * @param message - Human-readable detail.
   */
  constructor(code: 'unknown-task' | 'not-holder' | 'already-settled' | 'not-open', message: string) {
    super(message)
    this.name = 'TaskSettlementError'
    this.code = code
  }
}

/**
 * Settle one task from an explicit result operation.
 *
 * @param record - Current network record.
 * @param taskId - Task to settle.
 * @param byNodeId - Real caller identity, resolved from the live agent.
 * @param result - Declared result and evidence.
 * @param now - Settlement timestamp (epoch ms).
 * @param failed - When true the task is recorded as failed rather than completed.
 * @returns The updated record and the settled task.
 * @throws TaskSettlementError when the caller is not the holder or the task is already settled.
 */
export function settleTask(
  record: NetworkRecord,
  taskId: TaskId,
  byNodeId: string,
  result: TaskResultInput,
  now: number,
  failed = false,
): { record: NetworkRecord; task: TaskRecord } {
  const task = record.tasks[taskId]
  if (task === undefined) throw new TaskSettlementError('unknown-task', `task ${taskId} is not part of network ${record.id}`)
  if (task.holderId !== byNodeId) {
    throw new TaskSettlementError('not-holder', `node ${byNodeId} does not hold task ${taskId}, held by ${task.holderId}`)
  }
  if (task.status !== 'open') {
    throw new TaskSettlementError(
      task.status === 'completed' ? 'already-settled' : 'not-open',
      `task ${taskId} is already ${task.status}`,
    )
  }
  const settled: TaskRecord = {
    ...task,
    status: failed ? 'failed' : 'completed',
    result: { summary: result.summary, evidence: [...result.evidence] },
    acceptance: null,
    settledBy: byNodeId,
    settledAt: now,
    holderStepsAtSettlement: record.nodes[task.holderId]?.stepsUsed ?? 0,
  }
  return { record: { ...record, tasks: { ...record.tasks, [taskId]: settled } }, task: settled }
}

/**
 * Mark a task whose request can no longer be honoured as unreachable while
 * keeping the holder's work and evidence intact.
 *
 * @param record - Current network record.
 * @param taskId - Task to mark.
 * @param note - Why the requester can no longer receive the result.
 * @param now - Settlement timestamp (epoch ms).
 * @returns The updated record.
 */
export function markTaskUnreachable(record: NetworkRecord, taskId: TaskId, note: string, now: number): NetworkRecord {
  const task = record.tasks[taskId]
  if (task === undefined || task.status !== 'open') return record
  return {
    ...record,
    tasks: { ...record.tasks, [taskId]: { ...task, status: 'unreachable', settledAt: now,
      holderStepsAtSettlement: record.nodes[task.holderId]?.stepsUsed ?? 0 } },
    note,
  }
}

/**
 * Count tasks that still block network completion.
 *
 * @param record - Current network record.
 * @returns Open tasks, in creation order.
 */
export function openTasks(record: NetworkRecord): TaskRecord[] {
  return Object.values(record.tasks)
    .filter((task) => task.status === 'open')
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

/**
 * Count the open tasks one node still holds.
 *
 * @param record - Current network record.
 * @param nodeId - Holder.
 * @returns Open tasks held by that node.
 */
export function openTasksOf(record: NetworkRecord, nodeId: string): TaskRecord[] {
  return openTasks(record).filter((task) => task.holderId === nodeId)
}

/** Failed work with no surviving holder or replacement can be reclaimed locally. */
export function orphanTasks(record: NetworkRecord): TaskRecord[] {
  const retried = new Set(Object.values(record.tasks).flatMap(task => task.retryOf ? [task.retryOf] : []))
  return Object.values(record.tasks).filter(task => {
    const holder = record.nodes[task.holderId]
    return (task.status === 'failed' || task.status === 'unreachable') && !retried.has(task.id)
      && (holder === undefined || holder.lifecycle === 'failed' || holder.lifecycle === 'retired')
  }).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

/** One authority rule shared by runtime completion and host submission gates. */
export function deliveryHolderOf(record: NetworkRecord): string | null {
  if (record.status !== 'open') return null
  const eligible = (id: string): boolean => {
    const node = record.nodes[id]
    return node !== undefined && node.creationState === 'published'
      && (node.lifecycle === 'active' || node.lifecycle === 'draining')
  }
  if (eligible(record.entryNodeId)) return record.entryNodeId
  const retried = new Set(Object.values(record.tasks).flatMap(task => task.retryOf ? [task.retryOf] : []))
  const delivery = Object.values(record.tasks).find(task => task.kind === 'delivery'
    && task.status === 'open' && !retried.has(task.id) && eligible(task.holderId))
  return delivery?.holderId ?? null
}

/** Materialize the entry's implicit obligation once, in its retirement write. */
export function materializeDeliveryTask(record: NetworkRecord, now: number): NetworkRecord {
  const entry = record.nodes[record.entryNodeId]
  if (record.status !== 'open' || entry === undefined
    || (entry.lifecycle !== 'retired' && entry.lifecycle !== 'failed')
    || Object.values(record.tasks).some(task => task.kind === 'delivery')) return record
  const goal = currentGoal(record)
  const created = createTask(record, {
    kind: 'delivery', holderId: entry.id, requesterId: entry.id,
    description: `Deliver the network result: ${goal.document.objective}`,
    context: `Success criteria: ${goal.document.successCriteria}\nClaim this delivery obligation, then use atn_finish with scope=network, the current goalVersion, summary and evidence. Complete other work first; only successful network delivery settles this obligation.`,
    now,
  })
  return markTaskUnreachable(created.record, created.taskId, 'Delivery entry is no longer available.', now)
}

/** Independent host checks; model-supplied summaries and peer votes are inputs, never verdicts. */
export interface TaskValidationOutcome {
  readonly passed: boolean
  readonly summary: string
  readonly evidence: readonly string[]
  readonly metrics?: TaskAcceptanceMetrics
}

/**
 * Trusted host capability, never a model-tool argument. The synchronous pure
 * callback verifies the immutable submission and returns null if inapplicable.
 * Validator identities should include the policy/version used for checking.
 */
export interface TaskValidator {
  readonly id: string
  validate(task: Readonly<TaskRecord>): TaskValidationOutcome | null
}

/** A host verification request cannot be applied to this submission. */
export class TaskAcceptanceError extends Error {
  constructor(
    readonly code: 'unknown-task' | 'not-submitted' | 'already-validated' | 'invalid-time' | 'invalid-verdict',
    message: string,
  ) {
    super(message)
    this.name = 'TaskAcceptanceError'
  }
}

/** Bind verification to the exact task contract, dependency list and submitted result. */
export function taskResultDigest(task: TaskRecord): string {
  const snapshot = [
    task.id, task.holderId, task.requesterId, task.description, task.context,
    task.dependsOn ?? [], task.retryOf ?? null, task.createdAt,
    task.status, task.result === null ? null : [task.result.summary, task.result.evidence],
    task.settledBy, task.settledAt,
    ...(task.kind === 'delivery' ? ['delivery'] : []),
  ]
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

/** True only for an unchanged submission explicitly accepted by the host. */
export function isTaskAccepted(task: TaskRecord): boolean {
  return task.status === 'completed' && task.result !== null
    && task.acceptance?.status === 'passed' && task.acceptance.resultDigest === taskResultDigest(task)
}

/** Accepted immutable upstream facts, in creation order. Legacy completed tasks are excluded. */
export function acceptedTasks(record: NetworkRecord): TaskRecord[] {
  return Object.values(record.tasks).filter(isTaskAccepted)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

/** Freeze a cloned validator input so a checking bug cannot rewrite the task or result. */
function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Run an independent host validator and record its single immutable verdict.
 * This function must only be called through a trusted host API. No node id,
 * peer vote, self-reported passed flag or textual claim grants that capability.
 * Exceptions and inapplicable validators leave the input record unchanged.
 * A rejected attempt must be retried under a new task id, preserving provenance.
 */
export function validateTaskResult(
  record: NetworkRecord,
  taskId: TaskId,
  validator: TaskValidator,
  now: number,
): { record: NetworkRecord; task: TaskRecord } {
  const task = record.tasks[taskId]
  if (task === undefined) throw new TaskAcceptanceError('unknown-task', `task ${taskId} does not exist`)
  if (task.status !== 'completed' || task.result === null || task.settledAt === null) {
    throw new TaskAcceptanceError('not-submitted', `task ${taskId} has no completed submission to verify`)
  }
  if (task.acceptance !== undefined && task.acceptance !== null) {
    throw new TaskAcceptanceError('already-validated', `task ${taskId} already has an immutable acceptance verdict`)
  }
  if (!Number.isSafeInteger(now) || now < task.settledAt) {
    throw new TaskAcceptanceError('invalid-time', 'acceptance must occur at or after the submission timestamp')
  }
  const resultDigest = taskResultDigest(task)
  const outcome = validator.validate(freezeSnapshot(structuredClone(task)))
  if (outcome === null) return { record, task }
  // Validate a boolean explicitly; a truthy string or a Promise is never a pass.
  if (typeof outcome?.passed !== 'boolean') {
    throw new TaskAcceptanceError('invalid-verdict', 'the host validator must return a boolean passed value')
  }
  const acceptance = taskAcceptanceSchema.parse({
    status: outcome.passed ? 'passed' : 'failed',
    validatorId: validator.id,
    summary: outcome.summary,
    evidence: outcome.evidence,
    resultDigest,
    checkedAt: now,
    ...(outcome.metrics === undefined ? {} : { metrics: outcome.metrics }),
  })
  const accepted: TaskRecord = { ...task, acceptance }
  return { record: { ...record, tasks: { ...record.tasks, [taskId]: accepted } }, task: accepted }
}

/**
 * Build a host-only exact JSON oracle for selected task ids. Expected values
 * are snapshotted into the closure, never persisted in tasks or model inputs.
 * Object key order is ignored; array order, value types and extra keys matter.
 * This validates only the supplied JSON contract, not arbitrary evidence paths.
 */
export function createExactJsonValidator(id: string, expectedByTaskId: Readonly<Record<TaskId, unknown>>): TaskValidator {
  const validatorId = z.string().trim().min(1).parse(id)
  const expected = structuredClone(z.record(z.string(), z.json()).parse(expectedByTaskId))
  return {
    id: validatorId,
    validate(task) {
      if (!Object.hasOwn(expected, task.id)) return null
      let passed = false
      try {
        passed = task.result !== null && isDeepStrictEqual(JSON.parse(task.result.summary), expected[task.id])
      } catch {
        // Invalid JSON is a rejected submission, not a crashing validator.
      }
      return {
        passed,
        summary: passed ? 'Submitted JSON matches the host contract.' : 'Submitted JSON does not match the host contract.',
        evidence: [`validator:${validatorId}:task:${task.id}`],
      }
    },
  }
}
