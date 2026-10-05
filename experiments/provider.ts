/** Public OpenCode Go catalog checks; all inference is mounted through dsh-opencode-go. */
import { OpencodeGoCatalog, DEFAULT_BASE_URL, PROVIDER_ID } from 'dsh-opencode-go'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const REQUESTED_MODELS = ['deepseek-v4.1-flash'] as const
export interface PilotModel {
  id: string
  name: string
  api: string
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
    .map(model => ({ id: model.id, name: model.name, api: model.api,
      catalogFree: model.cost.input === 0 && model.cost.output === 0 && model.cost.cacheRead === 0 && model.cost.cacheWrite === 0,
      referenceCostPerMillion: { ...model.cost } }))
  return { checkedAt: new Date().toISOString(), provider: PROVIDER_ID, models }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.env.DSH_HOME ??= resolve('.scratch/pilot-harness-home')
  const result = await discoverPilotModels()
  const directory = resolve('.artifacts/experiments')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'model-catalog.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
}
