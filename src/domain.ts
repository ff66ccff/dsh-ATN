/**
 * Network records, their durable store, and the bounded accounting helpers the
 * runtime uses to decide whether an operation may proceed.
 *
 * The store interface is deliberately narrow: one network record is the atomic
 * unit, and `update` is an atomic read-modify-write so two concurrent mutations
 * can never interleave inside one network. The production implementation is
 * backed by `ctx.storageDomain`; tests use {@link MemoryNetworkStore}, a real
 * store with a controllable failure switch rather than a mock of the runtime.
 * @module dsh-atn/domain
 */
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { ATN_DOMAIN_VERSION, networkRecordSchema, type NetworkRecord, type NetworkLimits, type GoalDocument, type NodeRecord } from './schema.ts'

/** Raised when an operation would exceed a recorded bound. */
export class LimitExceededError extends Error {
  /** Name of the bound that was hit. */
  readonly bound: string

  /**
   * @param bound - Name of the recorded bound.
   * @param message - Human-readable detail.
   */
  constructor(bound: string, message: string) {
    super(message)
    this.name = 'LimitExceededError'
    this.bound = bound
  }
}

/** Raised when a network id does not exist or already exists, depending on the call. */
export class NetworkStoreError extends Error {
  /** Machine-readable cause. */
  readonly code: 'missing' | 'exists' | 'closed'

  /**
   * @param code - Machine-readable cause.
   * @param message - Human-readable detail.
   */
  constructor(code: 'missing' | 'exists' | 'closed', message: string) {
    super(message)
    this.name = 'NetworkStoreError'
    this.code = code
  }
}

/** Durable storage of network records, one record per network. */
export interface NetworkStore {
  /**
   * Read one network record.
   * @param id - Network id.
   * @returns The record, or `undefined` when the network is unknown.
   */
  load(id: string): Promise<NetworkRecord | undefined>
  /**
   * Insert the first record of a network.
   * @param record - Complete new record.
   * @returns Resolution after durability.
   */
  create(record: NetworkRecord): Promise<void>
  /**
   * Atomically replace one network record.
   * @param id - Network id.
   * @param fn - Synchronous pure transform from current to next record.
   * @returns The stored next record, after durability.
   */
  update(id: string, fn: (current: NetworkRecord) => NetworkRecord): Promise<NetworkRecord>
  /**
   * List known network ids.
   * @returns Every stored network id.
   */
  list(): Promise<string[]>
  /** Release the store's own resources. */
  close(): Promise<void>
}

/** Domain declaration holding network records. */
export function atnDomainSpec(domainName: string) {
  return defineDomain({
    name: domainName,
    version: ATN_DOMAIN_VERSION,
    tables: {
      networks: domainTable<string, NetworkRecord>(networkRecordSchema),
    },
  })
}

/** Store backed by a schema-validated `storageDomain` unit. */
export class DomainNetworkStore implements NetworkStore {
  private readonly table: ReturnType<Domain<ReturnType<typeof atnDomainSpec>>['table']>
  private closed = false

  /**
   * @param domain - An open domain produced from {@link atnDomainSpec}.
   */
  constructor(domain: Domain<ReturnType<typeof atnDomainSpec>>) {
    this.table = domain.table('networks')
  }

  /** @inheritdoc */
  async load(id: string): Promise<NetworkRecord | undefined> {
    this.assertOpen()
    return this.table.get(id)
  }

  /** @inheritdoc */
  async create(record: NetworkRecord): Promise<void> {
    this.assertOpen()
    if (this.table.get(record.id) !== undefined) {
      throw new NetworkStoreError('exists', `network ${record.id} already exists`)
    }
    await this.table.put(record.id, record)
  }

  /** @inheritdoc */
  async update(id: string, fn: (current: NetworkRecord) => NetworkRecord): Promise<NetworkRecord> {
    this.assertOpen()
    if (this.table.get(id) === undefined) {
      throw new NetworkStoreError('missing', `network ${id} does not exist`)
    }
    return this.table.update(id, fn)
  }

  /** @inheritdoc */
  async list(): Promise<string[]> {
    this.assertOpen()
    return [...this.table.keys()]
  }

  /** @inheritdoc */
  async close(): Promise<void> {
    this.closed = true
  }

  private assertOpen(): void {
    if (this.closed) throw new NetworkStoreError('closed', 'network store is closed')
  }
}

/**
 * In-process store used by tests. It performs the same atomic
 * read-modify-write as the durable store, so a test that injects a write
 * failure exercises the real ordering rather than a mock's shortcut.
 */
export class MemoryNetworkStore implements NetworkStore {
  private readonly records = new Map<string, NetworkRecord>()
  private closed = false

  /** When set, the next `update` rejects with this error instead of committing. */
  failNextUpdate: Error | null = null
  /** When set, the next `create` rejects with this error instead of committing. */
  failNextCreate: Error | null = null
  /**
   * Optional write hook: when it throws for a candidate record, that `update`
   * rejects instead of committing. It is how a test injects a failure at one
   * exact point in a multi-write operation.
   */
  updateHook: ((record: NetworkRecord) => void) | null = null
  /** Number of committed writes, for assertions about ordering. */
  writes = 0
  /** Number of update attempts, including the ones a hook rejected. */
  updateAttempts = 0

  /**
   * @param seed - Optional records to preload, keyed by network id.
   */
  constructor(seed: Iterable<NetworkRecord> = []) {
    for (const record of seed) this.records.set(record.id, record)
  }

  /** @inheritdoc */
  async load(id: string): Promise<NetworkRecord | undefined> {
    if (this.closed) throw new NetworkStoreError('closed', 'network store is closed')
    return this.records.get(id)
  }

  /** @inheritdoc */
  async create(record: NetworkRecord): Promise<void> {
    if (this.closed) throw new NetworkStoreError('closed', 'network store is closed')
    if (this.failNextCreate) {
      const failure = this.failNextCreate
      this.failNextCreate = null
      throw failure
    }
    if (this.records.has(record.id)) {
      throw new NetworkStoreError('exists', `network ${record.id} already exists`)
    }
    this.records.set(record.id, record)
    this.writes += 1
  }

  /** @inheritdoc */
  async update(id: string, fn: (current: NetworkRecord) => NetworkRecord): Promise<NetworkRecord> {
    if (this.closed) throw new NetworkStoreError('closed', 'network store is closed')
    this.updateAttempts += 1
    if (this.failNextUpdate) {
      const failure = this.failNextUpdate
      this.failNextUpdate = null
      throw failure
    }
    const current = this.records.get(id)
    if (current === undefined) throw new NetworkStoreError('missing', `network ${id} does not exist`)
    const next = fn(current)
    this.updateHook?.(next)
    this.records.set(id, next)
    this.writes += 1
    return next
  }

  /** @inheritdoc */
  async list(): Promise<string[]> {
    if (this.closed) throw new NetworkStoreError('closed', 'network store is closed')
    return [...this.records.keys()]
  }

  /** @inheritdoc */
  async close(): Promise<void> {
    this.closed = true
  }
}

/**
 * Allocate the next per-network record id.
 *
 * @param record - Current network record.
 * @param prefix - Human-readable prefix such as `node` or `task`.
 * @returns A fresh id and the network record with its counter advanced.
 */
export function allocateId(record: NetworkRecord, prefix: string): { id: string; next: NetworkRecord } {
  const id = `${prefix}-${record.sequence + 1}`
  return { id, next: { ...record, sequence: record.sequence + 1 } }
}

/**
 * Read the current committed goal revision.
 *
 * @param record - Current network record.
 * @returns The newest revision in the history.
 */
export function currentGoal(record: NetworkRecord): NetworkRecord['goalHistory'][number] {
  const revision = record.goalHistory[record.goalHistory.length - 1]
  if (revision === undefined) throw new Error(`network ${record.id} has no committed goal revision`)
  return revision
}

/**
 * Render the goal document into the short text every node reads.
 *
 * @param document - Committed goal document.
 * @returns A stable, replayable rendering.
 */
export function renderGoal(document: GoalDocument): string {
  return [
    `Objective: ${document.objective}`,
    `Success criteria: ${document.successCriteria}`,
    `Constraints: ${document.constraints}`,
  ].join('\n')
}

/**
 * Read the newest goal revision a node's live input was actually given.
 *
 * @param node - Node record.
 * @returns The recorded revision, or `0` when the node has never been synced.
 */
export function syncedGoalVersion(node: NodeRecord): number {
  return node.lastGoalVersionSent ?? 0
}

/** Live counts used by the bound checks. */
export interface Usage {
  /** Nodes in `provisioning`, `active` or `draining`. */
  readonly residentNodes: number
  /** Every node record ever created. */
  readonly totalNodes: number
  /** Every task record ever created. */
  readonly totalTasks: number
  /** Every proposal record ever created. */
  readonly totalProposals: number
  /** Every mail record ever created. */
  readonly totalMail: number
}

/**
 * Count current usage of one network.
 *
 * @param record - Current network record.
 * @returns Counts independent of any single operation.
 */
export function usageOf(record: NetworkRecord): Usage {
  const nodes = Object.values(record.nodes)
  return {
    residentNodes: nodes.filter((node) => node.lifecycle !== 'retired' && node.lifecycle !== 'failed').length,
    totalNodes: nodes.length,
    totalTasks: Object.keys(record.tasks).length,
    totalProposals: Object.keys(record.proposals).length,
    totalMail: Object.keys(record.mails).length,
  }
}

/**
 * Count a node's pending outbound mail.
 *
 * @param record - Current network record.
 * @param nodeId - Sending node.
 * @returns Number of `queued` mails still addressed from that node.
 */
export function pendingMailFor(record: NetworkRecord, nodeId: string): number {
  return Object.values(record.mails).filter((mail) => mail.fromId === nodeId && mail.status === 'queued').length
}

/**
 * Assert that adding one more node stays inside both the resident and
 * cumulative bounds.
 *
 * @param record - Current network record.
 * @param limits - Bounds frozen into the network.
 * @throws LimitExceededError naming the bound that was hit.
 */
export function assertNodeCapacity(record: NetworkRecord, limits: NetworkLimits): void {
  const usage = usageOf(record)
  if (usage.residentNodes >= limits.maxResidentNodes) {
    throw new LimitExceededError('maxResidentNodes', `network ${record.id} already holds ${usage.residentNodes} resident nodes`)
  }
  if (usage.totalNodes >= limits.maxTotalNodes) {
    throw new LimitExceededError('maxTotalNodes', `network ${record.id} already created ${usage.totalNodes} nodes`)
  }
}
