/**
 * Durable record definitions for one ATN network.
 *
 * A network record is the unit of atomic persistence: every bounded collection
 * (nodes, tasks, mail, proposals, goal history) lives inside it so one
 * `NetworkStore.update` call is one committed transaction. The zod schemas here
 * validate the durable boundary only; values crossing typed same-process
 * interfaces are trusted, per the Harness convention.
 * @module dsh-atn/schema
 */
import { z } from 'zod'

/** Stable network identifier. */
export type NetworkId = string
/** Stable node identifier. */
export type NodeId = string
/** Harness session identifier backing a node. */
export type SessionId = string
/** Stable task identifier. */
export type TaskId = string
/** Stable mail identifier. */
export type MailId = string
/** Stable proposal identifier. */
export type ProposalId = string

/**
 * Lifecycle of a node. `provisioning` takes capacity but accepts no ordinary
 * work; `draining` keeps existing obligations and leaves the current topology;
 * `retired` and `failed` keep their records but never drive a model again.
 */
export const NODE_LIFECYCLES = ['provisioning', 'active', 'draining', 'retired', 'failed'] as const
/** One member of {@link NODE_LIFECYCLES}. */
export type NodeLifecycle = (typeof NODE_LIFECYCLES)[number]

/** Network-level status. `completed` and `stopped` are terminal and never reopen. */
export const NETWORK_STATUSES = ['open', 'completed', 'stopped'] as const
/** One member of {@link NETWORK_STATUSES}. */
export type NetworkStatus = (typeof NETWORK_STATUSES)[number]

/** Mail kinds. `result` settles a task; `note` carries no obligation. */
export const MAIL_KINDS = ['task', 'note', 'result', 'delivery'] as const
/** One member of {@link MAIL_KINDS}. */
export type MailKind = (typeof MAIL_KINDS)[number]

/** Proposal terminal states. */
export const PROPOSAL_STATUSES = ['pending', 'committed', 'rejected', 'expired', 'stale', 'cancelled'] as const
/** One member of {@link PROPOSAL_STATUSES}. */
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

/** The short shared document every node reads: objective, success criteria, constraints. */
export const goalDocumentSchema = z
  .object({
    /** One-paragraph objective, or the replacement body of a committed proposal. */
    objective: z.string().min(1),
    /** How the network decides the objective is met. */
    successCriteria: z.string().min(1),
    /** Constraints every node must respect. */
    constraints: z.string(),
  })
  .strict()

/** {@link goalDocumentSchema} value type. */
export type GoalDocument = z.infer<typeof goalDocumentSchema>

/** One committed revision of the goal document. */
export const goalRevisionSchema = z
  .object({
    /** Monotonic revision number starting at 1; never reused. */
    version: z.number().int().positive(),
    /** Document body at this revision. */
    document: goalDocumentSchema,
    /** Node that proposed the revision; `null` for the network's initial document. */
    proposedBy: z.string().nullable(),
    /** Nodes whose recorded approval committed this revision; empty for the initial document. */
    approvedBy: z.array(z.string()),
    /** Commit timestamp (epoch ms). */
    committedAt: z.number().int().nonnegative(),
  })
  .strict()

/** {@link goalRevisionSchema} value type. */
export type GoalRevision = z.infer<typeof goalRevisionSchema>

/** Model route a node inherits from its creator's actual request configuration. */
export const modelRouteSchema = z
  .object({
    /** Provider id as recorded on the creating request. */
    provider: z.string(),
    /** Model id as recorded on the creating request. */
    model: z.string(),
    /** Reasoning effort when the creating request carried one. */
    effort: z.string().nullable(),
  })
  .strict()

/** {@link modelRouteSchema} value type. */
export type ModelRoute = z.infer<typeof modelRouteSchema>

/** One node of the network. */
export const nodeRecordSchema = z
  .object({
    /** Runtime-assigned node id; display names are never authorization. */
    id: z.string(),
    /** Harness session backing this node. */
    sessionId: z.string(),
    /** Birth origin. `null` only for the entry node, which the host owns. */
    creatorId: z.string().nullable(),
    /** First successfully published child; later children never replace it. */
    selectedChildId: z.string().nullable(),
    /** Current lifecycle. */
    lifecycle: z.enum(NODE_LIFECYCLES),
    /** Durable lease deadline in epoch ms; `null` when the node holds no lease. */
    leaseDeadlineAt: z.number().int().nonnegative().nullable(),
    /** Model route inherited from the actual creating request. */
    modelRoute: modelRouteSchema,
    /** Preset identity used at creation; `null` for a preset-less composition. */
    presetId: z.string().nullable(),
    /** Recorded delegated-policy overrides: the permission seed. Opaque JSON, never widened on recovery. */
    permissionSeed: z.unknown(),
    /** True when this node is the host-owned entry agent. */
    isEntry: z.boolean(),
    /** Provisioning state: `pending` is not yet visible to peers. */
    creationState: z.enum(['pending', 'published', 'failed']),
    /**
     * Newest committed goal revision whose snapshot was actually handed to this
     * node's live model input. `0` means "never synced"; a revision the network
     * skipped is owed again, which is what recovery replays. Optional so a
     * record written before this field existed still loads; readers treat a
     * missing value as `0`.
     */
    lastGoalVersionSent: z.number().int().nonnegative().optional(),
    /** Human-readable failure or retirement reason. */
    note: z.string().nullable(),
    /** Creation timestamp (epoch ms). */
    createdAt: z.number().int().nonnegative(),
  })
  .strict()

/** {@link nodeRecordSchema} value type. */
export type NodeRecord = z.infer<typeof nodeRecordSchema>

/** One unit of local work. */
export const taskRecordSchema = z
  .object({
    /** Runtime-assigned task id. */
    id: z.string(),
    /** Node expected to settle this task. */
    holderId: z.string(),
    /** Node that requested the work. */
    requesterId: z.string(),
    /** What must be done. */
    description: z.string().min(1),
    /** Context supplied with the request. */
    context: z.string(),
    /** Task state; `open` tasks block network completion. */
    status: z.enum(['open', 'completed', 'failed', 'unreachable']),
    /** Declared result; required once settled. */
    result: z
      .object({
        /** What the holder claims to have done. */
        summary: z.string(),
        /** Reviewable evidence references (paths, session ids, message ids). */
        evidence: z.array(z.string()),
      })
      .nullable(),
    /** Node that actually settled the task, when it differs from the holder. */
    settledBy: z.string().nullable(),
    /** Creation timestamp (epoch ms). */
    createdAt: z.number().int().nonnegative(),
    /** Settlement timestamp (epoch ms), `null` while open. */
    settledAt: z.number().int().nonnegative().nullable(),
  })
  .strict()

/** {@link taskRecordSchema} value type. */
export type TaskRecord = z.infer<typeof taskRecordSchema>

/** One durable mailbox entry. */
export const mailRecordSchema = z
  .object({
    /** Runtime-assigned mail id; doubles as the deduplication key. */
    id: z.string(),
    /** Real sender, taken from the calling agent and never from model arguments. */
    fromId: z.string(),
    /** Intended recipient. */
    toId: z.string(),
    /** Mail kind. */
    kind: z.enum(MAIL_KINDS),
    /** Related task, when this mail carries or settles work. */
    taskId: z.string().nullable(),
    /** Related proposal, when this mail concerns document review. */
    proposalId: z.string().nullable(),
    /** Body text. */
    body: z.string(),
    /** Delivery state: `queued` is durable but not yet in the target's input. */
    status: z.enum(['queued', 'delivered', 'undeliverable']),
    /** Enqueue timestamp (epoch ms). */
    enqueuedAt: z.number().int().nonnegative(),
    /** Delivery or undeliverable timestamp (epoch ms). */
    settledAt: z.number().int().nonnegative().nullable(),
    /** Why delivery failed, when it did. */
    note: z.string().nullable(),
  })
  .strict()

/** {@link mailRecordSchema} value type. */
export type MailRecord = z.infer<typeof mailRecordSchema>

/** One recorded vote. */
export const voteRecordSchema = z
  .object({
    /** Voter node id. */
    voterId: z.string(),
    /** Explicit approve (`true`) or reject (`false`); silence is never approval. */
    approve: z.boolean(),
    /** Optional rationale. */
    reason: z.string().nullable(),
    /** Vote timestamp (epoch ms). */
    at: z.number().int().nonnegative(),
  })
  .strict()

/** {@link voteRecordSchema} value type. */
export type VoteRecord = z.infer<typeof voteRecordSchema>

/** One immutable shared-document proposal. */
export const proposalRecordSchema = z
  .object({
    /** Runtime-assigned proposal id. */
    id: z.string(),
    /** Node that opened the proposal; never one of its own approvers. */
    proposerId: z.string(),
    /** Goal version this proposal was based on. */
    baseVersion: z.number().int().positive(),
    /** Full replacement document, fixed at proposal time. */
    document: goalDocumentSchema,
    /** Why the change is proposed. */
    rationale: z.string(),
    /** Approval list frozen at proposal time; never recomputed from live topology. */
    voters: z.array(z.string()),
    /** Recorded votes keyed by voter id. */
    votes: z.array(voteRecordSchema),
    /** Terminal or pending state. */
    status: z.enum(PROPOSAL_STATUSES),
    /** Deadline in epoch ms; a proposal reaching it expires without approval. */
    deadlineAt: z.number().int().nonnegative(),
    /** Creation timestamp (epoch ms). */
    createdAt: z.number().int().nonnegative(),
    /** Terminal timestamp (epoch ms). */
    settledAt: z.number().int().nonnegative().nullable(),
    /** Goal version committed by this proposal, when it committed. */
    committedVersion: z.number().int().positive().nullable(),
    /** Why the proposal stopped being pending. */
    note: z.string().nullable(),
  })
  .strict()

/** {@link proposalRecordSchema} value type. */
export type ProposalRecord = z.infer<typeof proposalRecordSchema>

/** Effective bounds of one network. Every bound is a positive integer count or a duration. */
export const networkLimitsSchema = z
  .object({
    /** Resident working nodes (`provisioning` and `draining` included). */
    maxResidentNodes: z.number().int().positive(),
    /** Cumulative nodes ever created in this network. */
    maxTotalNodes: z.number().int().positive(),
    /** Cumulative formal tasks. */
    maxTasks: z.number().int().positive(),
    /** Cumulative proposals. */
    maxProposals: z.number().int().positive(),
    /** Pending outbound mail per node. */
    maxPendingMailPerNode: z.number().int().positive(),
    /** Cumulative retained mail records. */
    maxRetainedMail: z.number().int().positive(),
    /** Maximum UTF-8 bytes of one mail body, envelope included. */
    maxMessageBytes: z.number().int().positive(),
    /** Maximum UTF-8 bytes of the goal document body. */
    maxDocumentBytes: z.number().int().positive(),
    /** Default lease granted to a new node, in milliseconds. */
    defaultLeaseMs: z.number().int().positive(),
    /** Maximum single lease extension, in milliseconds. */
    maxLeaseExtensionMs: z.number().int().positive(),
    /** Wall-clock deadline for the whole network, in milliseconds. */
    networkDeadlineMs: z.number().int().positive(),
    /** Wall-clock deadline for a proposal, in milliseconds. */
    proposalDeadlineMs: z.number().int().positive(),
    /**
     * Admitted model-step budget for ATN-owned nodes. Counts steps admitted by
     * this runtime; it does not cover provider retries, auxiliary model calls,
     * or host-owned agents outside this network.
     */
    stepBudget: z.number().int().positive(),
  })
  .strict()

/** {@link networkLimitsSchema} value type. */
export type NetworkLimits = z.infer<typeof networkLimitsSchema>

/** One complete ATN network: the atomic persistence unit. */
export const networkRecordSchema = z
  .object({
    /** Stable network id. */
    id: z.string(),
    /** Host-owned entry session that started this network. */
    entrySessionId: z.string(),
    /** Host-owned entry node id. */
    entryNodeId: z.string(),
    /** Network status. */
    status: z.enum(NETWORK_STATUSES),
    /** Effective bounds. */
    limits: networkLimitsSchema,
    /** Committed goal revisions, oldest first. */
    goalHistory: z.array(goalRevisionSchema).min(1),
    /** Consumed admitted model steps. */
    stepsUsed: z.number().int().nonnegative(),
    /** Nodes by id. */
    nodes: z.record(z.string(), nodeRecordSchema),
    /** Tasks by id. */
    tasks: z.record(z.string(), taskRecordSchema),
    /** Mail by id. */
    mails: z.record(z.string(), mailRecordSchema),
    /** Proposals by id. */
    proposals: z.record(z.string(), proposalRecordSchema),
    /** Next value of the per-network record counter. */
    sequence: z.number().int().nonnegative(),
    /** Creation timestamp (epoch ms). */
    createdAt: z.number().int().nonnegative(),
    /** Hard network deadline (epoch ms). */
    deadlineAt: z.number().int().nonnegative(),
    /** Human-readable terminal reason, when the network is not open. */
    note: z.string().nullable(),
  })
  .strict()

/** {@link networkRecordSchema} value type. */
export type NetworkRecord = z.infer<typeof networkRecordSchema>

/** Domain name and version used by the durable store. The medium restricts names to `[a-z][a-z0-9_]*`. */
export const ATN_DOMAIN_NAME = 'atn_networks'
/** Current on-medium network record version. */
export const ATN_DOMAIN_VERSION = 1
