import type { NetworkRecord } from '../src/schema.ts'
import { mailBytes } from '../src/mailbox.ts'

/** Count durable messages once, including records later pruned from retention. */
export function createAtnCostMeter() {
  const sent = new Set<string>()
  const received = new Set<string>()
  const context = new Map<string, number>()
  const networks = new Map<string, number>()
  let messages = 0
  let payloadBytes = 0
  let hops = 0
  return {
    observe(record: NetworkRecord) {
      if (!networks.has(record.id)) networks.set(record.id, networks.size + 1)
      for (const mail of Object.values(record.mails)) {
        const key = `${record.id}:${mail.id}`
        const bytes = mailBytes(mail, mail.kind === 'result' && mail.taskId ? record.tasks[mail.taskId]?.result : undefined)
        if (!sent.has(key)) { sent.add(key); messages++; payloadBytes += bytes }
        if (mail.status === 'delivered' && !received.has(key)) {
          received.add(key)
          // ATN sends one directed edge at a time; forwarding creates another mail.
          hops++
          const recipient = `network-${networks.get(record.id)}:${mail.toId}`
          context.set(recipient, (context.get(recipient) ?? 0) + bytes)
        }
      }
    },
    snapshot() {
      // Retain the historical report shape; the removed channel has no live usage.
      const board = { reads: 0, writes: 0, readBytes: 0, writeBytes: 0 }
      return { messages, hops, payloadBytes, maxContextBytes: Math.max(0, ...context.values()),
        board, totalInteractions: messages + board.reads + board.writes,
        totalTransferBytes: payloadBytes + board.readBytes + board.writeBytes,
        contextBytesByNode: Object.fromEntries(context) }
    },
  }
}
