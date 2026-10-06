/** Bounded local graph feedback, acknowledged only by the normal session log. */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { NetworkRecord } from './schema.ts'
import { collaborationPeers, collaborationPeerLimit, MAX_COLLABORATION_PEERS } from './topology.ts'
import { materialFingerprint, summarizeLocalFeedback } from './local-feedback.ts'
import { summarizeRequesterFeedback } from './requester-feedback.ts'
import { summarizeVerifiedFeedback } from './verified-feedback.ts'
import { createHash } from 'node:crypto'

const SNAPSHOT_SECTION = 'atn/topology-snapshot'
export const MIN_FEEDBACK_STEP_INTERVAL = 3
/** Model-visible local feedback is bounded independently of task text length. */
export const MAX_TOPOLOGY_FEEDBACK_BYTES = 4096

function truncateUtf8(text: string, bytes: number): string {
  let result = ''
  let used = 0
  for (const point of text) {
    const size = Buffer.byteLength(point)
    if (used + size > bytes) break
    result += point
    used += size
  }
  return result
}

interface TopologySnapshot {
  networkId: string
  nodeId: string
  peers: string[]
  telemetryFingerprint?: string
  /** Cursor advances only when this snapshot enters the durable session log. */
  admittedStep?: number
}

/** Read the last admitted snapshot, including messages hidden by compaction. */
function previousSnapshot(
  events: readonly { type: string; data?: unknown }[],
  networkId: string,
  nodeId: string,
): TopologySnapshot | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.type !== 'user/message') continue
    const message = event.data as UserMessage | undefined
    if (message?.source?.kind !== 'atn' || message.source.form !== 'snapshot') continue
    for (const section of message.source.sections) {
      if (section.name !== SNAPSHOT_SECTION) continue
      try {
        const snapshot: TopologySnapshot = JSON.parse(section.text)
        if (snapshot?.networkId === networkId && snapshot.nodeId === nodeId &&
          Array.isArray(snapshot.peers) && snapshot.peers.length <= MAX_COLLABORATION_PEERS &&
          snapshot.peers.every(id => typeof id === 'string')) return snapshot
      } catch {
        // Older or malformed metadata cannot acknowledge this node's view.
      }
    }
  }
  return undefined
}

/**
 * Coalesce graph changes since the last normal input. The bounded snapshot is
 * stored with the message itself, so a rejected/cancelled input cannot consume
 * feedback, and recovery needs no separate acknowledgement or event queue.
 */
export function topologyFeedbackMessage(
  record: NetworkRecord,
  nodeId: string,
  events: readonly { type: string; data?: unknown }[],
  now: number = Date.now(),
): UserMessage | undefined {
  const peers = collaborationPeers(record.nodes, nodeId, collaborationPeerLimit(record)).toSorted()
  const previous = previousSnapshot(events, record.id, nodeId)
  const telemetry = peers.map(peerId => summarizeLocalFeedback(record, peerId, { observerId: nodeId, now }))
  const quality = peers.map(peerId => ({ peerId,
    requester: summarizeRequesterFeedback(record, peerId, { observerId: nodeId }),
    host: summarizeVerifiedFeedback(record, peerId, { observerId: nodeId }),
  }))
  // Feedback arriving after settlement is a material change even without new mail.
  const telemetryFingerprint = createHash('sha256').update(JSON.stringify({
    runtime: materialFingerprint(telemetry),
    quality: quality.map(({ peerId, requester, host }) => ({ peerId,
      requester: requester.observations, host: host.observations,
    })),
  })).digest('hex')
  if (previous !== undefined && previous.peers.length === peers.length && previous.peers.every(id => peers.includes(id)) &&
    previous.telemetryFingerprint === telemetryFingerprint) {
    return undefined
  }
  const admittedStep = record.nodes[nodeId]?.stepsUsed ?? 0
  if (previous?.admittedStep !== undefined && Number.isSafeInteger(previous.admittedStep) && previous.admittedStep >= 0 &&
    admittedStep - previous.admittedStep < MIN_FEEDBACK_STEP_INTERVAL) return undefined
  const lines = [`[ATN local changes] network=${record.id} node=${nodeId}`]
  const details: string[] = []
  if (previous === undefined) {
    lines.push(`Initial neighbours: ${peers.join(', ') || '(none)'}`)
  } else {
    const removed = previous.peers.filter(id => !peers.includes(id))
    const added = peers.filter(id => !previous.peers.includes(id))
    if (removed.length > 0) {
      lines.push(`Removed: ${removed.map(id => {
        const peer = record.nodes[id]
        if (peer?.lifecycle !== 'active' && peer?.note) details.push(`${id} exit reason: ${peer.note.replace(/\s+/g, ' ')}`)
        return `${id} (${peer?.lifecycle ?? 'unavailable'})`
      }).join('; ')}`)
    }
    if (added.length > 0) lines.push(`Added: ${added.join(', ')}`)
    lines.push(`Current neighbours: ${peers.join(', ') || '(none)'}`)
  }
  if (telemetry.length > 0) {
    lines.push('Runtime telemetry: completed means submitted, not checked correctness; holder steps may overlap across tasks.')
    for (const row of telemetry) {
      const mean = (value: number | null): string => value === null ? 'unknown' : String(Math.round(value * 10) / 10)
      const recent = row.observations.slice(0, 2).map(task =>
        `${task.taskId}:${task.status},elapsed=${mean(task.elapsedMs)}ms,holderSteps=${mean(task.holderSteps)}`).join('; ')
      lines.push(`${row.peerId}: assigned=${row.assigned}, open=${row.open}, completed=${row.completed}, failed=${row.failed}, unreachable=${row.unreachable}; ` +
        `retries=${row.retries}, recoveries=${row.recoveries}, downstreamFailures=${row.downstreamFailures}; ` +
        `recentMeanLatency=${mean(row.meanLatencyMs)}ms, recentMeanHolderSteps=${mean(row.meanHolderSteps)}`)
      if (recent.length > 0) details.push(`${row.peerId} recent=[${recent}]`)
    }
    for (const row of quality) {
      lines.push(`${row.peerId} quality: requester accepted=${row.requester.accepted}, rejected=${row.requester.rejected}, needs-more=${row.requester.needsMore}; ` +
        `host passed=${row.host.passed}, failed=${row.host.failed}, unverified=${row.host.unverified}. Requester judgement is not host verification.`)
    }
  }
  // Keep every peer id and numerical summary intact; only optional detail may
  // be cut. An invalid imported record whose identifiers alone exceed the cap
  // is not injected or acknowledged, rather than silently changing identities.
  const core = lines.join('\n')
  if (Buffer.byteLength(core) > MAX_TOPOLOGY_FEEDBACK_BYTES) return undefined
  const detail = details.length === 0 ? '' : `\n${details.join('\n')}`
  const suffix = '\n[detail truncated]'
  const available = MAX_TOPOLOGY_FEEDBACK_BYTES - Buffer.byteLength(core)
  const bounded = Buffer.byteLength(detail) <= available ? detail
    : available >= Buffer.byteLength(suffix)
      ? truncateUtf8(detail, available - Buffer.byteLength(suffix)) + suffix : ''
  return createUserMessage({
    content: [{ type: 'text', text: core + bounded }],
    source: {
      kind: 'atn', form: 'snapshot',
      sections: [{ name: SNAPSHOT_SECTION, text: JSON.stringify({ networkId: record.id, nodeId, peers, telemetryFingerprint, admittedStep }) }],
    },
  })
}
