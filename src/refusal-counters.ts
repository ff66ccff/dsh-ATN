/** Content-free, volatile observer telemetry. Never written to business records. */
import { INFORMATION_BOUNDARY_REFUSAL_CODES } from './refusal.ts'
export const REFUSAL_COUNT_MAX = 65535
export const REFUSAL_NETWORK_MAX = 64
export const REFUSAL_BUCKETS = [...INFORMATION_BOUNDARY_REFUSAL_CODES, 'other'] as const
export class RefusalCounters {
 private readonly networks = new Map<string, Record<string, number>>()
 record(networkId: string, code: string): void {
  let counts = this.networks.get(networkId)
  if (!counts) {
   counts = Object.fromEntries(REFUSAL_BUCKETS.map(code => [code, 0]))
   this.networks.set(networkId, counts)
   if (this.networks.size > REFUSAL_NETWORK_MAX) this.networks.delete(this.networks.keys().next().value!)
  }
  const bucket = (REFUSAL_BUCKETS as readonly string[]).includes(code) ? code : 'other'
  counts[bucket] = Math.min(REFUSAL_COUNT_MAX, counts[bucket] + 1)
 }
 snapshot(networkId: string) {
  const buckets = { ...Object.fromEntries(REFUSAL_BUCKETS.map(code => [code, 0])), ...this.networks.get(networkId) }
  return { buckets, total: Object.values(buckets).reduce((sum, count) => sum + count, 0), capPerBucket: REFUSAL_COUNT_MAX as typeof REFUSAL_COUNT_MAX,
   persistence: 'volatile' as const }
 }
}
