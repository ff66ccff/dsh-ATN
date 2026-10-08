/** Public ledger fixture and host-only constructive checks for the equal-budget study.
 * Only the task value and renderEqualBudgetPrompt output may enter model context.
 * The reference solver is a configuration check, never a measured comparison arm.
 */
import { isDeepStrictEqual } from 'node:util'
import type { PilotEvaluation } from './evaluation.ts'
import type { PilotDocument, PilotTask } from './tasks.ts'
import { EQUAL_BUDGET_MODES, EQUAL_BUDGET_V3_MODES, type EqualBudgetMode } from './equal-budget.ts'

export const EQUAL_BUDGET_ACCOUNTS = ['A', 'B', 'C', 'D'] as const
export const EQUAL_BUDGET_ORDERS_PER_SHARD = 40
const CUTOFF = '2030-01-01T12:00:00Z'
type Account = typeof EQUAL_BUDGET_ACCOUNTS[number]
type Balances = Record<Account, number>

export interface EqualBudgetTask extends Omit<PilotTask, 'revision'> {
  readonly id: 'ledger-reconciliation'
  readonly revision: 1 | 2
  readonly seed: number
  readonly shardIds: readonly string[]
  readonly ordersPerShard: number
  readonly compactAnswer?: boolean
}

export interface EqualBudgetTaskOptions {
  readonly ordersPerShard?: number
  readonly compactAnswer?: boolean
}

export interface EqualBudgetShardAnswer {
  readonly netByAccount: Balances
  readonly countedEventCount: number
  readonly excludedEventCount: number
  readonly deduplicatedEventCount: number
}

export interface EqualBudgetAnswer {
  readonly shards: Record<string, EqualBudgetShardAnswer>
  readonly mergedNetByAccount: Balances
  readonly grandTotal: number
  readonly evidence: readonly string[]
}

function random(seed: number): () => number {
  let state = seed >>> 0
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}

function shuffle<T>(values: T[], next: () => number): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[values[i], values[j]] = [values[j], values[i]]
  }
  return values
}

const emptyBalances = (): Balances => ({ A: 0, B: 0, C: 0, D: 0 })

/** Each shard has its own order/event/correction namespace and no cross-shard dependencies. */
export function getEqualBudgetTask(seed: number, shards = 8, options: EqualBudgetTaskOptions = {}): EqualBudgetTask {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('seed must be an unsigned 32-bit integer')
  if (!Number.isSafeInteger(shards) || shards < 1 || shards > 32) throw new Error('shards must be an integer from 1 to 32')
  const ordersPerShard = options.ordersPerShard ?? EQUAL_BUDGET_ORDERS_PER_SHARD
  if (!Number.isSafeInteger(ordersPerShard) || (ordersPerShard !== EQUAL_BUDGET_ORDERS_PER_SHARD && (ordersPerShard < 8 || ordersPerShard > 12))) throw new Error('ordersPerShard must be an integer from 8 to 12, or the legacy value 40')
  if (options.compactAnswer !== undefined && typeof options.compactAnswer !== 'boolean') throw new Error('compactAnswer must be a boolean')
  const compactAnswer = options.compactAnswer === true
  const shardIds = Array.from({ length: shards }, (_, i) => `shard-${String(i + 1).padStart(2, '0')}`)
  const documents: PilotDocument[] = [{ id: 'policy', text: [
    `Payment settlement cutoff: ${CUTOFF}, inclusive. Amounts are integer credits; no currency conversion or rounding.`,
    'Each shard is an independent ledger. Orders, event ids and corrections belong only to that shard. Accounts A, B, C and D are shared reporting categories; include all four even when a balance is zero.',
    'Deduplicate identical event ids before applying time or type rules. All copies of an event id are identical. deduplicatedEventCount is the number of distinct event ids that occur more than once, not the number of repeated rows.',
    'A unique capture at or before cutoff adds amount. A unique refund at or before cutoff subtracts amount. Authorization contributes nothing. countedEventCount is the number of unique eligible capture/refund ids. excludedEventCount is the number of unique ids excluded for type or time; a repeated copy is not another excluded event.',
    'Start with the account in orders. An account correction applies only when status=approved and effectiveAt is at or before cutoff. Among eligible corrections for the same order use the greatest revision, regardless of row order. Apply the resulting account to every eligible event of that order. Ignore pending/rejected and future-effective corrections.',
    compactAnswer
      ? 'Compute each independent shard separately, then sum each account across every shard into mergedNetByAccount and sum those four merged balances into grandTotal. A local result shared with another agent should identify its shard and all four netByAccount balances. The final answer contains only the four consolidated balances, grandTotal and evidence; do not include local results or event counts. Cite every supplied document id once in evidence. Local results alone are not a final answer.'
      : 'For each shard report all four account balances and the three event counts. Then sum each account across every shard into mergedNetByAccount, and sum those four merged balances into grandTotal. Cite every supplied document id once in evidence. Local results alone are not a final answer.',
  ].join('\n') }]
  for (let index = 0; index < shardIds.length; index++) {
    const shardId = shardIds[index]
    const next = random((seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0)
    const integer = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))
    const orders: string[] = [], events: string[] = [], corrections: string[] = []
    for (let orderIndex = 1; orderIndex <= ordersPerShard; orderIndex++) {
      const orderId = `${shardId}-o${String(orderIndex).padStart(2, '0')}`
      const accountIndex = integer(0, EQUAL_BUDGET_ACCOUNTS.length - 1)
      orders.push(`${orderId},${EQUAL_BUDGET_ACCOUNTS[accountIndex]}`)
      const amount = integer(80, 980), refund = integer(1, amount - 1)
      const authorization = `${orderId}-a,${orderId},authorization,${amount},2030-01-01T09:00:00Z`
      const capture = `${orderId}-c,${orderId},capture,${amount},${orderIndex % 5 === 0 ? CUTOFF : '2030-01-01T10:30:00Z'}`
      const refundEvent = `${orderId}-r,${orderId},refund,${refund},${orderIndex % 4 === 0 ? '2030-01-01T12:00:01Z' : orderIndex % 3 === 0 ? CUTOFF : '2030-01-01T11:15:00Z'}`
      events.push(authorization, capture, refundEvent)
      if (orderIndex % 4 === 0) events.push(`${orderId}-x,${orderId},capture,${integer(20, 400)},2030-01-01T12:01:00Z`)
      if (orderIndex % 5 === 0) events.push(capture)
      if (orderIndex % 10 === 0) events.push(authorization, authorization)
      if (orderIndex % 3 === 0) {
        const changed = EQUAL_BUDGET_ACCOUNTS[(accountIndex + integer(1, 3)) % 4]
        corrections.push(`${orderId},1,${changed},approved,2030-01-01T11:00:00Z`)
        if (orderIndex % 6 === 0) corrections.push(`${orderId},2,${EQUAL_BUDGET_ACCOUNTS[(accountIndex + 2) % 4]},approved,${CUTOFF}`)
        corrections.push(`${orderId},3,${EQUAL_BUDGET_ACCOUNTS[accountIndex]},approved,2030-01-01T12:00:01Z`)
        corrections.push(`${orderId},4,${EQUAL_BUDGET_ACCOUNTS[(accountIndex + 1) % 4]},${orderIndex % 2 === 0 ? 'pending' : 'rejected'},2030-01-01T11:45:00Z`)
      }
    }
    documents.push(
      { id: `${shardId}/orders`, text: ['order,account', ...shuffle(orders, next)].join('\n') },
      { id: `${shardId}/events`, text: ['id,order,type,amount,time', ...shuffle(events, next)].join('\n') },
      { id: `${shardId}/corrections`, text: ['order,revision,account,status,effectiveAt', ...shuffle(corrections, next)].join('\n') },
    )
  }
  return {
    id: 'ledger-reconciliation', title: 'Reconcile independent settlement ledgers and consolidate accounts', revision: compactAnswer ? 2 : 1,
    seed, shardIds, ordersPerShard, documents, ...(compactAnswer ? { compactAnswer } : {}),
    instruction: `Reconcile all ${shards} independent settlement shards at the cutoff using their order, event and correction documents and the shared policy. Any agent can independently solve any shard. Merge every local result into one exact consolidated answer. You may choose your own solving and collaboration strategy.`,
    answerFormat: compactAnswer
      ? '{"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied document id exactly once; evidence order does not matter and duplicate evidence ids are forbidden.'
      : '{"shards":{"shard-01":{"netByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"countedEventCount":integer,"excludedEventCount":integer,"deduplicatedEventCount":integer},"...one entry per supplied shard...":{}},"mergedNetByAccount":{"A":integer,"B":integer,"C":integer,"D":integer},"grandTotal":integer,"evidence":[document-id]}. No extra fields. Include every supplied shard exactly once; evidence order does not matter and duplicate evidence ids are forbidden.',
  }
}

/** List the same document access surface for every arm; reads grow context naturally. */
export function renderEqualBudgetPrompt(task: EqualBudgetTask): string {
  return [
    `Equal-budget ledger task (revision ${task.revision}, fixture seed ${task.seed}): ${task.title}`,
    task.instruction,
    'Read the supplied documents using read_document. Every agent has access to the same complete document set. Facts and intermediate results may be shared using the collaboration tools available in your arm.',
    'Start with document policy. The shard documents are independent; no shard requires evidence from another shard. Each has orders, events and corrections.',
    ...(task.compactAnswer ? [`Each shard contains ${task.ordersPerShard} orders. You may work one shard at a time, keep concise intermediate balances, and merge only after all ${task.shardIds.length} shards are accounted for. Multiple read_document calls may be issued in the same model turn. The solving strategy is your choice.`] : []),
    `Document ids:\n${task.documents.map(document => document.id).join('\n')}`,
    `Return one JSON object as the final answer, with this format:\n${task.answerFormat}`,
    'A statement that work is completed is not an answer. Do not include prose outside the JSON object.',
  ].join('\n\n')
}

/** The V3 control changes only the user prompt; no new tool or host scheduling is added. */
export const EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION = [
  'Required solving procedure: process the shards sequentially, one shard per model call. Do not try to calculate all shards in a single call.',
  'Read the shared policy and the current shard documents with read_document. Compute that shard and record a concise intermediate result in your conversation: its shard id and all four netByAccount balances. Preserve the accumulated intermediate results as you proceed to the next shard.',
  'Use the existing read_document tool to request the next shard documents and continue across calls. Intermediate results are working notes, not the final answer; do not finish while any shard remains unprocessed.',
  'After every shard has an intermediate result, check that every shard occurs exactly once, merge the accumulated balances, and submit the one final JSON object in the required answer format.',
].join('\n')

export function renderEqualBudgetSingleScaffoldedPrompt(task: EqualBudgetTask): string {
  return `${renderEqualBudgetPrompt(task)}\n\n${EQUAL_BUDGET_SINGLE_SCAFFOLD_INSTRUCTION}`
}

function readTable(task: EqualBudgetTask, id: string, headers: string): string[][] {
  const document = task.documents.find(candidate => candidate.id === id)
  if (!document) throw new Error(`Missing fixture document: ${id}`)
  const [header, ...rows] = document.text.trim().split('\n')
  if (header !== headers) throw new Error(`Invalid fixture header: ${id}`)
  return rows.map(row => {
    const values = row.split(',')
    if (values.length !== header.split(',').length) throw new Error(`Invalid fixture row: ${id}`)
    return values
  })
}

/** Host-only solver reads public evidence, never a precomputed answer or hidden seed oracle. */
export function constructEqualBudgetShardAnswer(task: EqualBudgetTask, shardId: string): EqualBudgetShardAnswer {
  if (!task.shardIds.includes(shardId)) throw new Error(`Unknown shard: ${shardId}`)
  const policy = task.documents.find(document => document.id === 'policy')
  const cutoff = /cutoff: ([\dT:Z-]+), inclusive/.exec(policy?.text ?? '')?.[1]
  if (!cutoff) throw new Error('Missing fixture cutoff policy')
  const accounts = new Map(readTable(task, `${shardId}/orders`, 'order,account').map(([order, account]) => [order, account]))
  const revisions = new Map<string, number>()
  for (const [order, revisionText, account, status, effectiveAt] of readTable(task, `${shardId}/corrections`, 'order,revision,account,status,effectiveAt')) {
    const revision = Number(revisionText)
    if (!accounts.has(order) || !Number.isSafeInteger(revision)) throw new Error('Invalid fixture correction')
    if (status === 'approved' && effectiveAt <= cutoff && revision > (revisions.get(order) ?? -1)) {
      accounts.set(order, account)
      revisions.set(order, revision)
    }
  }
  const netByAccount = emptyBalances(), seen = new Map<string, string>(), duplicates = new Set<string>()
  let countedEventCount = 0, excludedEventCount = 0
  for (const row of readTable(task, `${shardId}/events`, 'id,order,type,amount,time')) {
    const [id, order, type, amountText, time] = row
    const signature = row.join(',')
    if (seen.has(id)) {
      if (seen.get(id) !== signature) throw new Error('Conflicting duplicate fixture event')
      duplicates.add(id)
      continue
    }
    seen.set(id, signature)
    const amount = Number(amountText), account = accounts.get(order) as Account | undefined
    if (!Number.isSafeInteger(amount) || amount < 0 || !account || !EQUAL_BUDGET_ACCOUNTS.includes(account)) throw new Error('Invalid fixture event')
    if (time > cutoff || type === 'authorization') { excludedEventCount++; continue }
    if (type !== 'capture' && type !== 'refund') throw new Error('Invalid fixture event type')
    netByAccount[account] += type === 'capture' ? amount : -amount
    countedEventCount++
  }
  return { netByAccount, countedEventCount, excludedEventCount, deduplicatedEventCount: duplicates.size }
}

/** The final merge is explicit: returning only independently correct shards is insufficient. */
export function mergeEqualBudgetShardAnswers(task: EqualBudgetTask, shards: Record<string, EqualBudgetShardAnswer>): EqualBudgetAnswer {
  if (!isDeepStrictEqual(Object.keys(shards).sort(), [...task.shardIds].sort())) throw new Error('Merge requires every shard exactly once')
  const mergedNetByAccount = emptyBalances()
  for (const shardId of task.shardIds) for (const account of EQUAL_BUDGET_ACCOUNTS) mergedNetByAccount[account] += shards[shardId].netByAccount[account]
  return { shards: structuredClone(shards), mergedNetByAccount,
    grandTotal: Object.values(mergedNetByAccount).reduce((sum, value) => sum + value, 0),
    evidence: task.documents.map(document => document.id) }
}

export function constructEqualBudgetAnswer(task: EqualBudgetTask): EqualBudgetAnswer {
  return mergeEqualBudgetShardAnswers(task, Object.fromEntries(task.shardIds.map(id => [id, constructEqualBudgetShardAnswer(task, id)])))
}

/** Wire artifact for the selected fixture revision; the full solver stays host-only. */
export function constructEqualBudgetSubmission(task: EqualBudgetTask): EqualBudgetAnswer | Omit<EqualBudgetAnswer, 'shards'> {
  const answer = constructEqualBudgetAnswer(task)
  if (!task.compactAnswer) return answer
  const { shards: _shards, ...submission } = answer
  return submission
}

/** Host-only exact artifact check. Diagnostics never return oracle values to a model. */
export function evaluateEqualBudgetTask(task: EqualBudgetTask, answerText: string): PilotEvaluation {
  const fail = (error: string): PilotEvaluation => ({ taskId: task.id, passed: false, score: 0, checks: [], error })
  if (Buffer.byteLength(answerText, 'utf8') > 16_384) return fail('answer-too-large')
  const trimmed = answerText.trim(), fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  let value: unknown
  try { value = JSON.parse(fence?.[1] ?? trimmed) } catch { return fail('invalid-json') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('answer-must-be-object')
  const actual = value as Record<string, unknown>, expected = constructEqualBudgetAnswer(task)
  const keysMatch = isDeepStrictEqual(Object.keys(actual).sort(), (task.compactAnswer ? ['mergedNetByAccount', 'grandTotal', 'evidence'] : Object.keys(expected)).sort())
  const shards = actual.shards && typeof actual.shards === 'object' && !Array.isArray(actual.shards) ? actual.shards as Record<string, unknown> : {}
  const evidence = actual.evidence
  const checks = [
    ...task.compactAnswer ? [] : [
      { name: 'shard-coverage', passed: isDeepStrictEqual(Object.keys(shards).sort(), [...task.shardIds].sort()) },
      ...task.shardIds.map(id => ({ name: `shards.${id}`, passed: isDeepStrictEqual(shards[id], expected.shards[id]) })),
    ],
    { name: 'mergedNetByAccount', passed: isDeepStrictEqual(actual.mergedNetByAccount, expected.mergedNetByAccount) },
    { name: 'grandTotal', passed: actual.grandTotal === expected.grandTotal },
    { name: 'evidence', passed: Array.isArray(evidence) && evidence.every(id => typeof id === 'string') && new Set(evidence).size === evidence.length && isDeepStrictEqual([...evidence].sort(), [...expected.evidence].sort()) },
  ]
  const score = checks.filter(check => check.passed).length / checks.length
  return { taskId: task.id, passed: keysMatch && score === 1, score, checks, ...keysMatch ? {} : { error: 'unexpected-or-missing-fields' } }
}

export interface EqualBudgetSolvabilityAllocation {
  readonly mode: EqualBudgetMode
  readonly agents: number
  readonly entrySteps: number
}

/** Conservative witness: one document read per step, then one final answer;
 * ATN additionally spends one step starting its network before it can submit.
 * No teamwork is necessary for this feasibility proof; every configured entry has
 * identical read permissions. It does not claim models will find this answer.
 */
export function verifyEqualBudgetSolvability(task: EqualBudgetTask, allocations: readonly EqualBudgetSolvabilityAllocation[], options: { documentReadsPerStep?: number; modes?: readonly EqualBudgetMode[] } = {}) {
  const documentReadsPerStep = options.documentReadsPerStep ?? 1
  if (!Number.isSafeInteger(documentReadsPerStep) || documentReadsPerStep < 1 || documentReadsPerStep > 2) throw new Error('documentReadsPerStep must be 1 or 2')
  const answer = constructEqualBudgetSubmission(task)
  const evaluation = evaluateEqualBudgetTask(task, JSON.stringify(answer))
  const sufficientSerialSteps = Math.ceil(task.documents.length / documentReadsPerStep) + 1
  const modes = options.modes ?? EQUAL_BUDGET_MODES
  if (!modes.length || new Set(modes).size !== modes.length || modes.some(mode => !EQUAL_BUDGET_V3_MODES.includes(mode))
    || !isDeepStrictEqual(allocations.map(allocation => allocation.mode).sort(), [...modes].sort())) {
    throw new Error(options.modes ? 'Solvability check requires each of the selected arms exactly once' : 'Solvability check requires each of the four arms exactly once')
  }
  const arms = allocations.map(allocation => {
    const startupSteps = allocation.mode === 'atn-adaptive' ? 1 : 0
    return { ...allocation, witness: 'entry-reads-all-documents-and-submits' as const,
      startupSteps, documentReadsPerStep, sufficientSerialSteps: sufficientSerialSteps + startupSteps, documentIds: task.documents.map(document => document.id),
      passed: evaluation.passed && Number.isSafeInteger(allocation.agents) && allocation.agents >= 1 && Number.isSafeInteger(allocation.entrySteps) && allocation.entrySteps >= sufficientSerialSteps + startupSteps }
  })
  return { issuedModelCalls: 0 as const, configurationCheckOnly: true as const, causalClaim: false as const,
    taskId: task.id, seed: task.seed, fixtureBytes: task.documents.reduce((sum, document) => sum + Buffer.byteLength(document.text), 0),
    answerBytes: Buffer.byteLength(JSON.stringify(answer)), documentReadsPerStep, sufficientSerialSteps, arms, passed: arms.every(arm => arm.passed) }
}
