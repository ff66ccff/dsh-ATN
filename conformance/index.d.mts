export interface ConformanceCase { contract: string; channel?: string; held?: boolean; field?: string; code?: string }
export interface HostFixture {
 exercise(): Promise<unknown>
 snapshot(): Promise<unknown>
 close(): Promise<void>
}
export interface ConformanceAdapter {
 vocabulary: { channels: readonly string[]; codes: readonly string[] }
 open(specification: ConformanceCase): Promise<HostFixture>
}
export const CHANNELS: readonly string[]
export const REFUSAL_CODES: readonly string[]
export const CASES: readonly ConformanceCase[]
export function runCustodyConformance(adapter: ConformanceAdapter): Promise<{
 passed: number; failed: number; failures: { contract: string; message: string }[]; results: { contract: string; passed: boolean }[]
}>
