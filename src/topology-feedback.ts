/** Bounded local graph feedback, acknowledged only by the normal session log. */
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { NetworkRecord } from './schema.ts'
import { collaborationPeers, MAX_COLLABORATION_PEERS } from './topology.ts'
import { materialFingerprint, summarizeLocalFeedback } from './local-feedback.ts'

const SNAPSHOT_SECTION = 'atn/topology-snapshot'
export const MIN_FEEDBACK_STEP_INTERVAL = 3

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
  const peers = collaborationPeers(record.nodes, nodeId).toSorted()
  const previous = previousSnapshot(events, record.id, nodeId)
  const telemetry = peers.map(peerId => summarizeLocalFeedback(record, peerId, { observerId: nodeId, now }))
  const telemetryFingerprint = materialFingerprint(telemetry)
  if (previous !== undefined && previous.peers.length === peers.length && previous.peers.every(id => peers.includes(id)) &&
    previous.telemetryFingerprint === telemetryFingerprint) {
    return undefined
  }
  const admittedStep = record.nodes[nodeId]?.stepsUsed ?? 0
  if (previous?.admittedStep !== undefined && Number.isSafeInteger(previous.admittedStep) && previous.admittedStep >= 0 &&
    admittedStep - previous.admittedStep < MIN_FEEDBACK_STEP_INTERVAL) return undefined
  const lines = [`[ATN local changes] network=${record.id} node=${nodeId}`]
  if (previous === undefined) {
    lines.push(`Initial neighbours: ${peers.join(', ') || '(none)'}`)
  } else {
    const removed = previous.peers.filter(id => !peers.includes(id))
    const added = peers.filter(id => !previous.peers.includes(id))
    if (removed.length > 0) {
      lines.push(`Removed: ${removed.map(id => {
        const peer = record.nodes[id]
        const reason = peer?.lifecycle !== 'active' && peer?.note
          ? `: ${peer.note.replace(/\s+/g, ' ').slice(0, 160)}` : ''
        return `${id} (${peer?.lifecycle ?? 'unavailable'}${reason})`
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
        `recentMeanLatency=${mean(row.meanLatencyMs)}ms, recentMeanHolderSteps=${mean(row.meanHolderSteps)}` +
        (recent.length > 0 ? `; recent=[${recent}]` : ''))
    }
  }
  return createUserMessage({
    content: [{ type: 'text', text: lines.join('\n') }],
    source: {
      kind: 'atn', form: 'snapshot',
      sections: [{ name: SNAPSHOT_SECTION, text: JSON.stringify({ networkId: record.id, nodeId, peers, telemetryFingerprint, admittedStep }) }],
    },
  })
}
