/** Public OpenCode Go catalog checks; all inference is mounted through dsh-opencode-go. */
import { OpencodeGoCatalog, DEFAULT_BASE_URL, PROVIDER_ID } from 'dsh-opencode-go'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

export const REQUESTED_MODELS = ['deepseek-v4.1-flash'] as const
export interface PilotModel {
  id: string
  name: string
  api: string
  contextWindow?: number
  catalogFree: boolean
  referenceCostPerMillion: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

/** Current execution scope: live-catalog free routes or the user-requested DeepSeek route. */
export function assertAllowedPilotModel(model: PilotModel): void {
  const cost = model.referenceCostPerMillion
  const free = model.catalogFree && [cost.input, cost.output, cost.cacheRead, cost.cacheWrite].every(value => value === 0)
  if (!free && !REQUESTED_MODELS.includes(model.id as typeof REQUESTED_MODELS[number])) {
    throw new Error(`Model is outside the authorized free-or-DeepSeek-V4.1-Flash execution scope: ${model.id}`)
  }
}

export async function discoverPilotModels(): Promise<{ checkedAt: string; provider: string; models: PilotModel[] }> {
  const warnings: string[] = []
  const catalog = new OpencodeGoCatalog(DEFAULT_BASE_URL, 60_000,
    () => { warnings.push('catalog-refresh-failed') },
    () => { warnings.push('unconfigured-models') })
  const snapshot = await catalog.snapshot(true, AbortSignal.timeout(45_000))
  if (!snapshot.live || !snapshot.metadataLive) throw new Error('A live gateway catalog and live pricing metadata are required for pilot selection')
  const models = [...snapshot.models.values()]
    .filter(model => REQUESTED_MODELS.includes(model.id as typeof REQUESTED_MODELS[number]) || Object.values(model.cost).every(value => value === 0))
    .map(model => ({ id: model.id, name: model.name, api: model.api, contextWindow: model.contextWindow,
      catalogFree: model.cost.input === 0 && model.cost.output === 0 && model.cost.cacheRead === 0 && model.cost.cacheWrite === 0,
      referenceCostPerMillion: { ...model.cost } }))
  return { checkedAt: new Date().toISOString(), provider: PROVIDER_ID, models }
}

/** Round 11 prerequisite: preserve a read-only live-catalog check even when unavailable. */
export async function checkEqualBudgetModelCatalog(outputPath: string,
  discover: typeof discoverPilotModels = discoverPilotModels) {
  const startedAt = new Date().toISOString()
  let catalog: Awaited<ReturnType<typeof discoverPilotModels>> | null = null
  let failure: 'catalog-request-failed' | 'target-model-not-visible' | null = null
  try {
    catalog = await discover()
    if (!catalog.models.some(model => model.id === 'deepseek-v4.1-flash')) failure = 'target-model-not-visible'
  } catch {
    // Do not serialize transport errors, which may contain credentials or request headers.
    failure = 'catalog-request-failed'
  }
  const record = { version: 1, round: 11, startedAt, checkedAt: new Date().toISOString(),
    targetModel: 'deepseek-v4.1-flash', provider: PROVIDER_ID,
    status: failure === null ? 'available' as const : 'unavailable' as const,
    failure, catalog, readOnly: true, issuedModelCalls: 0, causalClaim: false,
    limitation: 'Visibility at check time only; does not guarantee later provider routing or inference availability.' }
  await mkdir(dirname(resolve(outputPath)), { recursive: true })
  await writeFile(resolve(outputPath), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  return record
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.env.DSH_HOME ??= resolve('.scratch/pilot-harness-home')
  const result = await discoverPilotModels()
  const directory = resolve('.artifacts/experiments')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'model-catalog.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}
