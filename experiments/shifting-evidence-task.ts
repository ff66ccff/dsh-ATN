/** Host-scoped versioned pointer chains: unknown placement, changing routes, no sum. */
import { isDeepStrictEqual } from 'node:util'
import type { PublishKnowledgeInput } from '../src/knowledge.ts'

export interface EvidenceFact { id: string; phase: 1 | 2; version: number; key: string; next: string | null; proof: string; terminal: string | null }
export interface ChainAnswer { phase: 1 | 2; chain: Array<{ key: string; proof: string; document: string }>; terminal: string }
export const BINDING_SETUP_TASK = 'Read your local snapshots once per phase and answer only direct JSON {phase,key} fact requests with your own exact copy, even if obsolete. After the initial mine read, settle THIS setup task once with body and summary exactly {"ready":true}, evidence=[], to its actual requester. This fixed receipt contains no facts. Do not relay facts, search other owners, retire or submit checkpoints. With no fact request, end the turn and wait for mail or the phase update. Board publications contain discoveryHints metadata only.'
export interface ShiftingEvidenceTask {
  id: 'shifting-evidence'; revision: 2 | 3; topologyBinding?: boolean; seed: number; agents: number; chainLength: number; rootKey: string
  phases: Array<{ phase: 1 | 2; facts: EvidenceFact[]; holders: Record<string, number>; staleFacts: EvidenceFact[]; staleHolders: Record<string, number> }>
}

/** Local contract checks only. Opaque proof correctness remains a separate host observation. */
export function validateRequestedEvidence(value: unknown, request: { phase: 1 | 2; key: string }): { status: 'accepted' | 'rejected'; reasons: string[] } {
  const reasons: string[] = []
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { status: 'rejected', reasons: ['missing-evidence-object'] }
  const fact = value as Record<string, unknown>
  for (const field of ['id', 'phase', 'version', 'key', 'next', 'proof', 'terminal']) {
    if (!Object.hasOwn(fact, field)) reasons.push(`missing-field:${field}`)
  }
  if (fact.phase !== request.phase) reasons.push('phase-mismatch')
  if (fact.version !== request.phase) reasons.push('version-mismatch')
  if (fact.key !== request.key) reasons.push('key-mismatch')
  for (const field of ['id', 'key', 'proof']) if (typeof fact[field] !== 'string' || (fact[field] as string).trim().length === 0) reasons.push(`invalid-field:${field}`)
  if (fact.next !== null && (typeof fact.next !== 'string' || fact.next.length === 0)) reasons.push('invalid-field:next')
  if (fact.next === null ? typeof fact.terminal !== 'string' || fact.terminal.length === 0 : fact.terminal !== null) reasons.push('invalid-field:terminal')
  return { status: reasons.length === 0 ? 'accepted' : 'rejected', reasons }
}

function random(seed: number) { let state = seed >>> 0; return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32) }
function shuffled<T>(rows: T[], next: () => number): T[] {
  const result = [...rows]
  for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [result[i], result[j]] = [result[j], result[i]] }
  return result
}

export function createShiftingEvidenceTask(agents = 8, seed = 17, chainLength = 4, topologyBinding = false): ShiftingEvidenceTask {
  if (!Number.isSafeInteger(agents) || agents < 8 || agents > 16) throw new Error('Shifting evidence requires 8–16 nodes')
  if (!Number.isSafeInteger(seed) || seed < 1) throw new Error('Seed must be a positive integer')
  if (!Number.isSafeInteger(chainLength) || chainLength < 2 || chainLength > 4) throw new Error('Chain length must be 2, 3 or 4')
  const next = random(seed)
  const keys = Array.from({ length: agents * 2 }, (_, index) => `key-${String(index).padStart(2, '0')}`)
  const rootKey = keys[0]
  const tail = shuffled(keys.slice(1), next)
  const paths = [[rootKey, ...tail.slice(0, chainLength - 1)], [rootKey, ...tail.slice(3, 3 + chainLength - 1)]]
  // Keep stale providers separate from current chain owners in both phases.
  // These are evidence placements, never capability, permission or model roles.
  const owners = shuffled(Array.from({ length: agents - 3 }, (_, index) => index + 2), next)
  const phases = ([1, 2] as const).map(phase => {
    const path = paths[phase - 1]
    const staleSlot = phase === 1 ? 1 : agents - 1
    const holders: Record<string, number> = {}
    const facts = keys.map((key, index): EvidenceFact => {
      const hop = path.indexOf(key)
      const owner = hop < 0 ? (index + phase) % agents : owners[(hop + (phase - 1) * 3) % owners.length]
      holders[key] = owner === staleSlot ? (owner + 1) % agents : owner
      return { id: `phase-${phase}:${key}`, phase, version: phase, key,
        next: hop >= 0 && hop < path.length - 1 ? path[hop + 1] : null,
        proof: `witness-${Math.floor(next() * 2 ** 30).toString(36)}`,
        terminal: hop === path.length - 1 ? `release-${phase}-${Math.floor(next() * 2 ** 30).toString(36)}` : hop < 0 ? 'distractor' : null }
    })
    const staleFacts: EvidenceFact[] = facts.filter(fact => path.includes(fact.key)).map(fact => ({ ...fact,
      id: `copy-for-phase-${phase}:version-${phase - 1}:${fact.key}`, phase: 1 as const, version: phase - 1,
      proof: `older-${fact.proof}`, terminal: fact.next === null ? `older-${fact.terminal}` : null }))
    return { phase, facts, holders, staleFacts, staleHolders: Object.fromEntries(staleFacts.map(fact => [fact.key, staleSlot])) }
  })
  // Phase 2 copies truthfully retain phase 1 content, including its old route.
  phases[1].staleFacts = phases[1].staleFacts.map(copy => ({ ...phases[0].facts.find(fact => fact.key === copy.key)!, id: copy.id }))
  return { id: 'shifting-evidence', revision: topologyBinding ? 3 : 2, ...(topologyBinding ? { topologyBinding: true } : {}), seed, agents, chainLength, rootKey, phases }
}

/** Oracle stays in the host; model tools never expose this function or the full fixture. */
export function expectedChain(task: ShiftingEvidenceTask, phase: 1 | 2): ChainAnswer {
  const facts = task.phases[phase - 1].facts
  const chain: ChainAnswer['chain'] = []
  let key: string | null = task.rootKey
  let terminal = ''
  while (key !== null) {
    const fact: EvidenceFact | undefined = facts.find(row => row.key === key)
    if (!fact || chain.some(row => row.key === key)) throw new Error('Invalid host chain fixture')
    chain.push({ key: fact.key, proof: fact.proof, document: fact.id })
    terminal = fact.terminal ?? ''
    key = fact.next
  }
  return { phase, chain, terminal }
}

export function evaluateChain(task: ShiftingEvidenceTask, phase: 1 | 2, text: string | undefined) {
  let parsed: unknown
  try { parsed = text && text.length <= 16_384 ? JSON.parse(text) : undefined } catch { parsed = undefined }
  return { phase, passed: isDeepStrictEqual(parsed, expectedChain(task, phase)), submitted: text !== undefined }
}

/** Submission discipline and proof correctness are independent observations. */
export function evaluateCheckpoints(task: ShiftingEvidenceTask, submissions: ReadonlyMap<1 | 2, string>) {
  const evaluation = ([1, 2] as const).map(phase => evaluateChain(task, phase, submissions.get(phase)))
  const phase1Submitted = evaluation[0].submitted, phase1Correct = evaluation[0].passed
  const phase2Submitted = evaluation[1].submitted, phase2Correct = evaluation[1].passed
  return { evaluation, phase1Submitted, phase1Correct, phase2Submitted, phase2Correct,
    passed: phase1Correct && phase2Correct,
    submissionDisciplineFailure: !phase1Submitted,
    // Missing checkpoints are not evidence that a submitted proof was wrong.
    solvingFailure: evaluation.some(row => row.submitted && !row.passed),
    failureClass: !phase1Submitted ? 'submission-discipline' : evaluation.some(row => row.submitted && !row.passed)
      ? 'incorrect-proof' : !phase2Submitted ? 'phase-2-not-submitted' : null }
}

export class ShiftingEvidenceScenario {
  readonly task: ShiftingEvidenceTask
  private slots = new Map<string, number>()
  private reads: Array<{ slot: number; phase: number; id: string }> = []
  private deniedReads = 0
  phase: 1 | 2 = 1
  readonly submissions = new Map<1 | 2, string>()
  transitionReason: string | null = null
  constructor(task: ShiftingEvidenceTask) { this.task = structuredClone(task) }
  register(sessionId: string): number {
    if (this.slots.has(sessionId)) return this.slots.get(sessionId)!
    if (this.slots.size >= this.task.agents) throw new Error('Evidence slots exhausted')
    const slot = this.slots.size; this.slots.set(sessionId, slot); return slot
  }
  sessionAt(slot: number): string { const row = [...this.slots].find(([, value]) => value === slot); if (!row) throw new Error('Unknown slot'); return row[0] }
  private localFacts(slot: number): EvidenceFact[] {
    const phase = this.task.phases[this.phase - 1]
    return [...phase.facts.filter(fact => phase.holders[fact.key] === slot),
      ...phase.staleFacts.filter(fact => phase.staleHolders[fact.key] === slot)]
  }
  knowledgeHints(sessionId: string): PublishKnowledgeInput {
    const slot = this.slots.get(sessionId)
    if (slot === undefined) throw new Error('Evidence access denied')
    const owned = this.localFacts(slot)
    return { documents: owned.map(fact => fact.id).sort(), topics: [...new Set([`phase-${this.phase}`, ...owned.map(fact => fact.key)])].sort(), contributions: [] }
  }
  /** Pure ownership predicate; received mail never adds facts to local possession. */
  ownsEvidence(sessionId: string, value: unknown): boolean {
    const slot = this.slots.get(sessionId)
    return slot !== undefined && this.localFacts(slot).some(fact => isDeepStrictEqual(fact, value))
  }
  read(sessionId: string, id = 'mine'): { phase: 1 | 2; documents: EvidenceFact[]; discoveryHints: PublishKnowledgeInput } {
    const slot = this.slots.get(sessionId)
    if (slot === undefined) { this.deniedReads++; throw new Error('Evidence access denied') }
    const owned = this.localFacts(slot)
    const selected = id === 'mine' ? owned : owned.filter(fact => fact.id === id || fact.key === id)
    if (id !== 'mine' && selected.length === 0) { this.deniedReads++; throw new Error('Evidence access denied or stale phase') }
    for (const fact of selected) this.reads.push({ slot, phase: this.phase, id: fact.id })
    return { phase: this.phase, documents: structuredClone(selected), discoveryHints: this.knowledgeHints(sessionId) }
  }
  submit(phase: 1 | 2, text: string): void {
    if (phase !== this.phase || this.submissions.has(phase)) throw new Error('One checkpoint per current phase')
    if (Buffer.byteLength(text, 'utf8') > 16_384) throw new Error('Checkpoint too large')
    this.submissions.set(phase, text)
  }
  advance(reason: string): void { if (this.phase !== 1) throw new Error('Already in phase 2'); this.phase = 2; this.transitionReason = reason }
  snapshot() {
    const phase1 = expectedChain(this.task, 1), phase2 = expectedChain(this.task, 2)
    const rootMoved = this.task.phases[0].holders[this.task.rootKey] !== this.task.phases[1].holders[this.task.rootKey]
    return { phase: this.phase, registeredNodes: this.slots.size, deniedReads: this.deniedReads,
      distinctDocumentReads: new Set(this.reads.map(row => `${row.slot}:${row.id}`)).size,
      transitionReason: this.transitionReason, automaticAdvanceOccurred: this.transitionReason !== null && this.transitionReason !== 'phase-1-checkpoint',
      checks: { boundedNodes: this.slots.size === this.task.agents, rootHolderChanged: rootMoved,
        routeChanged: !isDeepStrictEqual(phase1.chain.map(row => row.key), phase2.chain.map(row => row.key)), phaseChanged: this.phase === 2 },
      evidenceVariance: { currentVersionByPhase: [1, 2], staleSlotsByPhase: this.task.phases.map(row => [...new Set(Object.values(row.staleHolders))]),
        staleRootHolderChanged: this.task.phases[0].staleHolders[this.task.rootKey] !== this.task.phases[1].staleHolders[this.task.rootKey],
        staleCopiesByPhase: this.task.phases.map(row => row.staleFacts.length), capabilityChanges: false },
      causalClaim: false }
  }
}

export function shiftingPrompt(task: ShiftingEvidenceTask, options: { perNodeSteps?: number; autoAdvance?: boolean } = {}): string {
  if (task.topologyBinding) return [
    `Find both versions of a dependency chain in a pre-provisioned ${task.agents}-node network. Start at ${task.rootKey}. The entry alone assembles the chain and submits checkpoints. The initial graph is a bidirectional ring; maximum outgoing degree is TWO. All nodes have identical models, tools and permissions.`,
    'TOPOLOGY BINDING (host enforced): only the node holding an exact local snapshot may answer it. No forwarding, relaying, gathering another holder\'s facts or evidence in notes, requests or board bodies. A relayed result fails with evidence-not-owned and does not settle the task. Connect directly to each holder before requesting evidence. Fixed mode may be structurally unable to finish; report that limitation and end the turn rather than inventing evidence or trying relays.',
    'Each node reads read_evidence(id="mine") ONCE per phase. This returns its local documents (possibly obsolete) and discoveryHints; the host advertises that exact metadata automatically. If board enabled, optionally publish once: atn_board(action="publish",key="phase-1:YOUR-NODE-ID",expectedRevision=0,body=JSON.stringify(discoveryHints),documents=discoveryHints.documents,topics=discoveryHints.topics). The board carries METADATA ONLY. Phase 2 uses phase-2 keys. Publishing facts or arbitrary text fails. Board and discovery never reveal proofs, next pointers or terminals.',
    'Helpers: after the first mine read, settle your initial provisioning task ONCE with atn_send(to=ACTUAL-SETUP-REQUESTER,kind="result",taskId=SETUP-TASK-ID,body="{\"ready\":true}",summary="{\"ready\":true}",evidence=[]). This is a fixed metadata receipt, not evidence. Never include facts in a setup receipt. Stay available after it. For actual fact tasks answer your own exact local copy, even if obsolete. The request body is encoded JSON with ONLY {"phase":1,"key":"key-00"}. Use atn_send(to=REQUESTER,kind="result",taskId=ACTUAL-FACT-TASK,body=JSON.stringify(FACT),summary=JSON.stringify(FACT),evidence=[FACT.id]). Do not append prose, additional evidence or optional messageId/dependsOn/retryOf. Received mail does not confer ownership. With no local copy, never relay or fabricate.',
    'Entry workflow: inspect atn_status(query="key-00") for advertised holders, neighbours, ratings and budget. Request the root from BOTH matching holders, including the older-copy holder, and rate both. For a holder outside your outgoing peers call atn_status(rewire={peers:["HOLDER-ID","RETAINED-PEER-ID"]}); this is the full desired peer list within budget.maxCollaborationPeers. Request its exact fact with JSON {phase,key}. Follow the current fact\'s next key and repeat direct lookup until next=null. Cache facts already obtained. Rotate edges as needed; never ask a helper to retrieve a fragment from other owners. Current document ids start phase-1: or phase-2:; older copies start copy-for-phase-.',
    'Use ONE outstanding fact request at a time. Root cross-check is sequential: request the older copy, WAIT for its actual result and review it, then connect to the current holder, request and WAIT for its result, cache and review it. Never send both root requests before receiving the first response. Cache every received current fact immediately. Continue the next pointer only after the current root and old-copy check are recorded. After rating a response, inspect atn_status(taskIds=[the actual lookup task ids]) once if needed to refresh any already returned evidence before deciding to wait. End a turn only for a genuinely outstanding response; do not wait on a task whose result is already present. Do not poll or restart an already completed lookup.',
    'As requester, check phase/version, requested key and all required fields id,phase,version,key,next,proof,terminal. Reject a phase/version mismatch, missing field, wrong key, empty id/proof or invalid next/terminal using atn_status(review={taskId,status="rejected",summary,evidence,comparisonKey:"versioned-fact:v1"}); accept matching current replies with status="accepted". Review and rewire are separate atomic calls. These local judgments are not host correctness or human authorization. When review disabled, validate locally without writing ratings.',
    'With no actual task, end the current turn and wait for incoming mail or the host phase update. Do not poll while idle. Entry can read the actual returned fact in result mail and review its task directly. Helpers never search the full chain, submit unsolicited evidence, rewrite unchanged metadata or submit checkpoints.',
    'Only entry calls submit_checkpoint(phase,answer), answer being encoded JSON {"phase":1,"chain":[{"key":"...","proof":"...","document":"..."}],"terminal":"..."}. Submit phase 1 IMMEDIATELY after its ordered chain and two-holder root check. Receipt gives NO correctness feedback and advances to phase 2. Refresh local documents, rebuild from key-00 with current phase=2/version=2, then submit phase 2. Do not retire or close the network; the host measures and cleans up.',
    `Each node has ${options.perNodeSteps ?? 48} steps for BOTH phases, roughly ${Math.floor((options.perNodeSteps ?? 48) / 2)} per phase. Automatic advance is disabled; only the phase-1 checkpoint starts phase 2. Steps are not token, HTTP or cost limits. Preserve at least 20% step headroom. Stop once phase 2 is submitted.`,
  ].join('\n\n')
  return [
    `Find a versioned dependency chain in a pre-provisioned ${task.agents}-node ATN network. The public starting key is ${task.rootKey}. The initial graph is a bidirectional ring with maximum outgoing degree TWO.`,
    'read_evidence(id="mine") returns only your own local evidence snapshot, which may include older copies. Each fact names phase, version, key, next pointer, opaque proof, document id, and terminal (only when next=null). The current contract is phase=1/version=1 initially and phase=2/version=2 after the update. The other holders and route are unknown. When the board is enabled, publish compact local facts ONCE per phase with atn_board(action="publish",key="phase-1:YOUR-NODE",expectedRevision=0,body="FACT JSON",documents=discoveryHints.documents,topics=discoveryHints.topics). Use a unique phase/node key; do not duplicate unchanged publications. No node has global document access.',
    'Discovery is METADATA ONLY in this experiment. Put discoveryHints.documents and discoveryHints.topics returned by read_evidence in your board publication, with exact evidence in its metered body. Documents/topics accept only your current local identifiers. Discovery hides board body and task/result prose; task records are readable only by holder/requester. Transmit actual facts by mail or the metered board. Orphan claiming and early retirement are disabled.',
    'Default workflow: the entry assembles the ordered chain by following next pointers from the public root until next=null, cross-checks the root, and submits checkpoints with exact proofs/document ids and final terminal. Helpers read and publish their local snapshot once per phase, then respond to or relay actual tasks. Retrieve an explicitly assigned bounded chain fragment when requested; do not independently search the full chain, broadcast unsolicited results, rewrite unchanged board facts, or poll while idle. With no assigned work, end the current turn and wait for actual mail or the host phase update; keep the node available. All nodes retain the same model, tools and permissions. Do not guess proofs; current facts override old copies.',
    'For a requested key, return your own exact local copy even if its phase/version is obsolete, with atn_send(kind=result) on the actual task; do not fetch or invent a replacement unless the task explicitly asks you to relay to a named holder. As requester check these observable rejection criteria: phase/version mismatch; missing required fields (id,phase,version,key,next,proof,terminal); wrong requested key; empty id/proof; invalid next or terminal. Reject unusable replies with atn_status(review={taskId,status="rejected",summary,evidence,comparisonKey}); accept matching current replies with status="accepted". You can check only these local fields, not hidden opaque proof correctness. Keep comparisonKey="versioned-fact:v1" for this lookup contract. Local opinions are not host verification.',
    'Before each checkpoint, the entry cross-checks the public root by requesting exact copies from two matching advertised holders through actual task/result mail and rates each locally when review is enabled. If a holder is outside the fixed ring, relay the request/result along the ring: preserve the original target holder, requested phase/version, key and visited nodes, adding only your own id to visited. Return the received evidence unchanged through the original task; preserve its actual phase/version/key even if obsolete. Do not replace evidence with a guessed current copy.',
    'Rewiring workflow: first read atn_status(query="key-00") to inspect neighbours, matching candidates, ratings and budget. After an unusable reply, connect to another matching holder with atn_status(rewire={peers:["CANDIDATE-ID","RETAINED-PEER-ID"]}); peers is the full desired outgoing peer list and must respect budget.maxCollaborationPeers. Then send the same fact request and review its result. review and rewire require separate calls: each atn_status call performs at most one atomic write. Fixed mode uses ring relays; feedback-disabled mode omits ratings. Rewiring is discovery/exploration and does not by itself prove improved quality.',
    'Only the entry uses submit_checkpoint(phase,answer), with answer encoded JSON: {"phase":1,"chain":[{"key":"...","proof":"...","document":"..."}],"terminal":"..."}. Submission records an attempt and gives NO correctness feedback. Phase 1 checkpoint triggers phase 2: the useful route and document holders change. The entry submits a second proof with phase=2; helpers continue their assigned local publication/task work.',
    `Submit phase 1 IMMEDIATELY once its complete chain and root cross-check are available; do not delay the checkpoint for other protocol work. Each node has ${options.perNodeSteps ?? 16} steps for both phases; plan roughly ${Math.floor((options.perNodeSteps ?? 16) / 2)} per phase. ${options.autoAdvance ? 'Automatic advance is enabled: half of any node/global call budget or phase-1 quiescence may advance without a checkpoint.' : 'Automatic advance is disabled: only the phase-1 checkpoint starts phase 2.'} Refresh local facts and board publications after the host update. Stop once phase 2 is submitted.`,
    'Keep the network and your node available for both phases. Do not retire after phase 1. This experiment uses submit_checkpoint, not atn_finish(scope=network), for artifacts; the host cleans up after measurement and reports unresolved protocol obligations separately.',
    'The shared board, when enabled, is a universal bounded communication medium; its reads/writes are measured. Include phase in every board key and topic. Prefer concise indexed facts or requests. Avoid broadcasting full local documents. Rewiring has no automatic correctness guarantee.',
  ].join('\n\n')
}
