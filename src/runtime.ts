/**
 * The ATN runtime service: network ownership, node creation and recovery,
 * durable delivery, automated lifecycle and the host-facing stop entry.
 *
 * Every network is a single atomic persistence unit, so every network write
 * goes through one per-network mutation queue: the read, the bound checks, id
 * allocation, the business transform and the store write all happen inside one
 * critical section, and the store's `update` callback always receives the
 * latest record. That is what makes concurrent spawn, send, proposal, vote and
 * step admission lose neither nodes nor votes nor budget.
 *
 * The runtime captures the plugin's own context as the stable owner of every
 * ATN-created Agent. Tool handlers and lifecycle callbacks never become the
 * resource owner, so releasing a creator cannot take its independent
 * descendants with it, and a tool call can never outlive its own stack.
 * @module dsh-atn/runtime
 */
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { captureDelegatedPolicyOverrides, appendDelegatedPolicyOverrides } from '@deepseek-ai/dsh-subagent'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Config as AtnConfig, limitsFromConfig, utf8Bytes, type Config } from './config.ts'
import {
  allocateId,
  assertNodeCapacity,
  currentGoal,
  DomainNetworkStore,
  LimitExceededError,
  pendingMailFor,
  type NetworkStore,
} from './domain.ts'
import { enqueueMail, markDelivered, markUndeliverable, pendingMails, MailIdentityError, type EnqueueInput } from './mailbox.ts'
import { collaborationPeers, collaborationPeerLimit, connectPublishedNode, reconcileTopology, rewireNode } from './topology.ts'
import {
  canRelease,
  failProvisioning,
  findBySession,
  markGoalSynced,
  planRecovery,
  publishNode,
  requestDrain,
  retireSettledNodes,
} from './lifecycle.ts'
import { cancelPendingProposals, castVote, expireProposals, openProposal, type CastVoteResult } from './proposals.ts'
import { assertTaskReferences, createTask, deliveryHolderOf, markTaskUnreachable, materializeDeliveryTask, openTasks, orphanTasks, settleTask, validateTaskResult, type TaskValidator } from './tasks.ts'
import { goalSnapshotMessage, mailMessage, proposalMessage, taskMessage } from './messages.ts'
import { topologyFeedbackMessage } from './topology-feedback.ts'
import { summarizeLocalFeedback, captureRewireObservations, refreshRewireObservations } from './local-feedback.ts'
import { evaluateRewireEvidence, summarizeVerifiedFeedback, type RewireEvaluation } from './verified-feedback.ts'
import { recordRequesterFeedback, summarizeRequesterFeedback, evaluateRequesterRewireEvidence, evaluateCumulativeRequesterRewire, refreshRequesterRewireEvidence, selectRequesterRewireSamples, type RequesterFeedbackInput } from './requester-feedback.ts'
import { summarizeKnowledge, scoreKnowledgeQuery, refreshKnowledge } from './knowledge.ts'
import { AtnRefusal } from './refusal.ts'
import { assertSynchronousAdmission, type NetworkOutboundPolicy, type OutboundOperation } from './information-boundary.ts'
export { AtnRefusal } from './refusal.ts'
import type { GoalDocument, NetworkRecord, NodeRecord, TaskRecord } from './schema.ts'
import { HandleReleaser, waitBounded, type HandleReleaseOutcome } from './handles.ts'
import { randomUUID } from 'node:crypto'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The mounted ATN runtime. */
    atn: AtnRuntime
  }
  interface Events {
    /** Durable claim committed; host authorization finishes before mail can wake the holder. */
    'atn/task-claimed'(payload: TaskClaimedEvent): void
  }
}

/** Trusted host notification; task identities come from the committed network. */
export interface TaskClaimedEvent {
  readonly networkId: string
  readonly sourceTask: TaskRecord
  readonly task: TaskRecord
  readonly sessionId: string
  readonly at: number
}

/** Public input of `atn_start`. */
export interface StartInput {
  /** Short overall objective. */
  readonly objective: string
  /** How the network decides the objective is met. */
  readonly successCriteria: string
  /** Constraints every node must respect. */
  readonly constraints: string
}

/** Public result of `atn_start`. */
export interface StartResult {
  /** Stable network id. */
  readonly networkId: string
  /** Entry node id, backed by the calling session. */
  readonly nodeId: string
  /** The initial local task the entry node holds. */
  readonly taskId: string
  /** Committed goal version. */
  readonly goalVersion: number
  /** Goal deadline (epoch ms). */
  readonly deadlineAt: number
}

/** Public input of `atn_spawn`. */
export interface SpawnInput {
  /** Local task for the new node. */
  readonly task: string
  /** Necessary local context. */
  readonly context: string
  /** Optional requested lease in milliseconds. */
  readonly leaseMs?: number
  /** Completed upstream submissions required by this task; host verification is optional. */
  readonly dependsOn?: readonly string[]
  /** Failed attempt this task replaces; history remains intact. */
  readonly retryOf?: string
}

/** Public result of `atn_spawn`. */
export interface SpawnResult {
  /** New node id. */
  readonly nodeId: string
  /** Session backing the new node. */
  readonly sessionId: string
  /** The initial task assigned to it. */
  readonly taskId: string
  /** Neighbourhood the new node could be reached through. */
  readonly neighbours: string[]
}

/** Public input of `atn_send`. */
export interface SendInput {
  /** Target node id. */
  readonly to: string
  /** Mail kind. */
  readonly kind: 'task' | 'note' | 'result'
  /** Body text. */
  readonly body: string
  /** Task this mail relates to; required to settle a task. */
  readonly taskId?: string
  /** Result outcome; defaults to `completed` and is only valid for `kind: result`. */
  readonly outcome?: 'completed' | 'failed'
  /** Short result summary, required for `kind: result`. */
  readonly summary?: string
  /** Evidence references, required for `kind: result`. */
  readonly evidence?: readonly string[]
  /** Stable id chosen by the caller so a model retry is idempotent. */
  readonly messageId?: string
  /** Only for kind=task: completed upstream submissions without host rejection. */
  readonly dependsOn?: readonly string[]
  /** Only for kind=task: failed attempt replaced by the new task. */
  readonly retryOf?: string
}

/** Public result of `atn_send`. */
export interface SendResult {
  /** Committed mail id. */
  readonly mailId: string
  /** Whether the mail was already present under that id. */
  readonly duplicate: boolean
  /** Delivery state observed immediately after the durable enqueue. */
  readonly delivery: 'delivered' | 'queued' | 'undeliverable'
  /** Task settled by a result mail, when applicable. */
  readonly settledTaskId: string | null
  /** Recorded outcome when this mail settles a task. */
  readonly outcome?: 'completed' | 'failed'
}

/** Bounded observations a node can use to choose collaborators. */
export interface PeerSummary {
  readonly id: string
  readonly lifecycle: string
  readonly openTasks: number
  readonly pendingVotes: number
  readonly taskSummaries: readonly string[]
  /** Recent terminal task summaries prefixed with their explicit status. */
  readonly recentResults: readonly string[]
  /** Independent validation observations, kept separate from self-reported outcomes. */
  readonly verifiedFeedback: ReturnType<typeof summarizeVerifiedFeedback>
  /** Requester judgements are local signals, not independent verification. */
  readonly requesterFeedback: ReturnType<typeof summarizeRequesterFeedback>
  readonly knowledgeFingerprint: ReturnType<typeof summarizeKnowledge>
  readonly telemetry: ReturnType<typeof summarizeLocalFeedback>
}

/** Public result of `atn_peers`. */
export interface PeersResult {
  /** Calling node. */
  readonly self: string
  /** Up to four active collaborators chosen by this node. */
  readonly neighbours: readonly string[]
  /** Bounded per-node summaries. */
  readonly nodes: readonly PeerSummary[]
  /** Candidates returned by an explicit query, when one was supplied. */
  readonly candidates?: readonly string[]
  /** The same bounded observations for discovery candidates. */
  readonly candidateNodes?: readonly PeerSummary[]
}

/** One local inspection, optionally claiming abandoned work atomically. */
export interface StatusInput {
  readonly query?: string
  readonly taskIds?: readonly string[]
  readonly claimTaskId?: string
  readonly review?: RequesterFeedbackInput
  readonly rewire?: RewireInput
}

/** Atomically replace the calling node's directed collaboration neighbourhood. */
export interface RewireInput {
  readonly peers: readonly string[]
  readonly intent?: 'exploration' | 'verified-improvement'
  readonly baselineTaskIds?: readonly string[]
  readonly candidateTaskIds?: readonly string[]
}

/** The neighbourhood committed by the rewire option of `atn_status`. */
export interface RewireResult {
  readonly self: string
  readonly neighbours: readonly string[]
  readonly intent: 'exploration' | 'verified-improvement'
  readonly evaluation: RewireEvaluation
  readonly requesterEvaluation: ReturnType<typeof evaluateRequesterRewireEvidence>
  readonly rewireId: string | null
}

/** Public result of `atn_finish`. */
export interface FinishResult {
  /** Node that asked to retire. */
  readonly nodeId: string
  /** Lifecycle immediately after the request. */
  readonly lifecycle: string
  /** Tasks that still block release. */
  readonly openTasks: readonly string[]
  /** Proposals on which this node still owes a vote. */
  readonly pendingVotes: readonly string[]
}

/** Public input of `atn_propose`. */
export interface ProposeInput {
  /** Replacement document. */
  readonly document: GoalDocument
  /** Why the change is proposed. */
  readonly rationale: string
}

/** Public result of `atn_propose`. */
export interface ProposeResult {
  /** New proposal id. */
  readonly proposalId: string
  /** Version the proposal is based on. */
  readonly baseVersion: number
  /** Frozen approver list. */
  readonly voters: readonly string[]
  /** Deadline (epoch ms). */
  readonly deadlineAt: number
}

/** Public input of `atn_vote`. */
export interface VoteInput {
  /** Proposal being decided. */
  readonly proposalId: string
  /** Explicit consent or dissent. */
  readonly approve: boolean
  /** Optional rationale. */
  readonly reason?: string
}

/** Public result of `atn_vote`. */
export interface VoteResult {
  /** Proposal state after the vote. */
  readonly proposalId: string
  /** `pending`, `committed`, `rejected`, `expired`, `stale` or `cancelled`. */
  readonly status: string
  /** Goal version committed by this vote, when it committed. */
  readonly committedVersion: number | null
  /** Whether the identical vote was already recorded. */
  readonly idempotent: boolean
  /** Approvers that have not voted yet. */
  readonly outstanding: readonly string[]
}

/** Public input of `atn_renew`. */
export interface RenewInput {
  /** Additional lifetime requested in milliseconds. */
  readonly extendMs: number
  /** Task whose continuing work justifies the extension. */
  readonly taskId: string
  /** Optional free-text explanation; it never replaces `taskId`. */
  readonly basis?: string
}

/** Public result of `atn_renew`. */
export interface RenewResult {
  /** New lease deadline (epoch ms). */
  readonly leaseDeadlineAt: number
  /** Extension actually granted, in milliseconds. */
  readonly grantedMs: number
}

/** Public input of `atn_deliver`. */
export interface DeliverInput {
  /** Summary delivered to the user. */
  readonly summary: string
  /** Reviewable evidence references. */
  readonly evidence: readonly string[]
  /** Goal version the summary was produced against. */
  readonly goalVersion: number
}

/** Public result of `atn_deliver`. */
export interface DeliverResult {
  /** Whether the network was completed. */
  readonly accepted: boolean
  /** Why completion was refused, when it was. */
  readonly reason: string | null
  /** Goal version at the moment of the attempt. */
  readonly goalVersion: number
  /** Number of ATN-owned handles released. */
  readonly releasedNodes: readonly string[]
}

/** Why one node did not settle inside the cleanup window. */
export interface StragglerDetail {
  /** Node whose handle did not settle. */
  readonly nodeId: string
  /** Session backing the node. */
  readonly sessionId: string
  /** `pending`, `failed` or `timed-out`. */
  readonly status: string
  /** Human-readable diagnostic cause. */
  readonly reason: string
}

/** Report returned by the host-facing stop entry. */
export interface StopReport {
  /** Network that was stopped. */
  readonly networkId: string
  /** Always `stopped` once the call returns. */
  readonly status: string
  /** Nodes whose handles were confirmed released by `dispose()`. */
  readonly released: readonly string[]
  /** Nodes whose handles did not settle, listed by node id. */
  readonly stragglers: readonly string[]
  /** Per-straggler diagnostic cause, aligned with {@link StopReport.stragglers}. */
  readonly stragglerDetails: readonly StragglerDetail[]
  /** Why the network stopped. */
  readonly reason: string
}

/** How long cleanup may take before a stop reports stragglers. */
const CLEANUP_TIMEOUT_MS = 10_000
/** Scheduler period; the smallest bound that must react quickly. */
const MIN_TICK_MS = 250

/** A network transform and the business value it decides inside the critical section. */
type Mutation<Value> = (current: NetworkRecord) => MutationOutcome<Value>

/** One mutation's committed record and the value it decided. */
interface MutationOutcome<Value> {
  /** Record to persist. */
  readonly record: NetworkRecord
  /** Business value decided from the same `current` record. */
  readonly value: Value
}

/** Result of one queued network mutation. */
interface MutationResult<Value> {
  /** Record the mutation committed. */
  readonly record: NetworkRecord
  /** Business value computed inside the critical section. */
  readonly value: Value
}

/**
 * Wrap a record-only transform as a mutation decision that carries no value.
 *
 * @param record - Transformed record.
 * @returns A mutation outcome with a `null` value.
 */
function applied(record: NetworkRecord): MutationOutcome<null> {
  return { record, value: null }
}

/** Test seams of the runtime. */
export interface AtnRuntimeDeps {
  /** Explicit store, for tests that need to inspect raw writes. */
  store?: NetworkStore
  /** Injected clock. */
  clock?: () => number
  /** Cleanup window before a stop reports stragglers. */
  cleanupTimeoutMs?: number
  /** Trusted synchronous policy installed before automatic recovery can activate nodes. */
  outboundPolicy?: NetworkOutboundPolicy
}

/** @deprecated Mail-only compatibility hook. Use installOutboundPolicy for the complete boundary. */
export type NetworkSendPolicy = (record: NetworkRecord, sender: NodeRecord, input: SendInput) => void

/**
 * ATN runtime service. One instance exists per loaded plugin; it owns every
 * ATN-created Agent and every network record it has opened.
 */
export class AtnRuntime extends Service<Config> {
  static inject = ['agents', 'tools', 'sessions']
  static Config = AtnConfig

  /** Resolved plugin configuration. */
  readonly config: Config
  /** Stable owner context of every ATN-created Agent. */
  private readonly owner: Context
  /** Registration scope of the runtime's own lifecycle effects. */
  private readonly scope: Scope
  private store: NetworkStore | null = null
  private storeOpening: Promise<NetworkStore> | null = null
  /** False when the store was injected by the caller and stays theirs to close. */
  private ownsStore = true
  private recoveryRun: Promise<{ networkId: string; nodeId: string; action: string; reason: string }[]> | null = null
  /** Live ATN-owned handles, keyed by session. Released entries are pruned explicitly. */
  protected readonly handles = new Map<string, AgentHandle>()
  private readonly networkOfSession = new Map<string, string>()
  private readonly nodeOfSession = new Map<string, string>()
  private readonly stopped = new Set<string>()
  /** Per-network mutation queue; one writer per network at a time. */
  private readonly mutationTails = new Map<string, Promise<unknown>>()
  private readonly sendPolicies = new Map<string, NetworkSendPolicy>()
  private readonly outboundPolicies = new Map<string, NetworkOutboundPolicy>()
  /** Handle-release bookkeeping shared by retirement, completion and stop. */
  private readonly releaser: HandleReleaser
  /** Reports returned by earlier stop calls, so a repeat is idempotent. */
  private readonly stopReports = new Map<string, StopReport>()
  private readonly stopRuns = new Map<string, Promise<StopReport>>()
  private readonly activations = new Map<string, { networkId: string; controller: AbortController; done: Promise<unknown> }>()
  private readonly acceptedInputs = new WeakMap<Agent, Set<string>>()
  private readonly inputTails = new Map<string, Promise<unknown>>()
  /** Wildcard discovery resumes after each caller's last returned candidate. */
  private readonly discoveryCursors = new Map<string, Map<string, string>>()
  private closing = false
  private readonly cleanupTimeoutMs: number
  private timer: NodeJS.Timeout | null = null
  /** Explicit passes queue; timer pulses never build up behind a slow pass. */
  private tickTail: Promise<void> | null = null
  private readonly clock: () => number

  /**
   * @param ctx - Plugin context; captured as the owner of ATN-created Agents.
   * @param config - Validated plugin configuration.
   * @param deps - Test seams: an explicit store, clock and cleanup window.
   */
  constructor(ctx: Context, config: Config, deps: AtnRuntimeDeps = {}) {
    super(ctx, 'atn')
    if (deps.outboundPolicy !== undefined) this.outboundPolicies.set('*', deps.outboundPolicy)
    this.config = config
    this.owner = ctx
    this.scope = createScope(ctx, { name: 'atn-runtime' })
    this.clock = deps.clock ?? (() => Date.now())
    this.cleanupTimeoutMs = deps.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS
    this.releaser = new HandleReleaser(this.cleanupTimeoutMs)
    if (deps.store !== undefined) {
      this.store = deps.store
      this.ownsStore = false
    }

    ctx.on('agent/pre-step', async (payload, next) => this.preStep(payload, next))
    ctx.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') this.acceptedInputs.delete(agent)
      else {
        // A new driver can synchronously claim its pending batch before mail
        // replay resumes. Protect those real inputs, never an old lost claim.
        for (const pending of [...agent.inbox.nextStep, ...agent.inbox.nextTurn]) this.rememberInput(agent, pending)
      }
    })
    ctx.effect(() => () => this.disposeRuntime(), 'atn-runtime')

    if (deps.store === undefined && ctx.get('storageDomain') !== undefined) {
      // Rebuild durable state without blocking plugin activation.
      void this.recover().catch((error: unknown) => {
        this.ctx.logger.warn(`dsh-atn recovery did not complete: ${describe(error)}`)
      })
    }
  }

  // ------------------------------------------------------- mutation queue

  /** Install before network execution. This host API is never a model tool. */
  installSendPolicy(networkId: string, policy: NetworkSendPolicy): () => void {
    if (this.sendPolicies.has(networkId)) throw new Error('Network send policy already installed')
    this.sendPolicies.set(networkId, policy)
    return () => { if (this.sendPolicies.get(networkId) === policy) this.sendPolicies.delete(networkId) }
  }

  /** Host-only. `*` also checks atn_start, before a network id exists. */
  installOutboundPolicy(networkId: string, policy: NetworkOutboundPolicy): () => void {
    if (this.outboundPolicies.has(networkId)) throw new Error('Network outbound policy already installed')
    this.outboundPolicies.set(networkId, policy)
    return () => { if (this.outboundPolicies.get(networkId) === policy) this.outboundPolicies.delete(networkId) }
  }

  private knowledgePolicy(record: NetworkRecord): NetworkOutboundPolicy | undefined {
    const local = this.outboundPolicies.get(record.id)
    return local?.custody === undefined ? this.outboundPolicies.get('*') : local
  }

  private admitOutbound(record: NetworkRecord, sender: NodeRecord, operation: OutboundOperation): void {
    assertSynchronousAdmission(this.outboundPolicies.get('*')?.(record, sender, operation))
    assertSynchronousAdmission(this.outboundPolicies.get(record.id)?.(record, sender, operation))
    if (operation.channel === 'send.task' || operation.channel === 'send.note' || operation.channel === 'send.result') {
      assertSynchronousAdmission(this.sendPolicies.get(record.id)?.(record, sender, operation.input))
    }
  }

  /** Persist a new host custody projection; never accepts agent declarations. */
  async refreshCustody(networkId: string): Promise<void> {
    await this.mutate(networkId, current => applied(current))
  }

  /**
   * Run one network mutation as the network's single writer.
   *
   * The queue is per `networkId`: the read, the bound checks, the id allocation,
   * the business transform and the store write happen inside one critical
   * section, so concurrent callers can never write from a stale snapshot. The
   * transform must be synchronous; delivery and handle release happen outside
   * the queue, after the durable decision.
   *
   * @param networkId - Network being mutated.
   * @param fn - Synchronous transform of the latest record.
   * @param repairTopology - Hard stop skips graph repair so damaged links cannot block shutdown.
   * @returns The committed record and the value the transform decided.
   */
  private async mutate<Value>(networkId: string, fn: Mutation<Value>, repairTopology = true): Promise<MutationResult<Value>> {
    const previous = this.mutationTails.get(networkId) ?? Promise.resolve()
    const run = previous.then(
      () => this.mutateOnce(networkId, fn, repairTopology),
      () => this.mutateOnce(networkId, fn, repairTopology),
    )
    const tail = run.then(
      () => undefined,
      () => undefined,
    )
    this.mutationTails.set(networkId, tail)
    try {
      return await run
    } finally {
      if (this.mutationTails.get(networkId) === tail) this.mutationTails.delete(networkId)
    }
  }

  private async mutateOnce<Value>(networkId: string, fn: Mutation<Value>, repairTopology: boolean): Promise<MutationResult<Value>> {
    const store = this.requireStore()
    let decided: MutationOutcome<Value> | undefined
    // The decision logic runs with the authoritative current record and completes
    // synchronously: the queue holds the network until this write commits.
    const record = await store.update(networkId, (current) => {
      const outcome = fn(repairTopology ? reconcileTopology(current) : current)
      decided = outcome
      const indexed = refreshKnowledge(outcome.record, this.knowledgePolicy(outcome.record), this.now())
      const observed = refreshRewireObservations(refreshRequesterRewireEvidence(indexed, this.now()), this.now())
      return repairTopology ? reconcileTopology(observed) : observed
    })
    this.syncIndex(record)
    this.notifyObservers(record)
    if (decided === undefined) throw new Error(`network ${networkId} mutation produced no decision`)
    return { record, value: decided.value }
  }

  /**
   * Read the latest state without mutating it. Reads never take the write queue.
   *
   * @param networkId - Network to read.
   * @returns The current record.
   */
  private async inspect(networkId: string): Promise<NetworkRecord> {
    return this.requireNetwork(networkId)
  }

  /** Serialize input append and its receipt per recipient; never await a driver here. */
  private async withInput<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.inputTails.get(sessionId) ?? Promise.resolve()
    const run = previous.then(work, work)
    const tail = run.then(() => undefined, () => undefined)
    this.inputTails.set(sessionId, tail)
    try { return await run }
    finally { if (this.inputTails.get(sessionId) === tail) this.inputTails.delete(sessionId) }
  }

  private async activate<T>(networkId: string, sessionId: string, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closing) throw new AtnRefusal('runtime-closing', 'ATN runtime is shutting down')
    const controller = new AbortController()
    const done = Promise.resolve().then(() => work(controller.signal))
    this.activations.set(sessionId, { networkId, controller, done })
    try { return await done }
    finally { this.activations.delete(sessionId) }
  }

  private beginRelease(nodeId: string, sessionId: string, handle: AgentHandle): void {
    const release = this.releaser.begin(nodeId, sessionId, () => handle.dispose())
    void release.settled.then(() => {
      if (this.releaser.isReleased(sessionId) && this.handles.get(sessionId) === handle) this.handles.delete(sessionId)
    })
  }

  // ------------------------------------------------------------- lifecycle

  private async preStep(
    payload: { agent: Agent; messages: UserMessage[]; signal: AbortSignal },
    next: () => Promise<{ kind: 'reject' } | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }>,
  ): Promise<{ kind: 'reject' } | { kind: 'enter'; messages: UserMessage[]; startsRequestSeries?: true }> {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const networkId = this.networkForSession(payload.agent.id)
    if (networkId === undefined) return decision
    const admitted = await this.admitStep(networkId, payload.agent.id)
    if (!admitted) return { kind: 'reject' }
    // Only piggyback on real inbox input. A loop's empty end-of-turn probe (or
    // synthetic context alone) must never start another step for graph feedback.
    if (payload.messages.length === 0 || decision.messages.length === 0) return decision
    const record = await this.inspect(networkId)
    const node = findBySession(record, payload.agent.id)
    if (record.status !== 'open' || node === undefined) return decision
    const feedback = topologyFeedbackMessage(record, node.id, payload.agent.session.snapshotEvents(), this.now())
    if (feedback !== undefined) return { ...decision, messages: [...decision.messages, feedback] }
    return decision
  }

  /**
   * Network a session belongs to, when the runtime already indexed it.
   *
   * @param sessionId - Session id.
   * @returns The network id, or `undefined`.
   */
  networkForSession(sessionId: string): string | undefined {
    return this.networkOfSession.get(sessionId)
  }

  /**
   * Whether a node may still produce a model step, and why not when it may not.
   *
   * @param record - Current network record.
   * @param nodeId - Node being decided.
   * @returns A decision naming the lifecycle that blocks the step.
   */
  private stepDecision(record: NetworkRecord, nodeId: string): { allow: boolean; reason: string } {
    const node = record.nodes[nodeId]
    if (node === undefined) return { allow: false, reason: `node ${nodeId} is not part of network ${record.id}` }
    if (record.status !== 'open') return { allow: false, reason: `network ${record.id} is ${record.status}` }
    if (node.lifecycle === 'retired' || node.lifecycle === 'failed') {
      return { allow: false, reason: `node ${nodeId} is ${node.lifecycle} and cannot run another model step` }
    }
    if (node.lifecycle === 'provisioning') return { allow: false, reason: `node ${nodeId} is still provisioning` }
    if (node.lifecycle === 'draining') return { allow: !canRelease(record, nodeId), reason: 'draining work gate' }
    return { allow: true, reason: 'admitted' }
  }

  /**
   * Admit one model step against this node's budget, including the entry node.
   *
   * The lifecycle gate and the budget debit are one atomic decision, so two
   * concurrent steps can never both consume the last unit of budget.
   *
   * Provider retries and calls before network creation remain host accounting.
   *
   * @param networkId - Network id.
   * @param sessionId - Session whose step is being admitted.
   * @returns `false` when the step must be refused; exhausted nodes retire.
   */
  async admitStep(networkId: string, sessionId: string): Promise<boolean> {
    return this.mutate(networkId, (current) => {
      const current_node = findBySession(current, sessionId)
      if (current_node === undefined) return { record: current, value: false }
      // Completing or stopping ATN must not disable the host's ordinary chat.
      if (current_node.isEntry && current.status !== 'open') return { record: current, value: true }
      const decision = this.stepDecision(current, current_node.id)
      if (!decision.allow) return { record: current, value: false }
      if ((current_node.stepsUsed ?? 0) >= current.limits.stepBudget) {
        return { record: this.closeNode(current, current_node.id, 'retired', 'node step budget exhausted'), value: false }
      }
      return { record: { ...current, stepsUsed: current.stepsUsed + 1,
        nodes: { ...current.nodes, [current_node.id]: { ...current_node, stepsUsed: (current_node.stepsUsed ?? 0) + 1 } } }, value: true }
    }).then((result) => result.value)
  }

  /** Current time source of the runtime. */
  now(): number {
    return this.clock()
  }

  // ---------------------------------------------------------------- store

  private storageDomain(): Context['storageDomain'] | undefined {
    // Read without an injection requirement: the ATN rows must load in a
    // profile that has no storage domain, and fail loudly at the first
    // operation instead of silently deactivating.
    return this.ctx.get('storageDomain')
  }

  private requireStore(): NetworkStore {
    if (this.store !== null) return this.store
    if (this.storageDomain() === undefined) {
      throw new AtnRefusal(
        'storage-unavailable',
        'the ATN runtime needs the storage-domain service (ctx.storageDomain); mount @deepseek-ai/dsh-storage-domain and a KV backend in this profile',
      )
    }
    throw new AtnRefusal(
      'storage-not-opened',
      `the ATN runtime has not opened domain '${this.config.domainName}' yet`,
    )
  }

  /**
   * Open the durable store once, failing loudly when the profile does not
   * provide the storage services the runtime needs.
   *
   * @returns The opened store.
   */
  async openStore(): Promise<NetworkStore> {
    if (this.store !== null) return this.store
    // Exactly one open per plugin instance: recovery, a tool call and the
    // scheduler may all ask at the same time, and the domain facility accepts
    // only one open per domain name.
    this.storeOpening ??= this.openStoreOnce().catch((error: unknown) => {
      this.storeOpening = null
      throw error
    })
    return this.storeOpening
  }

  private async openStoreOnce(): Promise<NetworkStore> {
    const domain = this.storageDomain()
    if (domain === undefined) {
      throw new AtnRefusal(
        'storage-unavailable',
        'the ATN runtime needs the storage-domain service (ctx.storageDomain); mount @deepseek-ai/dsh-storage-domain and a KV backend in this profile',
      )
    }
    const { atnDomainSpec } = await import('./domain.ts')
    const store = new DomainNetworkStore(await domain.open(atnDomainSpec(this.config.domainName)))
    this.store = store
    return store
  }

  private async requireNetwork(networkId: string): Promise<NetworkRecord> {
    const record = await this.requireStore().load(networkId)
    if (record === undefined) throw new AtnRefusal('unknown-network', `network ${networkId} does not exist`)
    return record
  }

  private syncIndex(record: NetworkRecord): void {
    for (const node of Object.values(record.nodes)) {
      this.networkOfSession.set(node.sessionId, record.id)
      this.nodeOfSession.set(node.sessionId, node.id)
    }
    if (record.status !== 'open') this.stopped.add(record.id)
  }

  /** Observers cannot turn a successful durable write into a failed operation. */
  private notifyObservers(record: NetworkRecord): void {
    try {
      this.ctx.emit('atn/network-updated', { record, at: this.now() })
    } catch (error) {
      this.ctx.logger.warn(`dsh-atn observer failed: ${describe(error)}`)
    }
  }

  // ------------------------------------------------------------- identity

  /**
   * Resolve the network and node of a calling Agent, requiring it to be the
   * exact live agent inside its own driver chain.
   *
   * @param agent - Calling agent taken from the tool execution, never from model text.
   * @returns Network and node of the caller.
   * @throws AtnRefusal when the caller is not part of an open ATN network.
   */
  async callerContext(agent: Agent): Promise<{ record: NetworkRecord; node: NodeRecord }> {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new AtnRefusal('not-live-agent', `session ${agent.id} is not the live agent registered for this call`)
    }
    const networkId = this.networkOfSession.get(agent.id)
    if (networkId === undefined) {
      const found = await this.findNetworkBySession(agent.id)
      if (found === undefined) throw new AtnRefusal('not-in-network', `session ${agent.id} is not part of an ATN network`)
      return found
    }
    const record = await this.requireNetwork(networkId)
    const node = findBySession(record, agent.id)
    if (node === undefined) throw new AtnRefusal('not-in-network', `session ${agent.id} has no node in network ${networkId}`)
    return { record, node }
  }

  private async findNetworkBySession(sessionId: string): Promise<{ record: NetworkRecord; node: NodeRecord } | undefined> {
    const store = await this.openStore()
    for (const id of await store.list()) {
      const record = await store.load(id)
      if (record === undefined) continue
      this.syncIndex(record)
      const node = findBySession(record, sessionId)
      if (node !== undefined) return { record, node }
    }
    return undefined
  }

  /**
   * Resolve a node by its displayed id.
   *
   * @param record - Current network record.
   * @param nodeId - Node id.
   * @returns The node record.
   * @throws AtnRefusal when the id is unknown.
   */
  resolveNode(record: NetworkRecord, nodeId: string): NodeRecord {
    const node = record.nodes[nodeId]
    if (node === undefined) throw new AtnRefusal('unknown-node', `node ${nodeId} is not part of network ${record.id}`)
    return node
  }

  // ---------------------------------------------------------------- start

  /**
   * Initialize a network in the calling ordinary session.
   *
   * @param agent - Calling entry agent, owned by the host.
   * @param input - Objective, success criteria and constraints.
   * @returns Network, node and initial task identifiers.
   */
  async start(agent: Agent, input: StartInput): Promise<StartResult> {
    const store = await this.openStore()
    const existing = await this.findNetworkBySession(agent.id)
    if (existing !== undefined) {
      throw new AtnRefusal(
        'already-in-network',
        `session ${agent.id} already belongs to network ${existing.record.id}; a node cannot start a second network`,
      )
    }
    const document: GoalDocument = {
      objective: input.objective,
      successCriteria: input.successCriteria,
      constraints: input.constraints,
    }
    if (utf8Bytes(JSON.stringify(document)) > this.config.maxDocumentBytes) {
      throw new LimitExceededError('maxDocumentBytes', `the goal document exceeds ${this.config.maxDocumentBytes} bytes`)
    }

    const now = this.now()
    const networkId = `atn-${randomUUID()}`
    const nodeId = 'node-1'
    const createdAt = now
    let record: NetworkRecord = {
      id: networkId,
      entrySessionId: agent.id,
      entryNodeId: nodeId,
      status: 'open',
      limits: limitsFromConfig(this.config),
      goalHistory: [{ version: 1, document, proposedBy: null, approvedBy: [], committedAt: now }],
      stepsUsed: agent.status === 'running' ? 1 : 0,
      nodes: {
        [nodeId]: {
          id: nodeId,
          sessionId: agent.id,
          creatorId: null,
          selectedChildId: null,
          peerIds: [],
          lifecycle: 'active',
          leaseDeadlineAt: null,
          modelRoute: { provider: agent.options.provider ?? 'inherit', model: agent.options.model ?? 'inherit', effort: agent.options.reasoningEffort ?? null },
          presetId: agent.ctx.get('agentPresets')?.composedPreset(agent.ctx) ?? null,
          permissionSeed: null,
          isEntry: true,
          stepsUsed: agent.status === 'running' ? 1 : 0,
          creationState: 'published',
          lastGoalVersionSent: 0,
          note: 'host-owned entry node',
          createdAt,
        },
      },
      tasks: {},
      mails: {},
      proposals: {},
      sequence: 1,
      createdAt,
      deadlineAt: now + this.config.networkDeadlineMs,
      note: null,
    }

    this.admitOutbound(record, record.nodes[nodeId]!, { channel: 'start', input })
    const created = createTask(record, {
      holderId: nodeId,
      requesterId: nodeId,
      description: document.objective,
      context: `Initial task derived from the shared goal: ${document.successCriteria}`,
      now,
    })
    record = refreshKnowledge(created.record, this.knowledgePolicy(created.record), now)

    await store.create(record)
    this.syncIndex(record)
    this.notifyObservers(record)
    this.startScheduler()

    const task = record.tasks[created.taskId]!
    const synced = await this.syncGoalIfNeeded(networkId, nodeId, agent)
    const revision = currentGoal(synced ?? record)
    await this.recordModelInput(agent, taskMessage(task, networkId, revision.version), networkId, nodeId)

    return { networkId, nodeId, taskId: created.taskId, goalVersion: 1, deadlineAt: record.deadlineAt }
  }

  // ---------------------------------------------------------------- spawn

  /**
   * Create one same-capability independent node.
   *
   * The node record is persisted as `provisioning` before any Agent exists,
   * because the identity must survive a failure. The publish, the
   * `selected_child` claim and the initial task then commit in ONE network
   * mutation, and every failure path records an explicit `failed` node and
   * releases the Agent it created instead of leaving an active node without
   * work.
   *
   * @param agent - Creating agent.
   * @param input - Initial task, context and optional lease.
   * @returns New node, session and task identifiers.
   */
  async spawn(agent: Agent, input: SpawnInput): Promise<SpawnResult> {
    const { record, node: creator } = await this.callerContext(agent)
    const sessionId = `atn-${randomUUID()}`
    return this.activate(record.id, sessionId, signal => this.spawnOnce(agent, input, record, creator, sessionId, signal))
  }

  private async spawnOnce(agent: Agent, input: SpawnInput, record: NetworkRecord, creator: NodeRecord, sessionId: string, signal: AbortSignal): Promise<SpawnResult> {
    signal.throwIfAborted()
    if (record.status !== 'open') throw new AtnRefusal('network-closed', `network ${record.id} is ${record.status}`)
    if (creator.lifecycle !== 'active') {
      throw new AtnRefusal('not-active', `node ${creator.id} is ${creator.lifecycle} and cannot create children`)
    }

    // Capture the inherited policy BEFORE the first await, so a later permission
    // change on the creator cannot widen the child.
    const inherited = captureDelegatedPolicyOverrides(agent)
    const presets = agent.ctx.get('agentPresets')
    const presetId = presets?.composedPreset(agent.ctx) ?? null
    const route = {
      provider: agent.options.provider ?? creator.modelRoute.provider,
      model: agent.options.model ?? creator.modelRoute.model,
      effort: agent.options.reasoningEffort ?? creator.modelRoute.effort,
    }

    const now = this.now()
    // Creation intent first: the identity is durable before an Agent exists, so
    // a crash can never leave a live process with no recorded node.
    let prepared: MutationResult<{ nodeId: string; leaseMs: number }>
    prepared = await this.mutate(record.id, (current) => {
      signal.throwIfAborted()
      const currentCreator = current.nodes[creator.id]
      if (current.status !== 'open') {
        throw new AtnRefusal('network-closed', `network ${current.id} is ${current.status}`)
      }
      if (currentCreator === undefined) {
        throw new AtnRefusal('unknown-node', `creator ${creator.id} is not part of network ${current.id}`)
      }
      if (currentCreator.lifecycle !== 'active') {
        throw new AtnRefusal('not-active', `node ${creator.id} is ${currentCreator.lifecycle} and cannot create children`)
      }
      assertNodeCapacity(current, current.limits)
      this.admitOutbound(current, currentCreator, { channel: 'spawn', input })
      assertTaskReferences(current, { ...input, requesterId: creator.id })
      // The initial task is part of the same spawn: refuse before creating an
      // Agent when the task quota cannot hold it.
      if (Object.values(current.tasks).filter(task => task.kind !== 'delivery').length >= current.limits.maxTasks) {
        throw new LimitExceededError(
          'maxTasks',
          `network ${current.id} already recorded ${current.limits.maxTasks} tasks, so a spawn cannot be given its initial task`,
        )
      }
      const allocated = allocateId(current, 'node')
      const leaseMs = Math.min(input.leaseMs ?? current.limits.defaultLeaseMs, current.limits.maxLeaseExtensionMs)
      return {
        record: {
          ...allocated.next,
          nodes: {
            ...allocated.next.nodes,
            [allocated.id]: {
              id: allocated.id,
              sessionId,
              creatorId: creator.id,
              selectedChildId: null,
              lifecycle: 'provisioning',
              leaseDeadlineAt: now + leaseMs,
              modelRoute: route,
              presetId,
              permissionSeed: inherited as unknown,
              isEntry: false,
              stepsUsed: 0,
              creationState: 'pending',
              lastGoalVersionSent: 0,
              note: null,
              createdAt: now,
            },
          },
        },
        value: { nodeId: allocated.id, leaseMs },
      }
    })

    let handle: AgentHandle
    try {
      handle = await this.owner.agents.create({
        sessionId: SessionId(sessionId),
        signal,
        meta: {
          origin: 'subagent', delegationDepth: 1,
          ...(agent.session.header.cwd === undefined ? {} : { cwd: agent.session.header.cwd }),
          ...(presetId === null ? {} : { agentPreset: presetId }),
        },
        agentOptions: {
          provider: route.provider === 'inherit' ? undefined : route.provider,
          model: route.model === 'inherit' ? undefined : route.model,
          reasoningEffort: effortOption(route.effort),
        },
        setup: async (agentCtx, child): Promise<void> => {
          // Join the creator's retained revision, including when the declaration
          // has since changed. Ownership remains with ATN, not the creator.
          const joined = presets?.composeFrom(agentCtx, agent.ctx) ?? null
          if (joined !== presetId) throw new AtnRefusal('preset-changed', 'creator preset changed during node creation')
          appendDelegatedPolicyOverrides(child.session as Session, inherited)
        },
      })
    } catch (error) {
      const reason = describe(error)
      await this.compensateSpawnFailure(record.id, sessionId, reason)
      throw error
    }

    this.handles.set(sessionId, handle)

    let published: { nodeId: string; taskId: string; mailId: string; goalVersion: number; neighbours: string[] }
    try {
      const committed = await this.mutate(record.id, (current) => {
        signal.throwIfAborted()
        if (current.status !== 'open' || this.closing) throw new AtnRefusal('network-closed', `network ${current.id} is closed`)
        const pending = findBySession(current, sessionId)
        if (pending === undefined || pending.creationState !== 'pending' || pending.lifecycle !== 'provisioning') {
          throw new AtnRefusal(
            'creation-superseded',
            `node ${prepared.value.nodeId} is no longer a pending creation in network ${current.id}`,
          )
        }
        // Publish and hand over the initial task as one decision: a node can
        // never become visible while its work fails to commit.
        const visible = connectPublishedNode(publishNode(current, sessionId, this.now()).record, pending.id)
        const settled = createTask(visible, {
          holderId: pending.id,
          requesterId: creator.id,
          description: input.task,
          context: input.context,
          dependsOn: input.dependsOn,
          retryOf: input.retryOf,
          now: this.now(),
        })
        const revision = currentGoal(settled.record)
        // Publish the assignment's outbox row with the node and task. A crash
        // before any input append must still leave recoverable work to deliver.
        const assignment = taskMessage(settled.record.tasks[settled.taskId]!, record.id, revision.version)
        const enqueued = enqueueMail(settled.record, {
          fromId: creator.id,
          toId: pending.id,
          kind: 'task',
          taskId: settled.taskId,
          proposalId: null,
          body: assignment.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n'),
          now: this.now(),
        })
        return {
          record: enqueued.record,
          value: {
            nodeId: pending.id,
            taskId: settled.taskId,
            mailId: enqueued.mailId,
            goalVersion: revision.version,
            neighbours: collaborationPeers(settled.record.nodes, pending.id, collaborationPeerLimit(settled.record)),
          },
        }
      })
      published = committed.value
    } catch (error) {
      const reason = describe(error)
      await this.compensateSpawnFailure(record.id, sessionId, reason)
      await this.disposeDetachedHandle(handle, sessionId, prepared.value.nodeId, reason)
      throw error
    }

    const publishedRecord = await this.inspect(record.id)
    const neighbours = collaborationPeers(publishedRecord.nodes, published.nodeId, collaborationPeerLimit(publishedRecord))
    let post: { taskId: string; goalVersion: number } | undefined
    try {
      // Context setup failures still compensate the creation. The assignment
      // itself is already durable and can retry independently after setup.
      signal.throwIfAborted()
      const synced = await this.syncGoalIfNeeded(record.id, published.nodeId, handle.agent, false)
      const finalRecord = synced ?? (await this.inspect(record.id))
      const task = finalRecord.tasks[published.taskId]
      if (task === undefined) throw new Error(`initial task ${published.taskId} is missing from network ${record.id}`)
      signal.throwIfAborted()
      if (finalRecord.status !== 'open' || finalRecord.nodes[published.nodeId]?.lifecycle !== 'active') {
        throw new AtnRefusal('network-closed', 'creation was interrupted before task delivery')
      }
      post = { taskId: task.id, goalVersion: currentGoal(finalRecord).version }
    } catch (error) {
      const reason = describe(error)
      await this.compensateSpawnFailure(record.id, sessionId, reason)
      await this.disposeDetachedHandle(handle, sessionId, published.nodeId, reason)
      throw error
    }

    // A temporary recipient/receipt write failure cannot erase an accepted
    // assignment. Keep its outbox row queued for the scheduler or recovery.
    try {
      await this.deliverMail(record.id, published.mailId)
    } catch (error) {
      this.ctx.logger.warn(`dsh-atn initial task ${post.taskId} awaits durable delivery: ${describe(error)}`)
    }

    return {
      nodeId: published.nodeId,
      sessionId,
      taskId: post.taskId,
      neighbours,
    }
  }

  /**
   * Record an explicit failed node after a spawn failure, so no caller ever
   * sees an active node without its task.
   *
   * @param networkId - Network that recorded the intent.
   * @param sessionId - Session whose creation failed.
   * @param reason - Human-readable failure reason.
   */
  private async compensateSpawnFailure(networkId: string, sessionId: string, reason: string): Promise<void> {
    try {
      await this.mutate(networkId, (current) => {
        const failed = failProvisioning(current, sessionId, reason)
        const node = findBySession(failed, sessionId)
        const tasks = { ...failed.tasks }
        for (const task of Object.values(tasks)) {
          if (task.holderId === node?.id && task.status === 'open') tasks[task.id] = {
            ...task, status: 'failed', settledAt: this.now(), settledBy: node.id,
            holderStepsAtSettlement: node.stepsUsed,
            result: { summary: `node creation failed: ${reason}`, evidence: [] },
          }
        }
        let compensated = { ...failed, tasks }
        for (const mail of pendingMails(compensated)) {
          if (mail.toId === node?.id) compensated = markUndeliverable(compensated, mail.id, reason, this.now())
        }
        return applied(compensated)
      })
    } catch (error) {
      this.ctx.logger.warn(`dsh-atn could not record the failed creation of ${sessionId}: ${describe(error)}`)
    }
  }

  /**
   * Release an Agent whose creation intent never became a usable node, keeping
   * the release observable as a straggler when disposal does not settle.
   *
   * @param handle - Handle to release.
   * @param sessionId - Session backing it.
   * @param nodeId - Node the handle belongs to.
   * @param reason - Why the handle is being released.
   */
  private async disposeDetachedHandle(handle: AgentHandle, sessionId: string, nodeId: string, reason: string): Promise<void> {
    this.beginRelease(nodeId, sessionId, handle)
    const outcomes = await this.releaser.settle(new Set([sessionId]))
    const outcome = outcomes.find((entry) => entry.nodeId === nodeId)
    if (outcome !== undefined && outcome.status !== 'released') {
      this.ctx.logger.warn(`dsh-atn spawn compensation left ${nodeId} as ${outcome.status}: ${outcome.reason ?? reason}`)
    }
  }

  // ----------------------------------------------------------------- send

  /**
   * Enqueue one mail durably and attempt delivery once.
   *
   * A caller-supplied `messageId` makes the whole operation idempotent: the
   * same business message never creates a second mail row, a second task or a
   * second settlement, while the same id attached to different content is
   * refused outright.
   *
   * @param agent - Sending agent; the sender is resolved from live identity.
   * @param input - Target, kind, body and optional task link.
   * @returns Mail id and the delivery state observed right after the enqueue.
   */
  async send(agent: Agent, input: SendInput): Promise<SendResult> {
    const { record, node } = await this.callerContext(agent)
    if (record.status !== 'open') throw new AtnRefusal('network-closed', `network ${record.id} is ${record.status}`)
    if (node.lifecycle !== 'active' && node.lifecycle !== 'draining') {
      throw new AtnRefusal('not-active', `node ${node.id} is ${node.lifecycle} and cannot send`)
    }
    this.resolveNode(record, input.to)

    if (input.kind !== 'task' && (input.dependsOn !== undefined || input.retryOf !== undefined)) {
      throw new AtnRefusal('invalid-task-references', 'dependsOn and retryOf are only valid for task mail')
    }

    if (input.outcome !== undefined && (
      input.kind !== 'result' || (input.outcome !== 'completed' && input.outcome !== 'failed')
    )) {
      throw new AtnRefusal('invalid-outcome', 'outcome must be completed or failed and is only valid for a result mail')
    }
    if (input.kind === 'result') {
      if (input.taskId === undefined) throw new AtnRefusal('missing-task', 'a result mail must name the task it settles')
      if (input.summary === undefined) throw new AtnRefusal('missing-summary', 'a result mail must carry a summary')
      return this.settleByResult(record.id, node.id, input)
    }

    const committed = await this.mutate<{ mailId: string; duplicate: boolean; settledTaskId: string | null }>(record.id, (current) => {
      const sender = current.nodes[node.id]
      if (current.status !== 'open') throw new AtnRefusal('network-closed', `network ${current.id} is ${current.status}`)
      if (sender === undefined || (sender.lifecycle !== 'active' && sender.lifecycle !== 'draining')) {
        throw new AtnRefusal('not-active', `node ${node.id} is ${sender?.lifecycle ?? 'missing'} and cannot send`)
      }
      const target = current.nodes[input.to]
      if (target === undefined) throw new AtnRefusal('unknown-node', `node ${input.to} is not part of network ${current.id}`)
      this.admitOutbound(current, sender, { channel: input.kind === 'task' ? 'send.task' : 'send.note', input })
      // A stable id makes the whole operation idempotent. An existing row is only
      // a retry when the caller-facing envelope matches; a different message under
      // the same id is refused before any task or settlement is decided.
      const reused = existingMail(current, input, sender.id, target.id)
      if (reused !== undefined) {
        if (input.kind === 'task') {
          const original = reused.taskId === null ? undefined : current.tasks[reused.taskId]
          const dependsOn = input.dependsOn ?? (input.retryOf === undefined ? [] : current.tasks[input.retryOf]?.dependsOn ?? [])
          if (original === undefined || (original.retryOf ?? null) !== (input.retryOf ?? null) ||
            JSON.stringify(original.dependsOn ?? []) !== JSON.stringify(dependsOn)) {
            throw new MailIdentityError(`mail ${reused.id} has different task dependencies; a stable id cannot be reused for a different message`)
          }
        }
        return { record: current, value: { mailId: reused.id, duplicate: true, settledTaskId: reused.taskId } }
      }
      if (input.kind === 'task') {
        if (sender.lifecycle !== 'active') {
          throw new AtnRefusal(
            'sender-draining',
            `node ${sender.id} is ${sender.lifecycle} and may only settle its existing work, not assign new tasks`,
          )
        }
        if (target.lifecycle !== 'active') {
          throw new AtnRefusal('target-not-active', `node ${target.id} is ${target.lifecycle} and cannot take new tasks`)
        }
      }
      // New communication follows the caller's chosen edges. An existing open
      // task keeps a narrow discussion channel even after either endpoint rewires.
      // Check retries above this gate: changing edges never revokes accepted mail.
      const task = input.taskId === undefined ? undefined : current.tasks[input.taskId]
      const taskDiscussion = input.kind === 'note' && task?.status === 'open' && (
        (task.holderId === sender.id && task.requesterId === target.id) ||
        (task.requesterId === sender.id && task.holderId === target.id)
      )
      if (sender.id !== target.id && !taskDiscussion && !collaborationPeers(current.nodes, sender.id, collaborationPeerLimit(current)).includes(target.id)) {
        throw new AtnRefusal(
          'not-a-neighbour',
          `node ${target.id} is not in your collaboration neighbours; use atn_status to discover and its rewire option to connect first`,
        )
      }
      const enqueueInput: EnqueueInput = {
        fromId: sender.id,
        toId: target.id,
        kind: input.kind,
        taskId: input.kind === 'task' ? null : (input.taskId ?? null),
        proposalId: null,
        body: input.body,
        now: this.now(),
        ...(input.messageId === undefined ? {} : { id: input.messageId }),
      }
      if (input.kind === 'task') {
        const created = createTask(current, {
          holderId: target.id,
          requesterId: sender.id,
          description: input.body,
          context: '',
          dependsOn: input.dependsOn,
          retryOf: input.retryOf,
          now: this.now(),
        })
        const enqueued = enqueueMail(created.record, { ...enqueueInput, taskId: created.taskId })
        return { record: enqueued.record, value: { mailId: enqueued.mailId, duplicate: enqueued.duplicate, settledTaskId: created.taskId } }
      }
      const enqueued = enqueueMail(current, enqueueInput)
      return { record: enqueued.record, value: { mailId: enqueued.mailId, duplicate: enqueued.duplicate, settledTaskId: input.taskId ?? null } }
    })

    if (committed.value.duplicate) {
      return {
        mailId: committed.value.mailId,
        duplicate: true,
        delivery: await this.attemptDelivery(record.id, committed.value.mailId),
        settledTaskId: committed.value.settledTaskId,
      }
    }
    const delivery = await this.attemptDelivery(record.id, committed.value.mailId)
    return { mailId: committed.value.mailId, duplicate: false, delivery, settledTaskId: committed.value.settledTaskId }
  }

  private async settleByResult(networkId: string, senderId: string, input: SendInput): Promise<SendResult> {
    const taskId = input.taskId!
    const outcome = input.outcome ?? 'completed'
    const committed = await this.mutate(networkId, (current) => {
      const sender = current.nodes[senderId]
      if (current.status !== 'open') throw new AtnRefusal('network-closed', `network ${current.id} is ${current.status}`)
      if (sender === undefined || (sender.lifecycle !== 'active' && sender.lifecycle !== 'draining')) {
        throw new AtnRefusal('not-active', `node ${senderId} is ${sender?.lifecycle ?? 'missing'} and cannot send`)
      }
      this.admitOutbound(current, sender, { channel: 'send.result', input })
      // A stable id makes the retry idempotent: an existing row is only accepted
      // as the same result, and anything else under that id is refused before the
      // task is touched again.
      const reused = existingMail(current, input, senderId, input.to)
      if (reused !== undefined) {
        // The result payload lives on the task, so a reused id must also describe
        // the same settlement, not a different claim about the same task.
        const task = current.tasks[taskId]
        const sameClaim =
          reused.taskId === taskId &&
          task?.status === outcome &&
          task?.result !== null &&
          task?.result !== undefined &&
          task.result.summary === (input.summary ?? '') &&
          task.result.evidence.length === (input.evidence ?? []).length &&
          task.result.evidence.every((entry, index) => entry === (input.evidence ?? [])[index])
        if (!sameClaim) {
          throw new MailIdentityError(
            `mail ${reused.id} already settles task ${String(reused.taskId)} with a different result; a stable id cannot be reused for a different message`,
          )
        }
        return { record: current, value: { mailId: reused.id, duplicate: true } }
      }
      if (current.tasks[taskId]?.kind === 'delivery') {
        throw new AtnRefusal('delivery-task', 'a delivery obligation is settled only by atn_finish with scope=network')
      }
      const settled = settleTask(current, taskId, senderId, {
        summary: input.summary ?? '',
        evidence: input.evidence ?? [],
      }, this.now(), outcome === 'failed')
      if (settled.task.requesterId !== input.to) {
        throw new AtnRefusal('not-task-requester', `result for ${taskId} must return to its requester ${settled.task.requesterId}`)
      }
      const enqueued = enqueueMail(settled.record, {
        fromId: senderId,
        toId: input.to,
        kind: 'result',
        taskId,
        proposalId: null,
        body: input.body,
        now: this.now(),
        ...(input.messageId === undefined ? {} : { id: input.messageId }),
      })
      // Task settlement and its outbox row commit in one network mutation.
      return { record: enqueued.record, value: { mailId: enqueued.mailId, duplicate: enqueued.duplicate } }
    })
    if (committed.value.duplicate) {
      return { mailId: committed.value.mailId, duplicate: true, delivery: await this.attemptDelivery(networkId, committed.value.mailId), settledTaskId: taskId, outcome }
    }
    const delivery = await this.attemptDelivery(networkId, committed.value.mailId)
    return { mailId: committed.value.mailId, duplicate: false, delivery, settledTaskId: taskId, outcome }
  }

  private async attemptDelivery(networkId: string, mailId: string): Promise<SendResult['delivery']> {
    return this.deliverMail(networkId, mailId)
  }

  /**
   * Deliver one queued mail and confirm its persisted model-input receipt.
   *
   * Pending and claimed input stays queued: the Harness removes claimed inbox
   * input before it logs user/message. Only a flush covering that later history
   * event permits confirmation, leaving the outbox replayable across the gap.
   *
   * @param networkId - Network owning the mail.
   * @param mailId - Mail to deliver.
   * @returns The delivery outcome.
   */
  async deliverMail(networkId: string, mailId: string): Promise<'delivered' | 'queued' | 'undeliverable'> {
    const first = await this.inspect(networkId)
    const sessionId = first.nodes[first.mails[mailId]?.toId ?? '']?.sessionId
    if (sessionId === undefined) return 'undeliverable'
    const live = this.ctx.agents.get(SessionId(sessionId))
    if (first.mails[mailId]?.status === 'queued' && live !== undefined) {
      // A scheduler may observe a newly published outbox before spawn finishes
      // its own context setup. Give the recipient the goal before any work can
      // wake it, using a separate input-queue operation to avoid reentrancy.
      await this.syncGoalIfNeeded(networkId, first.mails[mailId]!.toId, live, false)
    }
    return this.withInput(sessionId, async () => {
      const record = await this.inspect(networkId)
      const mail = record.mails[mailId]
      if (mail === undefined) return 'undeliverable'
      if (mail.status !== 'queued') return mail.status
      const target = record.nodes[mail.toId]
      if (record.status !== 'open' || this.closing || target === undefined || target.lifecycle === 'retired' || target.lifecycle === 'failed' || target.creationState !== 'published') {
        await this.mutate(networkId, current => applied(markUndeliverable(current, mailId, 'network or recipient is closed', this.now())))
        return 'undeliverable'
      }
      const agent = this.ctx.agents.get(SessionId(sessionId))
      if (agent === undefined) return 'queued'
      const proposal = mail.proposalId === null ? undefined : record.proposals[mail.proposalId]
      const resultTask = mail.kind === 'result' && mail.taskId !== null ? record.tasks[mail.taskId] : undefined
      const resultStatus = resultTask?.status
      const outcome = resultStatus === 'completed' || resultStatus === 'failed' ? resultStatus : undefined
      const relatedTask = mail.taskId === null ? undefined : record.tasks[mail.taskId]
      const continuation = mail.taskId !== null && Object.values(record.mails).some(previous =>
        previous.id !== mail.id && previous.toId === mail.toId && previous.taskId === mail.taskId &&
        (previous.status === 'delivered' || this.hasLoggedInput(agent, this.messageMarker(mailMessage(previous, networkId))!)))
      const message = proposal === undefined ? mailMessage(mail, networkId, outcome, resultTask?.result, relatedTask, continuation) : proposalMessage(proposal, networkId)
      const marker = this.messageMarker(message)
      if (agent.status === 'idle' && (marker === null || !this.hasLoggedInput(agent, marker))) {
        // A failed turn can strand injected input in nextStep, or lose its
        // claimed batch before user/message is logged. Live acceptance is not
        // a reason to leave that durable outbox parked once no driver owns it.
        // Avoid repeatedly opening rejected turns after the local budget ends;
        // the ordinary pre-step/provider gates still arbitrate a real wake.
        if (!this.stepDecision(record, target.id).allow || (target.stepsUsed ?? 0) >= record.limits.stepBudget) return 'queued'
        const pendingStep = agent.inbox.nextStep.find(pending => this.messageMarker(pending) === marker)
        const pendingTurn = agent.inbox.nextTurn.find(pending => this.messageMarker(pending) === marker)
        // send() appends: use the existing boundary's LAST item as the wake
        // carrier so every pending identity and its committed order stay put.
        // Inbox removal and send are synchronous public operations.
        const carrier = pendingStep !== undefined ? agent.inbox.nextStep.at(-1)
          : pendingTurn !== undefined ? agent.inbox.nextTurn.at(-1) : undefined
        if (carrier !== undefined) agent.inbox.remove(carrier.id)
        agent.send(carrier ?? message, pendingStep === undefined ? 'next-turn' : 'next-step', true)
      } else if (!this.alreadyQueued(agent, message)) {
        agent.inject(message)
      }
      this.rememberInput(agent, message)
      if (!await this.flushInputReceipt(agent, message)) return 'queued'
      const committed = await this.mutate(networkId, current => applied(markDelivered(current, mailId, this.now())))
      return committed.record.mails[mailId]?.status ?? 'undeliverable'
    })
  }

  private alreadyQueued(agent: Agent, message: UserMessage): boolean {
    const marker = this.messageMarker(message)
    if (marker === null) return false
    const inbox = agent.inbox
    return (
      // Only a running driver may still own a claimed, unlogged input batch.
      // Once idle, actual inbox/history evidence supersedes live acceptance.
      (agent.status === 'running' && this.acceptedInputs.get(agent)?.has(marker) === true) ||
      inbox.nextStep.some((pending) => this.messageMarker(pending) === marker) ||
      inbox.nextTurn.some((pending) => this.messageMarker(pending) === marker) ||
      this.hasLoggedInput(agent, marker)
    )
  }

  private hasLoggedInput(agent: Agent, marker: string): boolean {
    return agent.session.snapshotEvents().some(event => event.type === 'user/message' &&
      (event.data as UserMessage).source?.kind === 'atn' && this.messageMarker(event.data as UserMessage) === marker)
  }

  /** Check an immutable history prefix BEFORE flushing the prefix durably. */
  private async flushInputReceipt(agent: Agent, message: UserMessage): Promise<boolean> {
    const marker = this.messageMarker(message)
    if (marker === null) return false
    const loggedBeforeFlush = this.hasLoggedInput(agent, marker)
    if (!await this.ctx.sessions.flush(agent.session)) return false
    if (loggedBeforeFlush) return true
    // A fast driver may have admitted the input during the first checkpoint.
    // A second checkpoint must cover that event; a live observation alone is
    // never an acknowledgement. Never await the driver (it may be this caller).
    if (!this.hasLoggedInput(agent, marker)) return false
    return this.ctx.sessions.flush(agent.session)
  }

  private rememberInput(agent: Agent, message: UserMessage): void {
    if (agent.status !== 'running') return
    const marker = this.messageMarker(message)
    if (marker === null) return
    const accepted = this.acceptedInputs.get(agent) ?? new Set<string>()
    accepted.add(marker)
    this.acceptedInputs.set(agent, accepted)
  }

  private messageMarker(message: UserMessage): string | null {
    for (const block of message.content) {
      if (block.type === 'text') {
        const first = block.text.split('\n', 1)[0] ?? ''
        if (first.startsWith('[ATN ')) return first
      }
    }
    return null
  }

  // ---------------------------------------------------------------- peers

  /**
   * Return the calling node's current neighbourhood and bounded summaries.
   *
   * @param agent - Calling agent.
   * @param query - Optional discovery text; a non-empty query adds bounded candidates.
   * @returns Neighbourhood and summaries.
   */
  async peers(agent: Agent, query?: string): Promise<PeersResult> {
    const { record, node } = await this.callerContext(agent)
    const ids = collaborationPeers(record.nodes, node.id, collaborationPeerLimit(record))
    const tasks = Object.values(record.tasks)
    const summarize = (id: string): PeerSummary => {
      const peer = record.nodes[id]!
      const held = tasks.filter(task => task.holderId === id)
      const ongoing = held.filter(task => task.status === 'open')
      const recent = held.filter(task => task.status !== 'open')
        .sort((left, right) => (right.settledAt ?? 0) - (left.settledAt ?? 0) || right.id.localeCompare(left.id))
      return {
        id: peer.id,
        lifecycle: peer.lifecycle,
        openTasks: ongoing.length,
        pendingVotes: Object.values(record.proposals).filter(
          (proposal) => proposal.status === 'pending' && proposal.voters.includes(id) && !proposal.votes.some((vote) => vote.voterId === id),
        ).length,
        taskSummaries: [...ongoing, ...recent].slice(0, 3).map(task => task.description.slice(0, 240)),
        recentResults: recent.slice(0, 2).map(task => `[${task.status}] ${task.result?.summary ?? task.description}`.slice(0, 240)),
        verifiedFeedback: summarizeVerifiedFeedback(record, id, { observerId: node.id }),
        requesterFeedback: summarizeRequesterFeedback(record, id, { observerId: node.id }),
        knowledgeFingerprint: summarizeKnowledge(record, id, this.knowledgePolicy(record)),
        telemetry: summarizeLocalFeedback(record, id, { observerId: node.id, now: this.now() }),
      }
    }

    const result: PeersResult = {
      self: node.id,
      neighbours: ids,
      nodes: ids.map(summarize),
    }
    if (query !== undefined && query.trim().length > 0) {
      const needle = query.trim().toLowerCase()
      const ranked = Object.values(record.nodes)
        .filter((candidate) => candidate.id !== node.id && !ids.includes(candidate.id))
        .filter((candidate) => candidate.lifecycle === 'active' && candidate.creationState === 'published')
        .map(candidate => {
          const held = tasks.filter(task => task.holderId === candidate.id)
          const knowledge = summarizeKnowledge(record, candidate.id, this.knowledgePolicy(record))
          const local = summarizeRequesterFeedback(record, candidate.id, { observerId: node.id })
          return {
            id: candidate.id,
            score: scoreKnowledgeQuery(record, candidate.id, needle, this.knowledgePolicy(record)),
            localAcceptance: local.acceptanceRate,
            sharedAcceptance: knowledge.requesterAcceptanceRate,
            accepted: knowledge.requesterAccepted,
            load: held.filter(task => task.status === 'open').length,
            createdAt: candidate.createdAt,
          }
        })
        .filter(candidate => candidate.score > 0)
        // Relevance first, then source-labelled quality; unknown quality is neutral.
        .sort((left, right) => right.score - left.score ||
          (right.localAcceptance ?? 0.5) - (left.localAcceptance ?? 0.5) ||
          (right.sharedAcceptance ?? 0.5) - (left.sharedAcceptance ?? 0.5) ||
          right.accepted - left.accepted || left.load - right.load || left.createdAt - right.createdAt || left.id.localeCompare(right.id))
        .map((candidate) => candidate.id)
      let candidates = ranked.slice(0, 3)
      if (needle === '*' && ranked.length > 0) {
        const cursors = this.discoveryCursors.get(record.id) ?? new Map<string, string>()
        const previous = cursors.get(node.id)
        const start = previous === undefined ? 0 : (ranked.indexOf(previous) + 1) % ranked.length
        candidates = Array.from({ length: Math.min(3, ranked.length) }, (_, offset) => ranked[(start + offset) % ranked.length]!)
        // No await between reading and advancing: concurrent calls get successive pages.
        cursors.set(node.id, candidates[candidates.length - 1]!)
        this.discoveryCursors.set(record.id, cursors)
      }
      return { ...result, candidates, candidateNodes: candidates.map(summarize) }
    }
    return result
  }

  /** Run a trusted host validator atomically. Deliberately has no model tool. */
  async verifyTask(networkId: string, taskId: string, validator: TaskValidator): Promise<TaskRecord> {
    const committed = await this.mutate(networkId, current => {
      const checked = validateTaskResult(current, taskId, validator, this.now())
      return { record: checked.record, value: checked.task }
    })
    return committed.value
  }

  /** Persist the live requester's judgement without mail or host acceptance. */
  async feedback(agent: Agent, input: RequesterFeedbackInput): Promise<TaskRecord> {
    const { record, node } = await this.callerContext(agent)
    const committed = await this.mutate(record.id, current => {
      const caller = current.nodes[node.id]!
      if (current.status !== 'open' || this.now() >= current.deadlineAt ||
        (caller.lifecycle !== 'active' && caller.lifecycle !== 'draining')) {
        throw new AtnRefusal('feedback-unavailable', 'feedback requires a live requester in an open network')
      }
      this.admitOutbound(current, caller, { channel: 'status.review', input })
      const updated = recordRequesterFeedback(current, node.id, input, this.now())
      return { record: updated.record, value: updated.task }
    })
    return structuredClone(committed.value)
  }

  /** Stage a host-defined recovery obligation before failing its current holder. No model tool exposes this API. */
  async provisionRecoveryTask(networkId: string, holderId: string, description: string, context = ''): Promise<TaskRecord> {
    if (description.trim().length === 0) throw new AtnRefusal('missing-task', 'a recovery task needs an executable description')
    const committed = await this.mutate(networkId, current => {
      const holder = current.nodes[holderId]
      if (current.status !== 'open' || this.now() >= current.deadlineAt || holder?.lifecycle !== 'active') {
        throw new AtnRefusal('recovery-unavailable', 'recovery provisioning requires an active holder in an open network')
      }
      const created = createTask(current, { holderId, requesterId: current.entryNodeId, description, context, now: this.now() })
      return { record: created.record, value: created.record.tasks[created.taskId]! }
    })
    return structuredClone(committed.value)
  }

  /** Read bounded task records; only the host can write acceptance. */
  async tasks(agent: Agent, taskIds?: readonly string[]): Promise<TaskRecord[]> {
    const { record, node } = await this.callerContext(agent)
    if (taskIds !== undefined && (taskIds.length > 16 || new Set(taskIds).size !== taskIds.length)) {
      throw new AtnRefusal('invalid-task-query', 'request at most 16 distinct task ids')
    }
    const tasks = taskIds === undefined
      ? Object.values(record.tasks).filter(task => task.holderId === node.id || task.requesterId === node.id)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, 16)
      : taskIds.map(id => {
        const task = record.tasks[id]
        if (task === undefined) throw new AtnRefusal('unknown-task', `unknown task ${id}`)
        return task
      })
    return structuredClone(tasks)
  }

  /** Inspect work and resources; an idle node may select one orphan to recover. */
  async status(agent: Agent, input: StatusInput = {}) {
    // Validate read arguments before any optional mutation.
    await this.tasks(agent, input.taskIds)
    if ([input.claimTaskId, input.review, input.rewire].filter(value => value !== undefined).length > 1) {
      throw new AtnRefusal('multiple-status-mutations', 'status accepts only one of claimTaskId, review or rewire per call')
    }
    const claimedTask = input.claimTaskId === undefined ? undefined : await this.claim(agent, input.claimTaskId)
    const reviewedTask = input.review === undefined ? undefined : await this.feedback(agent, input.review)
    const rewire = input.rewire === undefined ? undefined : await this.rewire(agent, input.rewire)
    const peers = await this.peers(agent, input.query)
    const tasks = await this.tasks(agent, input.taskIds)
    const { record, node } = await this.callerContext(agent)
    const candidates = orphanTasks(record)
    const terms = input.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? []
    const relevant = terms.length === 0 || input.query?.trim() === '*' ? candidates : candidates.filter(task => {
      const text = `${task.description} ${task.context}`.toLowerCase()
      return terms.some(term => text.includes(term))
    })
    return { ...peers, tasks, orphanTasks: structuredClone(relevant.slice(0, 16)),
      orphanTasksRemaining: Math.max(0, relevant.length - 16),
      budget: { stepsUsed: node.stepsUsed ?? 0, stepBudget: record.limits.stepBudget,
        maxCollaborationPeers: collaborationPeerLimit(record),
        stepsRemaining: Math.max(0, record.limits.stepBudget - (node.stepsUsed ?? 0)), deadlineAt: record.deadlineAt },
      ...(claimedTask === undefined ? {} : { claimedTask }),
      ...(reviewedTask === undefined ? {} : { reviewedTask }),
      ...(rewire === undefined ? {} : { rewire }) }
  }

  /** Preserve the failed attempt and atomically create its single recovery task. */
  async claim(agent: Agent, taskId: string): Promise<TaskRecord> {
    const { record, node } = await this.callerContext(agent)
    const committed = await this.mutate(record.id, current => {
      const caller = current.nodes[node.id]!
      if (current.status !== 'open' || this.now() >= current.deadlineAt || caller.lifecycle !== 'active'
        || (caller.stepsUsed ?? 0) >= current.limits.stepBudget) {
        throw new AtnRefusal('claim-unavailable', 'claim requires an active node with remaining budget in an open network')
      }
      if (openTasks(current).some(task => task.holderId === node.id)) {
        throw new AtnRefusal('claim-busy', 'settle your current tasks before claiming abandoned work')
      }
      const source = orphanTasks(current).find(task => task.id === taskId)
      if (source === undefined) throw new AtnRefusal('not-orphan', `task ${taskId} is not available for claim`)
      this.admitOutbound(current, caller, { channel: 'status.claim', input: { taskId } })
      const created = createTask(current, { holderId: node.id, requesterId: source.requesterId,
        kind: source.kind,
        description: source.description, context: source.context, dependsOn: source.dependsOn,
        retryOf: source.id, now: this.now() })
      const enqueued = enqueueMail(created.record, { fromId: source.requesterId, toId: node.id, kind: 'task',
        taskId: created.taskId, proposalId: null,
        body: `Recovery task claimed. Use atn_status to read task ${created.taskId} and its full context.`, now: this.now() })
      return { record: enqueued.record, value: { source, task: enqueued.record.tasks[created.taskId]!, mailId: enqueued.mailId } }
    })
    try {
      await this.ctx.parallel('atn/task-claimed', { networkId: record.id, sourceTask: structuredClone(committed.value.source),
        task: structuredClone(committed.value.task), sessionId: node.sessionId, at: this.now() })
    } catch (error) {
      this.ctx.logger.warn(`dsh-atn claim observer failed: ${describe(error)}`)
    }
    await this.attemptDelivery(record.id, committed.value.mailId)
    return structuredClone(committed.value.task)
  }

  /** Replace only the caller's outgoing edges; task and vote obligations stay put. */
  async rewire(agent: Agent, input: RewireInput): Promise<RewireResult> {
    const { record, node } = await this.callerContext(agent)
    const committed = await this.mutate(record.id, current => {
      if (this.now() >= current.deadlineAt) throw new AtnRefusal('network-expired', 'the network deadline has passed')
      this.admitOutbound(current, current.nodes[node.id]!, { channel: 'status.rewire', input })
      const intent = input.intent ?? 'exploration'
      if (intent !== 'exploration' && intent !== 'verified-improvement') throw new AtnRefusal('invalid-rewire-intent', 'invalid rewire intent')
      const previousPeers = collaborationPeers(current.nodes, node.id, collaborationPeerLimit(current))
      const rewired = rewireNode(current, node.id, input.peers)
      const localSamples = input.baselineTaskIds === undefined && input.candidateTaskIds === undefined
        ? selectRequesterRewireSamples(current, { requesterId: node.id, previousPeers, nextPeers: input.peers })
        : { baselineTaskIds: input.baselineTaskIds ?? [], candidateTaskIds: input.candidateTaskIds ?? [] }
      // Both layers inspect the same samples; only the host layer can establish
      // verified quality/cost evidence. Neither layer grants rewire permission.
      const evaluation = evaluateRewireEvidence(current, {
        requesterId: node.id, previousPeers, nextPeers: input.peers, ...localSamples,
      })
      const requesterEvaluation = evaluateCumulativeRequesterRewire(current, {
        requesterId: node.id, previousPeers, nextPeers: input.peers,
      }, this.now())
      const allocated = allocateId(rewired, 'rewire')
      const rewireId = allocated.id
      const next = { ...allocated.next, rewireHistory: [...(current.rewireHistory ?? []), {
          id: rewireId, nodeId: node.id, createdAt: this.now(), previousPeers,
          nextPeers: [...input.peers], intent, evaluation, requesterEvaluation,
          observations: captureRewireObservations(current, node.id, previousPeers, input.peers, this.now()),
        }] }
      return { record: next, value: { self: node.id, neighbours: collaborationPeers(next.nodes, node.id, collaborationPeerLimit(next)), intent, evaluation, requesterEvaluation, rewireId } }
    })
    return committed.value
  }

  // --------------------------------------------------------------- finish

  /**
   * Request normal retirement: stop taking new work, keep existing obligations.
   *
   * @param agent - Calling agent.
   * @param reason - Optional retirement note.
   * @returns Lifecycle and outstanding obligations.
   */
  async finish(agent: Agent, reason?: string): Promise<FinishResult> {
    const { record, node } = await this.callerContext(agent)
    const committed = await this.mutate(record.id, (current) => {
      this.admitOutbound(current, current.nodes[node.id]!, { channel: 'finish.node', input: { reason } })
      const updated = requestDrain(current, node.id, reason ?? 'normal retirement requested')
      const current_node = updated.nodes[node.id]!
      return {
        record: updated,
        value: {
          nodeId: node.id,
          lifecycle: current_node.lifecycle,
          openTasks: openTasks(updated).filter((task) => task.holderId === node.id).map((task) => task.id),
          pendingVotes: Object.values(updated.proposals)
            .filter((proposal) => proposal.status === 'pending' && proposal.voters.includes(node.id) && !proposal.votes.some((vote) => vote.voterId === node.id))
            .map((proposal) => proposal.id),
        },
      }
    })
    return committed.value
  }

  // -------------------------------------------------------------- propose

  /**
   * Open one immutable shared-document proposal.
   *
   * @param agent - Proposing agent.
   * @param input - Replacement document and rationale.
   * @returns Proposal id, base version, frozen approvers and deadline.
   */
  async propose(agent: Agent, input: ProposeInput): Promise<ProposeResult> {
    const { record, node } = await this.callerContext(agent)
    const committed = await this.mutate(record.id, (current) => {
      this.admitOutbound(current, current.nodes[node.id]!, { channel: 'propose', input })
      const opened = openProposal(current, {
        proposerId: node.id,
        document: input.document,
        rationale: input.rationale,
        now: this.now(),
      })
      let working = opened.record
      const mails: { mailId: string; toId: string }[] = []
      for (const voter of opened.proposal.voters) {
        const enqueued = enqueueMail(working, {
          fromId: node.id,
          toId: voter,
          kind: 'note',
          taskId: null,
          proposalId: opened.proposal.id,
          body: `Host-managed review request for proposal ${opened.proposal.id}: resolve with ctx.atn.vote.`,
          now: this.now(),
        })
        working = enqueued.record
        mails.push({ mailId: enqueued.mailId, toId: voter })
      }
      return { record: working, value: { proposal: opened.proposal, mails } }
    })

    const stored = committed.record
    const proposal = stored.proposals[committed.value.proposal.id]!
    for (const { mailId } of committed.value.mails) await this.deliverMail(record.id, mailId)
    return {
      proposalId: proposal.id,
      baseVersion: proposal.baseVersion,
      voters: proposal.voters,
      deadlineAt: proposal.deadlineAt,
    }
  }

  // ----------------------------------------------------------------- vote

  /**
   * Cast one explicit vote on a proposal whose frozen list names the caller.
   *
   * @param agent - Voting agent; identity comes from the live agent.
   * @param input - Proposal, decision and optional reason.
   * @returns Proposal state and remaining approvers.
   */
  async vote(agent: Agent, input: VoteInput): Promise<VoteResult> {
    const { record, node } = await this.callerContext(agent)
    // The decision and the goal commit share one critical section, so two
    // concurrent last votes produce exactly one new revision.
    const committed = await this.mutate(record.id, (current) => {
      this.admitOutbound(current, current.nodes[node.id]!, { channel: 'vote', input })
      const result = castVote(current, {
        proposalId: input.proposalId,
        voterId: node.id,
        approve: input.approve,
        reason: input.reason ?? null,
        now: this.now(),
      })
      return { record: result.record, value: result }
    })
    // A concurrent voter may already have resolved the proposal. Report the
    // latest durable state; input serialization makes concurrent broadcasts safe.
    const latest = await this.inspect(record.id)
    return this.reportVote(committed.value, latest, input.proposalId, record.id)
  }

  /**
   * Build one vote answer, synchronizing a decision a concurrent caller could
   * have already committed.
   *
   * @param decision - What this caller's mutation determined.
   * @param latest - Latest stored record.
   * @param proposalId - Proposal being answered.
   * @param networkId - Network owning the proposal.
   * @returns The vote result.
   */
  private async reportVote(decision: CastVoteResult, latest: NetworkRecord, proposalId: string, networkId: string): Promise<VoteResult> {
    const proposal = latest.proposals[proposalId] ?? decision.proposal
    const outstanding = proposal.voters.filter((voter) => !proposal.votes.some((vote) => vote.voterId === voter))
    if (!decision.idempotent && proposal.status === 'committed') {
      const version = proposal.committedVersion ?? currentGoal(latest).version
      // The answer is already durable. Complete context checkpoints before
      // returning so the next request cannot race ahead of a successful sync;
      // these checkpoints never await any recipient's driver or model turn.
      try {
        await this.broadcastGoal(version, latest)
      } catch (error) {
        this.ctx.logger.warn(`dsh-atn could not broadcast goal v${version} of ${networkId}: ${describe(error)}`)
      }
    }
    return {
      proposalId: proposal.id,
      status: proposal.status,
      committedVersion: proposal.committedVersion,
      idempotent: decision.idempotent,
      outstanding,
    }
  }

  /**
   * Hand the newest committed revision to every node that still runs, one
   * durable "synced" fact per node so the same snapshot is never appended
   * twice. A node with no live Agent keeps owing the revision, and recovery
   * replays it.
   *
   * @param version - Committed revision being announced.
   * @param record - Record holding the revision.
   */
  private async broadcastGoal(version: number, record: NetworkRecord): Promise<void> {
    const revision = record.goalHistory.find((entry) => entry.version === version)
    if (revision === undefined) return
    await Promise.all(Object.values(record.nodes).map(async node => {
      if (node.lifecycle !== 'active' && node.lifecycle !== 'draining') return
      const target = this.ctx.agents.get(SessionId(node.sessionId))
      if (target === undefined) return
      // Context sync never wakes an idle node: it is queued for its next request.
      await this.syncGoalIfNeeded(record.id, node.id, target, false)
    }))
  }

  /**
   * Give one node the newest committed revision if it has not read it yet.
   *
   * A sync is only recorded once the message actually reached the node's live
   * input, so an interrupted commit is replayed by recovery instead of being
   * remembered as delivered.
   *
   * @param networkId - Network whose revision is synced.
   * @param nodeId - Node being brought up to date.
   * @param target - The node's live agent.
   * @param wake - Whether the sync may start a driver; a version broadcast must not.
   * @returns The record after the sync, or `undefined` when nothing changed.
   */
  private async syncGoalIfNeeded(networkId: string, nodeId: string, target: Agent, wake = true): Promise<NetworkRecord | undefined> {
    return this.withInput(target.id, async () => {
      const record = await this.inspect(networkId)
      const node = record.nodes[nodeId]
      if (record.status !== 'open' || this.closing || node === undefined || (node.lifecycle !== 'active' && node.lifecycle !== 'draining')) return undefined
      const revision = currentGoal(record)
      const message = goalSnapshotMessage(revision, networkId, record.goalHistory[0]!.document)
      const present = this.alreadyQueued(target, message)
      if (present && (node.lastGoalVersionSent ?? 0) >= revision.version) return undefined
      if (!present) await this.recordModelInput(target, message, networkId, nodeId, wake)
      if (!await this.ctx.sessions.flush(target.session)) return undefined
      return (await this.mutate(networkId, current => applied(markGoalSynced(current, nodeId, revision.version)))).record
    })
  }

  // ---------------------------------------------------------------- renew

  /**
   * Extend a node's lease inside the recorded bounds, justified by one task the
   * node still holds open.
   *
   * @param agent - Calling agent.
   * @param input - Requested extension and the task that justifies it.
   * @returns New deadline and the granted extension.
   */
  async renew(agent: Agent, input: RenewInput): Promise<RenewResult> {
    const { record, node } = await this.callerContext(agent)
    if (record.status !== 'open') throw new AtnRefusal('network-closed', `network ${record.id} is ${record.status}`)
    if (this.stopped.has(record.id)) throw new AtnRefusal('network-stopped', `network ${record.id} is stopped and cannot be renewed`)
    if (input.taskId === undefined || input.taskId.length === 0) {
      throw new AtnRefusal('missing-task', 'renewal must name the open task that still needs this node')
    }

    const committed = await this.mutate<RenewResult>(record.id, (current) => {
      if (current.status !== 'open') throw new AtnRefusal('network-closed', `network ${current.id} is ${current.status}`)
      const holder = current.nodes[node.id]
      if (holder === undefined) throw new AtnRefusal('unknown-node', `node ${node.id} is not part of network ${current.id}`)
      if (holder.lifecycle !== 'active' && holder.lifecycle !== 'draining') {
        throw new AtnRefusal('not-active', `node ${holder.id} is ${holder.lifecycle} and cannot renew a lease`)
      }
      this.admitOutbound(current, holder, { channel: 'renew', input })
      const task = current.tasks[input.taskId]
      if (task === undefined) throw new AtnRefusal('unknown-task', `task ${input.taskId} is not part of network ${current.id}`)
      if (task.holderId !== holder.id) {
        throw new AtnRefusal('not-holder', `node ${holder.id} does not hold task ${input.taskId}, held by ${task.holderId}`)
      }
      if (task.status !== 'open') throw new AtnRefusal('task-settled', `task ${input.taskId} is ${task.status}`)

      const now = this.now()
      const requested = Math.max(0, Math.min(input.extendMs, current.limits.maxLeaseExtensionMs))
      const base = Math.max(holder.leaseDeadlineAt ?? now, now)
      const deadline = Math.min(base + requested, current.deadlineAt)
      return {
        record: {
          ...current,
          nodes: {
            ...current.nodes,
            [holder.id]: {
              ...holder,
              leaseDeadlineAt: deadline,
              note: input.basis === undefined || input.basis.length === 0 ? `renewed for task ${input.taskId}` : `${input.basis} (task ${input.taskId})`,
            },
          },
        },
        value: { leaseDeadlineAt: deadline, grantedMs: Math.max(0, deadline - base) },
      }
    })
    return committed.value
  }

  // -------------------------------------------------------------- deliver

  /**
   * Record the current delivery holder's user-facing result and complete the network when
   * every mechanical condition is met.
   *
   * @param agent - Calling entry agent or holder of the claimed delivery obligation.
   * @param input - Summary, evidence and the goal version it was produced against.
   * @returns Whether completion was accepted, and why not when it was not.
   */
  async deliver(agent: Agent, input: DeliverInput): Promise<DeliverResult> {
    const { record, node } = await this.callerContext(agent)
    if (record.status === 'open' && deliveryHolderOf(record) !== node.id) {
      throw new AtnRefusal('not-delivery-holder', `node ${node.id} does not hold the delivery obligation of network ${record.id}`)
    }
    const goalVersion = currentGoal(record).version

    if (input.goalVersion !== goalVersion) {
      return {
        accepted: false,
        reason: `delivery was produced against goal version ${input.goalVersion} but the current version is ${goalVersion}`,
        goalVersion,
        releasedNodes: [],
      }
    }
    if (record.status !== 'open') {
      return { accepted: false, reason: `network ${record.id} is ${record.status}`, goalVersion, releasedNodes: [] }
    }

    // The holder may have consumed a result in this very model request. Refresh
    // its durable receipts before evaluating completion, without waiting for a
    // driver or forcing a retry loop until the next scheduler tick.
    // Admission must precede receipt flushing as that can persist delivery state.
    // Recheck inside the completion transaction against its authoritative record.
    this.admitOutbound(record, node, { channel: 'finish.network', input })
    const receipts: string[] = []
    const undeliverable: string[] = []
    for (const mail of pendingMails(record)) {
      const target = record.nodes[mail.toId]
      if (target === undefined || target.lifecycle === 'retired' || target.lifecycle === 'failed') {
        undeliverable.push(mail.id)
        continue
      }
      const sessionId = target.sessionId
      const recipient = sessionId === undefined ? undefined : this.ctx.agents.get(SessionId(sessionId))
      const proposal = mail.proposalId === null ? undefined : record.proposals[mail.proposalId]
      const message = proposal === undefined ? mailMessage(mail, record.id) : proposalMessage(proposal, record.id)
      if (recipient !== undefined && await this.flushInputReceipt(recipient, message)) receipts.push(mail.id)
    }

    // The completion gate and the final record are decided against the latest
    // record inside one critical section, so a concurrent result or proposal
    // cannot be written past the gate.
    const outcome = await this.mutate<{ accepted: boolean; reason: string | null }>(record.id, (current) => {
      const version = currentGoal(current).version
      if (version !== input.goalVersion) {
        return { record: current, value: { accepted: false, reason: `delivery was produced against goal version ${input.goalVersion} but the current version is ${version}` } }
      }
      if (current.status !== 'open') {
        return { record: current, value: { accepted: false, reason: `network ${current.id} is ${current.status}` } }
      }
      const now = this.now()
      const holder = current.nodes[node.id]
      if (holder === undefined || deliveryHolderOf(current) !== holder.id) {
        return { record: current, value: { accepted: false, reason: `node ${node.id} does not hold the delivery obligation` } }
      }
      this.admitOutbound(current, holder, { channel: 'finish.network', input })
      // Receipt reconciliation and final settlement share the admitted write.
      // A rejection above cannot commit even an unrelated mailbox checkpoint.
      for (const mailId of receipts) {
        if (current.mails[mailId]?.status === 'queued') current = markDelivered(current, mailId, this.now())
      }
      for (const mailId of undeliverable) {
        const target = current.nodes[current.mails[mailId]?.toId ?? '']
        if (current.mails[mailId]?.status === 'queued' &&
          (target === undefined || target.lifecycle === 'failed' || target.lifecycle === 'retired')) {
          current = markUndeliverable(current, mailId, 'network or recipient is closed', this.now())
        }
      }
      // Work held by other nodes, open review and undelivered results all block
      // completion; the holder's own local tasks are what this call settles.
      const foreignOpenTasks = openTasks(current).filter((task) => task.holderId !== holder.id)
      const proposals = Object.values(current.proposals).filter((proposal) => proposal.status === 'pending')
      const queued = pendingMails(current)
      const blockers: string[] = []
      if (Object.values(current.nodes).some(candidate => candidate.lifecycle === 'provisioning')) blockers.push('node creation is in progress')
      if (foreignOpenTasks.length > 0) {
        blockers.push(`${foreignOpenTasks.length} open task(s): ${foreignOpenTasks.map((task) => task.id).join(', ')}`)
      }
      if (proposals.length > 0) {
        blockers.push(`${proposals.length} pending proposal(s): ${proposals.map((proposal) => proposal.id).join(', ')}`)
      }
      if (queued.length > 0) blockers.push(`${queued.length} undelivered mail record(s)`)
      if (blockers.length > 0) {
        return { record: current, value: { accepted: false, reason: `completion refused: ${blockers.join('; ')}` } }
      }

      const ownTasks = openTasks(current).filter((task) => task.holderId === holder.id)
      const tasks = { ...current.tasks }
      for (const task of ownTasks) {
        tasks[task.id] = {
          ...task,
          status: 'completed',
          result: { summary: input.summary, evidence: [...input.evidence] },
          settledBy: holder.id,
          settledAt: now,
          holderStepsAtSettlement: holder.stepsUsed,
        }
      }
      const finalized: NetworkRecord = {
        ...current,
        status: 'completed',
        note: `delivered against goal v${version}: ${input.summary}`,
        tasks,
        nodes: Object.fromEntries(
          Object.entries(current.nodes).map(([id, candidate]) => [id, candidate.leaseDeadlineAt === null ? candidate : { ...candidate, leaseDeadlineAt: null }]),
        ),
      }
      return { record: finalized, value: { accepted: true, reason: null } }
    })

    if (!outcome.value.accepted) {
      return { accepted: false, reason: outcome.value.reason, goalVersion: currentGoal(outcome.record).version, releasedNodes: [] }
    }
    // A replacement holder can be an ATN-owned worker executing this very tool.
    // Let the scheduler release that handle after its tool stack returns.
    const released = await this.releaseOwnedHandles(record.id, 'network completed', this.cleanupTimeoutMs, node.id)
    return { accepted: true, reason: null, goalVersion: input.goalVersion, releasedNodes: released }
  }

  /** Current submission authority, without mutating the network or taking its write queue. */
  async deliveryHolder(networkId: string): Promise<string | null> {
    return deliveryHolderOf(await this.requireNetwork(networkId))
  }

  // ----------------------------------------------------------------- stop

  /**
   * Host-facing hard stop. This entry does not need the model to cooperate:
   * it closes the network durably first, then interrupts and awaits every
   * ATN-owned handle.
   *
   * The call is idempotent: a repeated stop reports the same terminal facts
   * instead of re-deriving them, and a `stopped` network is never reopened by
   * renew, spawn, vote, mail replay or recovery.
   *
   * @param networkId - Network to stop.
   * @param reason - Why the network is being stopped.
   * @returns Released and straggling nodes.
   */
  async stop(networkId: string, reason: string): Promise<StopReport> {
    const prior = this.stopReports.get(networkId)
    if (prior !== undefined) return prior
    const running = this.stopRuns.get(networkId)
    if (running !== undefined) return running
    const run = this.stopOnce(networkId, reason)
    this.stopRuns.set(networkId, run)
    try { return await run }
    finally { if (this.stopRuns.get(networkId) === run) this.stopRuns.delete(networkId) }
  }

  private async stopOnce(networkId: string, reason: string): Promise<StopReport> {
    const deadline = Date.now() + this.cleanupTimeoutMs
    const stopped = await this.mutate(networkId, (current) => {
      if (current.status === 'stopped') return applied(current)
      const cancelled = cancelPendingProposals(current, `network stopped: ${reason}`, this.now())
      let tasks = cancelled.tasks
      for (const task of Object.values(tasks)) {
        if (task.status !== 'open') continue
        tasks = {
          ...tasks,
          [task.id]: {
            ...task,
            status: 'failed',
            settledBy: task.holderId,
            settledAt: this.now(),
            holderStepsAtSettlement: current.nodes[task.holderId]?.stepsUsed,
            result: { summary: `cancelled by network stop: ${reason}`, evidence: [] },
          },
        }
      }
      return applied({
        ...cancelled,
        status: 'stopped',
        note: reason,
        tasks,
        nodes: Object.fromEntries(
          Object.entries(cancelled.nodes).map(([id, node]) => [
            id,
            node.lifecycle === 'retired' || node.lifecycle === 'failed'
              ? node
              : { ...node, lifecycle: 'failed' as const, leaseDeadlineAt: null, note: `stopped: ${reason}` },
          ]),
        ),
      })
    }, false)
    reason = stopped.record.note ?? reason
    this.stopped.add(networkId)
    const creating = [...this.activations.values()].filter(item => item.networkId === networkId)
    for (const item of creating) item.controller.abort(new Error(`network stopped: ${reason}`))
    // Cancel live drivers immediately; do not wait for slow creation before disposal.
    const releasing = this.releaseOwnedHandles(networkId, reason, Math.max(0, deadline - Date.now()))
    await waitBounded(Promise.allSettled(creating.map(item => item.done)), Math.max(0, deadline - Date.now()))
    await releasing
    const sessions = new Set(Object.values((await this.inspect(networkId)).nodes).filter(node => !node.isEntry).map(node => node.sessionId))
    const outcomes = await this.releaser.settle(sessions, Math.max(0, deadline - Date.now()))
    const released = outcomes.filter(item => item.status === 'released').map(item => item.nodeId)
    const pending: HandleReleaseOutcome[] = outcomes.filter(item => item.status !== 'released')
    for (const [sessionId, item] of this.activations) {
      if (item.networkId !== networkId || pending.some(outcome => outcome.sessionId === sessionId)) continue
      pending.push({ sessionId, nodeId: this.nodeOfSession.get(sessionId) ?? sessionId, status: 'timed-out', reason: 'agent creation/resume has not settled' })
    }
    const report: StopReport = {
      networkId,
      status: 'stopped',
      released,
      stragglers: pending.map((outcome) => outcome.nodeId),
      stragglerDetails: pending.map((outcome) => ({
        nodeId: outcome.nodeId,
        sessionId: outcome.sessionId,
        status: outcome.status,
        reason: outcome.reason ?? 'dispose did not settle inside the cleanup window',
      })),
      reason,
    }
    this.stopReports.set(networkId, report)
    return report
  }

  /**
   * Release every non-entry ATN-owned handle of one network and report each
   * operation's own outcome.
   *
   * Only a confirmed `dispose()` success counts as `released`; failures and
   * timeouts stay discoverable as stragglers, and the handle map entry survives
   * until the release is confirmed.
   *
   * @param networkId - Network whose handles are released.
   * @param reason - Why the release is happening.
   * @returns Node ids whose disposal was confirmed.
   */
  private async releaseOwnedHandles(networkId: string, reason: string, timeoutMs = this.cleanupTimeoutMs, excludeNodeId?: string): Promise<string[]> {
    const record = await this.requireNetwork(networkId)
    const sessions = new Set<string>()
    for (const node of Object.values(record.nodes)) {
      if (node.isEntry || node.id === excludeNodeId) continue
      if (record.status === 'completed' && this.ctx.agents.get(SessionId(node.sessionId))?.status === 'running'
        && Object.values(record.tasks).some(task => task.kind === 'delivery' && task.status === 'completed' && task.settledBy === node.id)) {
        continue
      }
      sessions.add(node.sessionId)
      const handle = this.handles.get(node.sessionId)
      if (handle !== undefined) this.beginRelease(node.id, node.sessionId, handle)
    }
    const outcomes = await this.releaser.settle(sessions, timeoutMs)
    void reason
    return outcomes.filter(outcome => outcome.status === 'released').map(outcome => outcome.nodeId)
  }

  // -------------------------------------------------------------- context

  /**
   * Put an ATN message into a node's model input through a logged channel.
   *
   * A `notice`-class sync uses `inject`, which never wakes an idle node; work
   * delivery uses `followup`, which starts the node's own driver.
   *
   * @param target - Target agent.
   * @param message - Message to land in the session log.
   * @param networkId - Network the message belongs to.
   * @param nodeId - Node the message belongs to.
   * @param wake - Whether delivery may start a driver for an idle node.
   */
  private async recordModelInput(target: Agent, message: UserMessage, networkId: string, nodeId: string, wake = true): Promise<void> {
    if (wake && target.status !== 'running') target.followup(message)
    else target.inject(message)
    this.rememberInput(target, message)
    void networkId
    void nodeId
  }

  // ------------------------------------------------------------ scheduler

  /** Terminalize one node without losing task attempts, mail or review history. */
  private closeNode(record: NetworkRecord, nodeId: string, lifecycle: 'failed' | 'retired', reason: string): NetworkRecord {
    const node = record.nodes[nodeId]
    if (node === undefined) throw new AtnRefusal('unknown-node', `unknown node ${nodeId}`)
    if (node.lifecycle === 'failed' || node.lifecycle === 'retired') return record
    const now = this.now()
    let next: NetworkRecord = { ...record, nodes: { ...record.nodes,
      [nodeId]: { ...node, lifecycle, leaseDeadlineAt: null, note: reason } } }
    for (const task of openTasks(next)) {
      if (task.holderId === nodeId) next = markTaskUnreachable(next, task.id, reason, now)
    }
    for (const mail of Object.values(next.mails)) {
      if (mail.toId === nodeId && mail.status === 'queued') next = markUndeliverable(next, mail.id, reason, now)
    }
    const proposals = { ...next.proposals }
    for (const proposal of Object.values(proposals)) {
      if (proposal.status === 'pending' && (proposal.proposerId === nodeId || proposal.voters.includes(nodeId))) {
        proposals[proposal.id] = { ...proposal, status: 'cancelled', settledAt: now, note: reason }
      }
    }
    return materializeDeliveryTask({ ...next, proposals }, now)
  }

  /** Host-only failure injection/notification; invoke outside the target's own tool stack. */
  async failNode(networkId: string, nodeId: string, reason: string): Promise<void> {
    await this.mutate(networkId, current => {
      if (current.status !== 'open') throw new AtnRefusal('network-closed', `network ${networkId} is ${current.status}`)
      return applied(this.closeNode(current, nodeId, 'failed', reason))
    })
    await this.releaseSpecificHandles(networkId, new Set([nodeId]))
  }

  private retireExhaustedNodes(record: NetworkRecord): NetworkRecord {
    let next = record
    for (const node of Object.values(record.nodes)) {
      // Allow the last admitted call to finish its tools before retiring it.
      if ((node.stepsUsed ?? 0) < record.limits.stepBudget || this.ctx.agents.get(SessionId(node.sessionId))?.status === 'running') continue
      next = this.closeNode(next, node.id, 'retired', 'node step budget exhausted')
    }
    return next
  }

  private startScheduler(): void {
    if (this.timer !== null) return
    const period = Math.max(MIN_TICK_MS, Math.min(this.config.defaultLeaseMs, 1000))
    this.timer = setInterval(() => {
      if (this.closing || this.tickTail !== null) return
      void this.tick().catch((error: unknown) => {
        this.ctx.logger.warn(`dsh-atn scheduler tick failed: ${describe(error)}`)
      })
    }, period)
    this.timer.unref?.()
    this.scope.ctx.effect(() => () => {
      if (this.timer !== null) {
        clearInterval(this.timer)
        this.timer = null
      }
    }, 'atn-scheduler')
  }

  /**
   * Run one scheduler pass: expire review deadlines, release settled draining
   * nodes, expire leases, replay queued mail and enforce the network deadline.
   *
   * A node that became terminal in this pass is released in the same pass, so
   * `retired` never means "still running".
   * Explicit calls queue a fresh pass after any in-flight pass, so awaiting one
   * also covers changes committed after the earlier pass inspected a network.
   *
   * @returns The network ids that changed during this pass.
   */
  async tick(): Promise<string[]> {
    if (this.closing) return []
    const previous = this.tickTail ?? Promise.resolve()
    const run = previous.then(() => this.closing ? [] : this.tickOnce())
    // A failure belongs to its caller and must not poison subsequent passes.
    const tail = run.then(() => undefined, () => undefined)
    this.tickTail = tail
    try {
      return await run
    } finally {
      if (this.tickTail === tail) this.tickTail = null
    }
  }

  private async tickOnce(): Promise<string[]> {
    const store = await this.openStore()
    const changed: string[] = []
    for (const id of await store.list()) {
      const record = await store.load(id)
      if (record === undefined) continue
      if (record.status !== 'open') {
        await this.releaseOwnedHandles(id, 'terminal network')
        continue
      }
      const now = this.now()
      const committed = await this.mutate(id, (current) => {
        if (current.status !== 'open') return { record: current, value: { changed: false, terminal: new Set<string>() } }
        const expired = expireProposals(current, now)
        const leased = this.expireLeases(expired, now)
        const retired = materializeDeliveryTask(retireSettledNodes(this.retireExhaustedNodes(leased), now), now)
        const terminal = this.terminalNodesOf(current, retired)
        return { record: retired, value: { changed: retired !== current, terminal } }
      })
      if (committed.value.changed) changed.push(id)
      if (committed.value.terminal.size > 0) {
        await this.releaseSpecificHandles(id, committed.value.terminal)
      }
      await this.drainMailbox(id)
      const latest = await this.requireNetwork(id)
      if (now >= latest.deadlineAt) {
        await this.stop(id, 'network deadline reached')
        changed.push(id)
      }
    }
    return changed
  }

  private expireLeases(record: NetworkRecord, now: number): NetworkRecord {
    let next = record
    for (const node of Object.values(record.nodes)) {
      if (node.lifecycle !== 'active' || node.leaseDeadlineAt === null) continue
      if (now < node.leaseDeadlineAt) continue
      next = requestDrain(next, node.id, 'lease expired')
    }
    return next
  }

  /** Node ids that were not terminal before and are terminal now. */
  private terminalNodesOf(before: NetworkRecord, after: NetworkRecord): Set<string> {
    const terminal = new Set<string>()
    for (const [id, node] of Object.entries(after.nodes)) {
      if (node.lifecycle === 'retired' || node.lifecycle === 'failed') terminal.add(id)
    }
    return terminal
  }

  /**
   * Release the handles of nodes that just became terminal, at a safe step
   * boundary, without waiting inside any Agent's own `execute()` stack.
   *
   * @param networkId - Network whose nodes retired.
   * @param nodeIds - Nodes that became terminal in this pass.
   */
  private async releaseSpecificHandles(networkId: string, nodeIds: Set<string>): Promise<void> {
    const record = await this.requireStore().load(networkId)
    for (const nodeId of nodeIds) {
      const node = record?.nodes[nodeId]
      if (node === undefined || node.isEntry) continue
      const handle = this.handles.get(node.sessionId)
      if (handle === undefined) continue
      this.beginRelease(nodeId, node.sessionId, handle)
    }
    await this.releaser.settle(new Set([...nodeIds].map(id => record!.nodes[id]!.sessionId)))
  }
  private async drainMailbox(networkId: string): Promise<void> {
    const record = await this.requireNetwork(networkId)
    for (const mail of pendingMails(record)) {
      if (mail.status !== 'queued') continue
      await this.deliverMail(networkId, mail.id)
    }
  }

  // -------------------------------------------------------------- recovery

  /**
   * Rebuild runtime state from the durable store after a plugin reload or
   * process restart. Terminal networks are never reopened; a creation that
   * never finished is either rebuilt on its recorded session or failed.
   *
   * Every active or draining node that was resumed is brought up to date with
   * the newest committed goal revision, because a commit that happened while
   * the node had no live Agent could not be recorded as synced.
   *
   * @returns One recovery decision per stored node that needed attention.
   */
  async recover(): Promise<{ networkId: string; nodeId: string; action: string; reason: string }[]> {
    // One recovery pass per plugin instance: concurrent callers share it, so a
    // session is never activated twice.
    this.recoveryRun ??= this.recoverOnce().finally(() => {
      this.recoveryRun = null
    })
    return this.recoveryRun
  }

  private async recoverOnce(): Promise<{ networkId: string; nodeId: string; action: string; reason: string }[]> {
    const store = await this.openStore()
    const report: { networkId: string; nodeId: string; action: string; reason: string }[] = []
    for (const id of await store.list()) {
      const record = await store.load(id)
      if (record === undefined) continue
      this.syncIndex(record)
      if (record.status !== 'open') continue
      // The resume attempt itself decides whether a session can be rebuilt; a
      // plan that assumed success keeps the decision path in one place.
      const decisions = planRecovery(record, () => true)
      for (const decision of decisions) {
        const node = record.nodes[decision.nodeId]!
        if (decision.action === 'leave') {
          report.push({ networkId: id, nodeId: node.id, action: 'leave', reason: decision.reason })
          continue
        }
        if (decision.action === 'fail') {
          await this.mutate(id, (current) => applied(failProvisioning(current, node.sessionId, decision.reason)))
          await this.requeueTasks(await this.requireNetwork(id), node.id)
          report.push({ networkId: id, nodeId: node.id, action: 'fail', reason: decision.reason })
          continue
        }
        if (node.isEntry) {
          report.push({ networkId: id, nodeId: node.id, action: 'leave', reason: 'the entry node is host-owned' })
          continue
        }
        if (this.activations.has(node.sessionId)) {
          report.push({ networkId: id, nodeId: node.id, action: 'leave', reason: 'creation or resume is already in progress' })
          continue
        }
        if (this.handles.has(node.sessionId)) {
          const existing = this.ctx.agents.get(SessionId(node.sessionId))
          if (existing !== undefined) await this.syncGoalIfNeeded(id, node.id, existing)
          report.push({ networkId: id, nodeId: node.id, action: 'leave', reason: 'this session is already activated' })
          continue
        }
        try {
          await this.activate(id, node.sessionId, async signal => {
            signal.throwIfAborted()
            const latest = await this.inspect(id)
            const currentNode = latest.nodes[node.id]
            if (latest.status !== 'open' || currentNode === undefined || currentNode.lifecycle === 'retired' || currentNode.lifecycle === 'failed') {
              throw new AtnRefusal('network-closed', 'node cannot be resumed after closure')
            }
            // Older pending records carry no initial assignment. Do not publish
            // an empty worker as a successful recovery.
            if (currentNode.creationState === 'pending' && !Object.values(latest.tasks).some(task => task.holderId === node.id)) {
              throw new AtnRefusal('incomplete-intent', 'pending creation has no durable initial task')
            }
            const handle = await this.owner.agents.resume({
              resumeSessionId: SessionId(node.sessionId), signal,
              setup: async (agentCtx): Promise<void> => {
                if (node.presetId === null) return
                const presets = agentCtx.get('agentPresets')
                if (presets === undefined) throw new AtnRefusal('preset-unavailable', `cannot restore preset ${node.presetId} without the registry`)
                // Resolve this node's durable identity, never the current default
                // or a surviving relative's possibly different composition.
                await presets.mount(agentCtx, node.presetId)
              },
              agentOptions: {
                provider: node.modelRoute.provider === 'inherit' ? undefined : node.modelRoute.provider,
                model: node.modelRoute.model === 'inherit' ? undefined : node.modelRoute.model,
                reasoningEffort: effortOption(node.modelRoute.effort),
              },
            })
            this.handles.set(node.sessionId, handle)
            try {
              await this.mutate(id, current => {
                signal.throwIfAborted()
                const candidate = current.nodes[node.id]
                if (current.status !== 'open' || this.closing || candidate === undefined || candidate.lifecycle === 'failed' || candidate.lifecycle === 'retired') {
                  throw new AtnRefusal('network-closed', 'node closed while resume was in progress')
                }
                return applied(candidate.creationState === 'pending'
                  ? connectPublishedNode(publishNode(current, node.sessionId, this.now()).record, node.id)
                  : current)
              })
              await this.syncGoalIfNeeded(id, node.id, handle.agent)
            } catch (error) {
              await this.disposeDetachedHandle(handle, node.sessionId, node.id, describe(error))
              throw error
            }
          })
          report.push({ networkId: id, nodeId: node.id, action: 'resume', reason: decision.reason })
        } catch (error) {
          const note = `recovery could not rebuild this node: ${describe(error)}`
          await this.compensateSpawnFailure(id, node.sessionId, note)
          report.push({ networkId: id, nodeId: node.id, action: 'fail', reason: note })
        }
      }
      await this.drainMailbox(id)
    }
    if (report.some((entry) => entry.action !== 'leave')) this.startScheduler()
    return report
  }

  private async requeueTasks(record: NetworkRecord, failedNodeId: string): Promise<void> {
    const now = this.now()
    for (const task of openTasks(record)) {
      if (task.holderId !== failedNodeId) continue
      const requester = record.nodes[task.requesterId]
      if (requester === undefined || requester.lifecycle !== 'active') {
        await this.mutate(record.id, (current) => applied(markTaskUnreachable(current, task.id, `holder ${failedNodeId} failed and requester is not active`, now)))
        continue
      }
      await this.mutate(record.id, (current) => applied({
        ...current,
        tasks: { ...current.tasks, [task.id]: { ...task, status: 'failed', settledAt: now,
          holderStepsAtSettlement: current.nodes[task.holderId]?.stepsUsed,
          result: { summary: `holder ${failedNodeId} could not be recovered`, evidence: [] } } },
      }))
    }
  }

  // -------------------------------------------------------------- teardown

  private async disposeRuntime(): Promise<void> {
    this.closing = true
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
    const deadline = Date.now() + this.cleanupTimeoutMs
    const active = [...this.activations.values()]
    for (const item of active) item.controller.abort(new Error('ATN runtime is shutting down'))
    for (const [sessionId, handle] of this.handles) this.beginRelease(this.nodeOfSession.get(sessionId) ?? sessionId, sessionId, handle)
    await waitBounded(Promise.allSettled(active.map(item => item.done)), Math.max(0, deadline - Date.now()))
    const outcomes = await this.releaser.settle(undefined, Math.max(0, deadline - Date.now()))
    const unresolved = outcomes.filter(item => item.status !== 'released')
    if (unresolved.length > 0) this.owner.logger.warn(`ATN shutdown has ${unresolved.length} unresolved handle(s)`)
    if (this.ownsStore) {
      await this.store?.close()
      this.store = null
      this.storeOpening = null
    }
  }

  /**
   * Read one stored network record. Diagnostics and tests use this instead of
   * reaching into the store.
   *
   * @param networkId - Network id.
   * @returns The stored record.
   */
  async network(networkId: string): Promise<NetworkRecord> {
    return this.requireNetwork(networkId)
  }

  /**
   * List stored network ids.
   *
   * @returns Every network id this runtime has persisted.
   */
  async networkIds(): Promise<string[]> {
    return this.requireStore().list()
  }

  /**
   * Resolve the network and node of one session.
   *
   * @param sessionId - Session id.
   * @returns The network record and node, or `undefined` when the session belongs to no network.
   */
  async findBySessionId(sessionId: string): Promise<{ record: NetworkRecord; node: NodeRecord } | undefined> {
    return this.findNetworkBySession(sessionId)
  }

  /**
   * Whether this runtime still holds a live, unreleased handle for a node.
   *
   * @param nodeId - Node id.
   * @returns True when the runtime owns a live handle.
   */
  ownsHandle(nodeId: string): boolean {
    return this.handleFor(nodeId) !== undefined
  }

  /**
   * Release every ATN-owned handle and close the durable store. The plugin
   * disposer calls this; tests call it directly.
   *
   * @returns Resolution after every owned resource settled.
   */
  async shutdown(): Promise<void> {
    await this.disposeRuntime()
    await this.scope.dispose()
  }

  /**
   * Handle of one node, for assertions and diagnostics.
   *
   * @param nodeId - Node id to look up.
   * @returns The live handle, or `undefined`.
   */
  handleFor(nodeId: string): AgentHandle | undefined {
    for (const [sessionId, handle] of this.handles) {
      if (this.nodeOfSession.get(sessionId) !== nodeId) continue
      if (this.releaser.isReleased(sessionId)) return undefined
      return handle
    }
    return undefined
  }

  /**
   * Pending outbound mail count of one node.
   *
   * @param networkId - Network id.
   * @param nodeId - Sender node.
   * @returns Number of queued mails from that node.
   */
  async pendingMail(networkId: string, nodeId: string): Promise<number> {
    return pendingMailFor(await this.requireNetwork(networkId), nodeId)
  }
}

/**
 * Project a recorded route effort onto agent options: `inherit` and an absent
 * effort both mean "use the provider's own default", never the profile default.
 *
 * @param effort - Recorded effort, or `null`.
 * @returns The option value to pass through.
 */
function effortOption(effort: string | null): ReasoningEffortId | undefined {
  if (effort === null || effort === 'inherit' || effort.length === 0) return undefined
  return effort as ReasoningEffortId
}

/**
 * Find the durable row a stable message id already names, refusing an id that
 * was reused for a different message.
 *
 * The task linkage is deliberately not part of the comparison for a `task` mail:
 * a retry asks for the work again, and the runtime answers with the task the
 * first delivery created instead of allocating a second one.
 *
 * @param record - Current network record.
 * @param input - Retry request.
 * @param senderId - Real sender resolved from the live agent.
 * @param targetId - Resolved target node.
 * @returns The existing mail, or `undefined` when the id is unused.
 * @throws MailIdentityError when the id already names a different message.
 */
function existingMail(
  record: NetworkRecord,
  input: SendInput,
  senderId: string,
  targetId: string,
): NetworkRecord['mails'][string] | undefined {
  if (input.messageId === undefined) return undefined
  const mail = record.mails[input.messageId]
  if (mail === undefined) return undefined
  if (mail.fromId !== senderId || mail.toId !== targetId || mail.kind !== input.kind || mail.body !== input.body || (input.kind === 'note' && mail.taskId !== (input.taskId ?? null))) {
    throw new MailIdentityError(
      `mail ${input.messageId} already exists from ${mail.fromId} to ${mail.toId} as ${mail.kind}; a stable id cannot be reused for a different message`,
    )
  }
  return mail
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
