/** Integer-only BM25 and message citation weights. No host identity, clock or mutable index. */
import type { NetworkRecord, SubstrateMessage, SubstrateWeight } from './schema.ts'

export const SCALE = 1000000n
const PRECISION = 1000000000000000000000000n
const LN_TWO = 693147180559945309417232n

/** NFKC, lowercase, Unicode letter/digit words, plus adjacent Han/Kana/Hangul bigrams. */
export function tokenize(text: string): string[] {
  const words = text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const tokens: string[] = []
  for (const word of words) {
    tokens.push(word)
    for (const run of word.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? []) {
      const chars = [...run]
      for (let i = 1; i < chars.length; i++) tokens.push(chars[i - 1] + chars[i])
    }
  }
  return tokens
}

/** floor(ln(numerator/denominator)*SCALE), for ratios >= 1; internal error < one output unit. */
export function fixedLn(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < denominator) throw new Error('log ratio must be >= 1')
  let powers = 0n
  while (numerator >= 2n * denominator) { denominator *= 2n; powers++ }
  // Range reduction makes z <= 1/3; 64 odd terms leave a tail below internal precision.
  const z = (numerator - denominator) * PRECISION / (numerator + denominator)
  const zSquared = z * z / PRECISION
  let term = z
  let sum = term
  for (let divisor = 3n; divisor <= 127n; divisor += 2n) {
    term = term * zSquared / PRECISION
    sum += term / divisor
  }
  return (2n * sum + powers * LN_TWO) * SCALE / PRECISION
}

/** BM25 k1=3/2, b=3/4. References/author are never indexed. Returned values use SCALE. */
export function bm25Relevance(messages: readonly SubstrateMessage[], query: string): Map<string, bigint> {
  const documents = messages.map(message => ({ message,
    tokens: tokenize(`${message.sub_task} ${message.artifact} ${message.rationale}`) }))
  const totalLength = documents.reduce((sum, doc) => sum + BigInt(doc.tokens.length), 0n)
  const count = BigInt(documents.length)
  const terms = [...new Set(tokenize(query))]
  const result = new Map<string, bigint>()
  if (totalLength === 0n) return result
  const frequencies = new Map(terms.map(term => [term, BigInt(documents.filter(doc => doc.tokens.includes(term)).length)]))
  const idfs = new Map(terms.map(term => [term, fixedLn(2n * count + 2n, 2n * frequencies.get(term)! + 1n)]))
  for (const { message, tokens } of documents) {
    let score = 0n
    for (const term of terms) {
      const tf = BigInt(tokens.filter(token => token === term).length)
      if (tf === 0n) continue
      const idf = idfs.get(term)!
      score += idf * 20n * tf * totalLength / (8n * tf * totalLength + 3n * totalLength + 9n * BigInt(tokens.length) * count)
    }
    result.set(message.address, score)
  }
  return result
}

/** Stepwise floors are exact; looping stops at zero even after very large epoch gaps. */
export function decayWeight(weight: SubstrateWeight, epoch: number): number {
  let value = BigInt(weight.value)
  let steps = epoch - weight.epoch
  if (steps < 0) throw new Error('weight epoch is in the future')
  while (steps > 0 && value > 0n) { value = value * 49n / 50n; steps-- }
  return Number(value)
}

export function citeWeight(value: number): number {
  const fixed = BigInt(value)
  return Number(fixed + 3n * (SCALE - fixed) / 10n)
}

/** Metadata only; models never receive this function's result. */
export function weightAt(record: NetworkRecord, address: string, epoch = record.stepsUsed): number | undefined {
  if (record.limits.substrateCitationWeight === false) return undefined
  const weight = record.substrate?.weights?.[address]
  return weight === undefined ? 0 : decayWeight(weight, epoch)
}

/** Rebuild any persisted prefix at its admitted-step epoch, independent of stored weight cache. */
export function replayWeights(record: NetworkRecord): Record<string, number> {
  if (record.limits.substrateCitationWeight === false) return {}
  const weights: Record<string, SubstrateWeight> = {}
  for (const message of [...(record.substrate?.messages ?? [])].sort((a, b) => addressNumber(a.address) - addressNumber(b.address))) {
    if (message.publishedEpoch > record.stepsUsed) continue
    weights[message.address] = { value: 0, epoch: message.publishedEpoch }
    for (const ref of new Set(message.refs)) {
      if (weights[ref] === undefined || ref === message.address) continue
      weights[ref] = { value: citeWeight(decayWeight(weights[ref], message.publishedEpoch)), epoch: message.publishedEpoch }
    }
  }
  return Object.fromEntries(Object.entries(weights).map(([address, weight]) => [address, decayWeight(weight, record.stepsUsed)]))
}

export function addressNumber(address: string): number { return Number(address.slice(4)) }

/** Citation weights can only reorder messages with positive lexical relevance. */
export function rankSubstrate(record: NetworkRecord, query: string): SubstrateMessage[] {
  const messages = record.substrate?.messages ?? []
  const relevance = bm25Relevance(messages, query)
  let maximum = 0n
  for (const value of relevance.values()) if (value > maximum) maximum = value
  const score = (message: SubstrateMessage): bigint =>
    BigInt(weightAt(record, message.address) ?? 0) * maximum + (relevance.get(message.address) ?? 0n) * SCALE
  return messages.filter(message => (relevance.get(message.address) ?? 0n) > 0n).sort((left, right) => {
    const a = score(left), b = score(right)
    return a > b ? -1 : a < b ? 1 : addressNumber(left.address) - addressNumber(right.address)
  })
}
