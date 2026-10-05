/** Distributed, changing inputs for a topology experiment; no expected answers. */
export const TOPOLOGY_TASK_IDS = ['shift-ledger-1', 'shift-ledger-2'] as const
export type TopologyTaskId = typeof TOPOLOGY_TASK_IDS[number]
export type RecoveryMode = 'self-organized' | 'preassigned-backup'
export const MIN_TOPOLOGY_AGENTS = 8
export const MAX_TOPOLOGY_AGENTS = 16
export const ACCOUNTS = ['A', 'B', 'C', 'D'] as const

export interface LedgerEntry { id: string; account: typeof ACCOUNTS[number]; amount: number }
export interface LedgerShard {
  slot: number
  initial: LedgerEntry[]
  correction: { remove: string; move: { id: string; account: typeof ACCOUNTS[number] }; add: LedgerEntry[] }
}
export interface TopologyTask {
  id: TopologyTaskId
  revision: 1
  agents: number
  failedSlot: number
  backupSlot: number
  shards: LedgerShard[]
}

export function isTopologyTask(id: string): id is TopologyTaskId {
  return (TOPOLOGY_TASK_IDS as readonly string[]).includes(id)
}

/** Fixed fixtures are independent of model, execution order, and ATN mode. */
export function getTopologyTask(id: TopologyTaskId, agents: number): TopologyTask {
  if (!isTopologyTask(id)) throw new Error(`Unknown topology task: ${String(id)}`)
  if (!Number.isInteger(agents) || agents < MIN_TOPOLOGY_AGENTS || agents > MAX_TOPOLOGY_AGENTS) {
    throw new Error(`Topology tasks require ${MIN_TOPOLOGY_AGENTS}–${MAX_TOPOLOGY_AGENTS} agents`)
  }
  const seed = id === 'shift-ledger-1' ? 7 : 19
  const shards = Array.from({ length: agents }, (_, slot): LedgerShard => ({
    slot,
    initial: Array.from({ length: 12 }, (_, index) => ({
      id: `s${slot}-e${index}`, account: ACCOUNTS[(slot + index + seed) % ACCOUNTS.length],
      amount: (index % 5 === 4 ? -1 : 1) * (11 + (seed * (slot + 3) + index * 17) % 113),
    })),
    correction: {
      remove: `s${slot}-e3`, move: { id: `s${slot}-e8`, account: ACCOUNTS[(slot + seed + 1) % ACCOUNTS.length] },
      add: [
        { id: `s${slot}-late0`, account: ACCOUNTS[(slot + seed + 2) % ACCOUNTS.length], amount: 31 + slot * 7 },
        { id: `s${slot}-late1`, account: ACCOUNTS[(slot + seed) % ACCOUNTS.length], amount: -(13 + slot * 3) },
      ],
    },
  }))
  return { id, revision: 1, agents, failedSlot: agents - 1, backupSlot: 1, shards }
}

/** Only the contract is shared. Shard payloads NEVER appear in the common prompt. */
export function renderTopologyPrompt(task: TopologyTask, recoveryMode: RecoveryMode = 'self-organized'): string {
  return [
    `Distributed ledger ${task.id}, revision ${task.revision}; ${task.agents} evidence holders. The ATN network is already started and provisioned.`,
    'All nodes have the same objective: reconcile the final ledger. Choose your own collaborators, aggregation method and division of work. Each node must inspect its own evidence. The current delivery holder submits the final artifact; if that holder retires, another idle node can claim the orphan delivery obligation with atn_status.',
    'Call read_document with id="mine" to discover your slot, phase and currently accessible document ids. Reading is enforced by the host ACL. Send only the four account subtotals for your slots and the number of applied entries, with slot provenance for deduplication. Do not send raw entries. Exchange subtotals using ATN. No node begins with every shard.',
    `In phase 1, initial-N contains signed credit entries. After all initial shards have been read, the host publishes phase 2 and disables one worker. ${recoveryMode === 'preassigned-backup'
      ? `This separate preassigned-backup control arm grants slot ${task.backupSlot} the failed slot's evidence.`
      : 'No backup is preassigned. An idle node must discover the concrete orphan recovery task with atn_status and claim it; a successful claim grants the document ACL. Settle current work before claiming, then call read_document("mine") again.'} Keep the network open until phase 2; a phase 1 total is provisional.`,
    'In phase 2, correction-N removes the named entry entirely, replaces only the account of the named moved entry, and adds the supplied new entries. Corrections apply once to initial-N. Sum signed amounts by account across all shards, including zeros. Collect revised contributions; old totals may be wrong.',
    'Only submit after phase 2. Return exactly one JSON object: {"phase":2,"netByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"evidence":[document-id]}. Evidence must list initial-N and correction-N for every slot once, with no duplicates.',
  ].join('\n\n')
}

export interface TopologySample { nodes: number; maxPeers: number; minPeers: number; reachableFromEntry: number }

/** Host-side ACL and deterministic logical event schedule, with no model calls. */
export class TopologyScenario {
  readonly task: TopologyTask
  readonly recoveryMode: RecoveryMode
  private readonly slots = new Map<string, number>()
  private readonly initialRead = new Set<number>()
  private readonly correctedRead = new Set<number>()
  private readonly backupRead = new Set<string>()
  private phase: 1 | 2 = 1
  private initialTopology?: TopologySample
  private failedSession?: string
  private failureWasActive = false
  private failureConfirmed = false
  private deniedReads = 0
  private readonly recoveryGrants = new Map<string, Set<number>>()
  private readonly recoveryTasks = new Map<string, number>()

  constructor(task: TopologyTask, options: { recoveryMode?: RecoveryMode } = {}) {
    this.task = structuredClone(task)
    this.recoveryMode = options.recoveryMode ?? 'self-organized'
  }

  /** IDs come only from the host runtime API, never model-authored descriptions. */
  registerRecoveryTask(taskId: string, slot: number): void {
    if (slot !== this.task.failedSlot) throw new Error('Recovery task must name the failed slot')
    this.recoveryTasks.set(taskId, slot)
  }

  recoverySlot(taskId: string): number | undefined { return this.recoveryTasks.get(taskId) }

  /** Host-only grant after a committed claim. A later claimant replaces the old grant. */
  authorizeRecovery(sessionId: string, slot: number): void {
    if (!this.slots.has(sessionId) || sessionId === this.failedSession || slot !== this.task.failedSlot) {
      throw new Error('Invalid recovery authorization')
    }
    for (const slots of this.recoveryGrants.values()) slots.delete(slot)
    const slots = this.recoveryGrants.get(sessionId) ?? new Set<number>()
    slots.add(slot)
    this.recoveryGrants.set(sessionId, slots)
  }

  evidenceIds(): string[] {
    return Array.from({ length: this.task.agents }, (_, slot) => [`initial-${slot}`, `correction-${slot}`]).flat()
  }

  register(sessionId: string): number {
    const existing = this.slots.get(sessionId)
    if (existing !== undefined) return existing
    if (this.slots.size >= this.task.agents) throw new Error('Topology scenario has no additional evidence slots')
    const slot = this.slots.size
    this.slots.set(sessionId, slot)
    return slot
  }

  sessionAt(slot: number): string {
    const match = [...this.slots].find(([, candidate]) => candidate === slot)
    if (!match) throw new Error('Topology scenario slot not provisioned')
    return match[0]
  }

  recordInitialTopology(sample: TopologySample): void { this.initialTopology = { ...sample } }

  get readyForPhaseChange(): boolean { return this.phase === 1 && this.initialRead.size === this.task.agents }

  /** Call only after the host has completed runtime failure injection. */
  advancePhase(failure: { wasActive: boolean; confirmed: boolean }): void {
    if (!this.readyForPhaseChange) throw new Error('Phase 2 requires all initial evidence reads')
    this.failedSession = this.sessionAt(this.task.failedSlot)
    this.failureWasActive = failure.wasActive
    this.failureConfirmed = failure.confirmed
    this.phase = 2
  }

  read(sessionId: string, id: string): unknown {
    const slot = this.slots.get(sessionId)
    if (slot === undefined || sessionId === this.failedSession) { this.deniedReads++; throw new Error('Evidence access denied') }
    const recovered = this.phase === 2 ? [...this.recoveryGrants.get(sessionId) ?? []] : []
    if (this.phase === 2 && this.recoveryMode === 'preassigned-backup' && slot === this.task.backupSlot) recovered.push(this.task.failedSlot)
    const owned = [...new Set([slot, ...recovered])]
    if (id === 'mine') return { slot, phase: this.phase,
      documents: owned.flatMap(owner => [`initial-${owner}`, ...(this.phase === 2 ? [`correction-${owner}`] : [])]) }
    const match = /^(initial|correction)-(\d+)$/.exec(id)
    const owner = match ? Number(match[2]) : -1
    if (!match || !owned.includes(owner) || (match[1] === 'correction' && this.phase !== 2)) {
      this.deniedReads++; throw new Error('Evidence access denied or document not yet released')
    }
    if (match[1] === 'initial') this.initialRead.add(owner)
    else this.correctedRead.add(owner)
    if (owner === this.task.failedSlot && owner !== slot) this.backupRead.add(match[1])
    return { id, phase: this.phase, data: structuredClone(match[1] === 'initial'
      ? this.task.shards[owner].initial : this.task.shards[owner].correction) }
  }

  snapshot() {
    const checks = {
      enoughNodes: this.slots.size >= MIN_TOPOLOGY_AGENTS && this.initialTopology?.nodes === this.task.agents,
      sparseTopology: !!this.initialTopology && this.initialTopology.maxPeers < this.task.agents - 1,
      initialGraphReachable: this.initialTopology?.reachableFromEntry === this.task.agents,
      distributedInitialReads: this.initialRead.size === this.task.agents,
      phaseChanged: this.phase === 2,
      activeWorkerFailed: this.failureWasActive && this.failureConfirmed,
    }
    return { phase: this.phase, checks, valid: Object.values(checks).every(Boolean), causalClaim: false,
      outcomeChecks: { revisedEvidenceRead: this.correctedRead.size === this.task.agents, failedShardRecovered: this.backupRead.size === 2 },
      initialTopology: this.initialTopology ?? null, registeredNodes: this.slots.size,
      initialShardsRead: this.initialRead.size, correctionShardsRead: this.correctedRead.size,
      failedSlot: this.task.failedSlot, recoveryMode: this.recoveryMode,
      backupSlot: this.recoveryMode === 'preassigned-backup' ? this.task.backupSlot : null, deniedReads: this.deniedReads }
  }
}
