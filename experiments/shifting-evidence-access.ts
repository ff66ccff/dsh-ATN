/** Experiment-only information channels: discovery carries metadata, proofs use metered transport. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AtnRuntime, PeerSummary, PeersResult } from '../src/runtime.ts'
import type { KnowledgeMetadata } from '../src/knowledge.ts'
import { defineCustodyPolicy } from '../src/information-boundary.ts'
import { knowledgeFingerprintSchema } from '../src/schema.ts'
import type { ShiftingEvidenceScenario } from './shifting-evidence-task.ts'
import { installTopologyBindingAccess } from './topology-binding-access.ts'

const publicationSchema = knowledgeFingerprintSchema.omit({ updatedAt: true })
const fields = ['documents', 'topics', 'contributions'] as const
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')

function canonical(input: KnowledgeMetadata): KnowledgeMetadata {
  const parsed = publicationSchema.parse(input)
  return Object.fromEntries(fields.map(field => [field, [...new Set(parsed[field])].sort()])) as KnowledgeMetadata
}

/**
 * Install before agents run. Keep production authorization and result semantics;
 * constrain only this scenario's unmetered discovery/control surfaces. Metadata
 * must be a side-effect-free host projection with no proof or pointer values.
 */
export function installShiftingEvidenceAccess(
  atn: AtnRuntime,
  networkId: string,
  metadata: (sessionId: string) => KnowledgeMetadata,
  scenario?: ShiftingEvidenceScenario,
  fixedPeers?: Readonly<Record<string, readonly string[]>>,
) {
  const binding = scenario?.task.topologyBinding ? installTopologyBindingAccess(atn, networkId, scenario, fixedPeers) : null
  if (!binding) atn.installOutboundPolicy(networkId, defineCustodyPolicy({
    custody: (id, record) => canonical(metadata(record.nodes[id].sessionId)).documents,
    extractClaims: () => [], // Revision 2 historically allows fact relays.
    describeArtifact: (id, record) => ({ topics: Object.values(record.nodes)
      .map(node => canonical(metadata(node.sessionId))).filter(row => row.documents.includes(id)).flatMap(row => row.topics) }),
  }))
  const original = {
    peers: atn.peers.bind(atn),
    tasks: atn.tasks.bind(atn), status: atn.status.bind(atn), rewire: atn.rewire.bind(atn),
  }
  const cursors = new Map<string, string>()
  const context = async (agent: Agent) => {
    const caller = await atn.callerContext(agent)
    if (caller.record.id !== networkId) throw new Error('Shifting-evidence access requires membership in the experiment network')
    return caller
  }

  atn.peers = async (agent, query) => {
    const { record, node } = await context(agent)
    const sanitize = (peer: PeerSummary): PeerSummary => {
      const allowed = canonical(metadata(record.nodes[peer.id].sessionId))
      const knowledge = peer.knowledgeFingerprint
      return { ...peer, taskSummaries: [], recentResults: [],
        requesterFeedback: binding ? { ...peer.requesterFeedback, observations: peer.requesterFeedback.observations.map(row =>
          ({ ...row, comparisonKey: row.comparisonKey === 'versioned-fact:v1' ? row.comparisonKey : null })) } : peer.requesterFeedback,
        knowledgeFingerprint: { ...knowledge,
        // Current ownership comes from the host, never an old agent publication.
        documents: knowledge.documents.filter(value => allowed.documents.includes(value)).sort(),
        topics: knowledge.topics.filter(value => allowed.topics.includes(value)).sort(),
        contributions: knowledge.contributions.filter(value => allowed.contributions.includes(value)).sort(),
      } }
    }
    const base = await original.peers(agent)
    const result: PeersResult = { ...base, nodes: base.nodes.map(sanitize) }
    const needle = normalize(query ?? '')
    if (needle.length === 0) return result
    // Obtain summaries through the existing authenticated, bounded discovery
    // API. Do not call its text search: that also indexes private task results.
    const count = Object.values(record.nodes).filter(candidate => candidate.id !== node.id &&
      !base.neighbours.includes(candidate.id) && candidate.lifecycle === 'active' && candidate.creationState === 'published').length
    const discovered = new Map<string, PeerSummary>()
    for (let page = 0; page < Math.ceil(count / 3); page++) {
      const batch = await original.peers(agent, '*')
      for (const candidate of batch.candidateNodes ?? []) discovered.set(candidate.id, sanitize(candidate))
    }
    const terms = [...new Set(needle.split(' '))]
    const score = (peer: PeerSummary) => {
      if (needle === '*') return 1
      const index = fields.flatMap(field => peer.knowledgeFingerprint[field]).map(normalize)
      return 2 * terms.filter(term => index.some(text => text.includes(term))).length +
        (index.some(text => text.includes(needle)) ? terms.length * 2 : 0) +
        terms.filter(term => normalize(peer.id).includes(term)).length
    }
    const ranked = [...discovered.values()].map(peer => ({ peer, score: score(peer) })).filter(row => row.score > 0)
      .sort((a, b) => b.score - a.score ||
        (b.peer.requesterFeedback.acceptanceRate ?? 0.5) - (a.peer.requesterFeedback.acceptanceRate ?? 0.5) ||
        (b.peer.knowledgeFingerprint.requesterAcceptanceRate ?? 0.5) - (a.peer.knowledgeFingerprint.requesterAcceptanceRate ?? 0.5) ||
        b.peer.knowledgeFingerprint.requesterAccepted - a.peer.knowledgeFingerprint.requesterAccepted ||
        a.peer.openTasks - b.peer.openTasks || record.nodes[a.peer.id].createdAt - record.nodes[b.peer.id].createdAt ||
        a.peer.id.localeCompare(b.peer.id)).map(row => row.peer)
    let selected = ranked.slice(0, 3)
    if (needle === '*' && ranked.length > 0) {
      const previous = cursors.get(node.id)
      const start = previous === undefined ? 0 : (ranked.findIndex(peer => peer.id === previous) + 1) % ranked.length
      selected = Array.from({ length: Math.min(3, ranked.length) }, (_, offset) => ranked[(start + offset) % ranked.length])
      cursors.set(node.id, selected.at(-1)!.id)
    }
    return { ...result, candidates: selected.map(peer => peer.id), candidateNodes: selected }
  }

  atn.tasks = async (agent, taskIds) => {
    const { node } = await context(agent)
    const tasks = await original.tasks(agent, taskIds)
    if (tasks.some(task => task.holderId !== node.id && task.requesterId !== node.id)) {
      throw new Error('Task contents are visible only to the holder and requester in this experiment')
    }
    return tasks
  }
  atn.status = async (agent, input = {}) => {
    await context(agent)
    if (input.claimTaskId !== undefined) throw new Error('Orphan claiming is disabled in the shifting-evidence experiment')
    const result = await original.status(agent, input)
    return { ...result, orphanTasks: [], orphanTasksRemaining: 0,
      rewireHint: 'To connect a discovered holder, call atn_status({rewire:{peers:[candidateId,retainedPeerId]}}). peers is the full desired outgoing list within budget.maxCollaborationPeers. Review and rewire are separate atomic calls; disabled experiment arms reject the corresponding write.' }
  }
  atn.claim = async agent => {
    await context(agent)
    throw new Error('Orphan claiming is disabled in the shifting-evidence experiment')
  }
  atn.finish = async agent => {
    await context(agent)
    throw new Error('Node retirement is disabled until the shifting-evidence experiment ends')
  }
  atn.rewire = async (agent, input) => {
    const { record, node } = await context(agent)
    if ([...(input.baselineTaskIds ?? []), ...(input.candidateTaskIds ?? [])]
      .some(id => record.tasks[id]?.requesterId !== node.id)) {
      throw new Error('Rewire evidence must come from tasks requested by the calling node')
    }
    return original.rewire(agent, input)
  }
  return binding
}
