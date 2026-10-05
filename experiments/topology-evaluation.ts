/** Host-only final oracle. Do not include this module or totals in model input. */
import { isDeepStrictEqual } from 'node:util'
import { ACCOUNTS, type TopologyTask } from './topology-task.ts'

export function evaluateTopologyTask(task: TopologyTask, answerText: string) {
  const fail = (error: string) => ({ taskId: task.id, passed: false, score: 0, checks: [], error })
  if (Buffer.byteLength(answerText, 'utf8') > 16_384) return fail('answer-too-large')
  const trimmed = answerText.trim()
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  let value: unknown
  try { value = JSON.parse(fence?.[1] ?? trimmed) } catch { return fail('invalid-json') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('answer-must-be-object')
  const answer = value as Record<string, unknown>
  const totals: Record<string, number> = Object.fromEntries(ACCOUNTS.map(account => [account, 0]))
  for (const shard of task.shards) {
    for (const entry of [...shard.initial, ...shard.correction.add]) {
      if (entry.id === shard.correction.remove) continue
      const account = entry.id === shard.correction.move.id ? shard.correction.move.account : entry.account
      totals[account] += entry.amount
    }
  }
  const evidence = task.shards.flatMap(shard => [`initial-${shard.slot}`, `correction-${shard.slot}`]).sort()
  const checks = [
    { name: 'phase', passed: answer.phase === 2 },
    { name: 'netByAccount', passed: isDeepStrictEqual(answer.netByAccount, totals) },
    { name: 'evidence', passed: Array.isArray(answer.evidence) && answer.evidence.every(item => typeof item === 'string')
      && isDeepStrictEqual([...answer.evidence].sort(), evidence) },
  ]
  const keysMatch = isDeepStrictEqual(Object.keys(answer).sort(), ['evidence', 'netByAccount', 'phase'])
  return { taskId: task.id, passed: keysMatch && checks.every(check => check.passed),
    score: checks.filter(check => check.passed).length / checks.length, checks,
    ...keysMatch ? {} : { error: 'unexpected-or-missing-fields' } }
}
