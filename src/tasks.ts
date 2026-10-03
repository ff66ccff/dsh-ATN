/**
 * Local tasks: creation, holder-restricted settlement and the questions the
 * completion gate asks about them.
 *
 * A task is settled only by its holder, only once, and only through an explicit
 * result operation. An idle agent is not a completed task, and a reply message
 * is not a settlement.
 * @module dsh-atn/tasks
 */
import { allocateId, LimitExceededError, NetworkStoreError } from './domain.ts'
import type { NetworkRecord, TaskId, TaskRecord } from './schema.ts'

/** Input for creating one task. */
export interface CreateTaskInput {
  /** Node expected to settle the task. */
  readonly holderId: string
  /** Node requesting the work. */
  readonly requesterId: string
  /** What must be done. */
  readonly description: string
  /** Context supplied with the request. */
  readonly context: string
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
  if (Object.keys(record.tasks).length >= record.limits.maxTasks) {
    throw new LimitExceededError('maxTasks', `network ${record.id} already recorded ${record.limits.maxTasks} tasks`)
  }
  const allocated = input.id === undefined ? allocateId(record, 'task') : { id: input.id, next: record }
  const taskId = allocated.id
  const task: TaskRecord = {
    id: taskId,
    holderId: input.holderId,
    requesterId: input.requesterId,
    description: input.description,
    context: input.context,
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
    settledBy: byNodeId,
    settledAt: now,
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
    tasks: { ...record.tasks, [taskId]: { ...task, status: 'unreachable', settledAt: now } },
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
