/** Host-only pilot oracle. Never include this module or its expected values in agent context. */
import { isDeepStrictEqual } from 'node:util'
import { PILOT_TASK_IDS, type PilotTaskId } from './tasks.ts'

export interface PilotCheck {
  readonly name: string
  readonly passed: boolean
}

/** Objective artifact checks, independent of every architecture's completion state. */
export interface PilotEvaluation {
  readonly taskId: PilotTaskId
  readonly passed: boolean
  readonly score: number
  readonly checks: readonly PilotCheck[]
  readonly error?: string
}

type Rule = { readonly name: string; readonly value: unknown; readonly set?: true }

// This private table is deliberately absent from the public task module.
const EXPECTED: Record<PilotTaskId, readonly Rule[]> = {
  'ledger-reconciliation': [
    { name: 'netByAccount', value: { A: 160, B: 40 } },
    { name: 'excludedEventIds', value: ['e3', 'e5'], set: true },
    { name: 'deduplicatedEventIds', value: ['e4'], set: true },
    { name: 'evidence', value: ['policy', 'orders', 'events', 'correction'], set: true },
  ],
  'release-candidate': [
    { name: 'selected', value: 'eu-c' },
    { name: 'eligible', value: ['eu-c', 'eu-d'], set: true },
    { name: 'excludedByReason', value: { 'eu-a': 'latency', 'eu-b': 'approval', 'us-e': 'region' } },
    { name: 'evidence', value: ['requirements', 'inventory', 'probes', 'approvals'], set: true },
  ],
  'boundary-diagnosis': [
    { name: 'failingCaseIds', value: ['at-start', 'at-expiry'], set: true },
    { name: 'operators', value: { expiry: '>', start: '>=' } },
    { name: 'expected', value: { 'before-start': false, 'at-start': true, inside: true, 'at-expiry': false, disabled: false } },
    { name: 'evidence', value: ['contract', 'implementation', 'cases'], set: true },
  ],
}

function matchesSet(actual: unknown, expected: unknown): boolean {
  if (!Array.isArray(actual) || !actual.every(item => typeof item === 'string')) return false
  if (new Set(actual).size !== actual.length) return false
  return isDeepStrictEqual([...actual].sort(), [...expected as readonly string[]].sort())
}

/**
 * Parse a final artifact and check facts with the private oracle, not model self-report.
 * A sole JSON code fence is accepted; surrounding prose or multiple objects is rejected.
 * Diagnostics contain check names only, so a runner cannot inadvertently echo answers.
 */
export function evaluatePilotTask(taskId: PilotTaskId, answerText: string): PilotEvaluation {
  if (!PILOT_TASK_IDS.includes(taskId)) throw new Error(`Unknown pilot task: ${String(taskId)}`)
  const fail = (error: string): PilotEvaluation => ({ taskId, passed: false, score: 0, checks: [], error })
  if (Buffer.byteLength(answerText, 'utf8') > 16_384) return fail('answer-too-large')
  const trimmed = answerText.trim()
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  let value: unknown
  try { value = JSON.parse(fence?.[1] ?? trimmed) }
  catch { return fail('invalid-json') }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('answer-must-be-object')
  const answer = value as Record<string, unknown>
  const rules = EXPECTED[taskId]
  const keysMatch = isDeepStrictEqual(Object.keys(answer).sort(), rules.map(rule => rule.name).sort())
  const checks = rules.map(rule => ({
    name: rule.name,
    passed: Object.hasOwn(answer, rule.name) && (rule.set
      ? matchesSet(answer[rule.name], rule.value)
      : isDeepStrictEqual(answer[rule.name], rule.value)),
  }))
  const score = checks.filter(check => check.passed).length / checks.length
  return { taskId, passed: keysMatch && score === 1, score, checks, ...keysMatch ? {} : { error: 'unexpected-or-missing-fields' } }
}
