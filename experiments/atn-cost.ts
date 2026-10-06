import type { NetworkRecord } from '../src/schema.ts'
import { mailBytes } from '../src/mailbox.ts'

/** Count durable messages once, including records later pruned from retention. */
export function createAtnCostMeter() {
  const sent = new Set<string>()
  const received = new Set<string>()
  const context = new Map<string, number>()
  const networks = new Map<string, number>()
  const boards = new Map<string, { reads: number; writes: number; readBytes: number; writeBytes: number }>()
  let messages = 0
  let payloadBytes = 0
  let hops = 0
  return {
    observe(record: NetworkRecord) {
      if (!networks.has(record.id)) networks.set(record.id, networks.size + 1)
      if (record.whiteboard) {
        const previous = boards.get(record.id)
        const usage = record.whiteboard.usage
        boards.set(record.id, { reads: Math.max(previous?.reads ?? 0, usage.reads),
          writes: Math.max(previous?.writes ?? 0, usage.writes),
          readBytes: Math.max(previous?.readBytes ?? 0, usage.readBytes),
          writeBytes: Math.max(previous?.writeBytes ?? 0, usage.writeBytes) })
      }
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
      const board = [...boards.values()].reduce((total, row) => ({ reads: total.reads + row.reads,
        writes: total.writes + row.writes, readBytes: total.readBytes + row.readBytes,
        writeBytes: total.writeBytes + row.writeBytes }), { reads: 0, writes: 0, readBytes: 0, writeBytes: 0 })
      return { messages, hops, payloadBytes, maxContextBytes: Math.max(0, ...context.values()),
        board, totalInteractions: messages + board.reads + board.writes,
        totalTransferBytes: payloadBytes + board.readBytes + board.writeBytes,
        contextBytesByNode: Object.fromEntries(context) }
    },
  }
}
