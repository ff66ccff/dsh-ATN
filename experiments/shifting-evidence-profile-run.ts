/** Run bounded ATN tasks through the OpenCode Go route already imported by a real dsh profile. */
import type { Context } from '@deepseek-ai/cordis'
import type LlmRuntime from '@deepseek-ai/dsh-llm'
import { LlmAdapter, isAgentLoopRequest, markAgentLoopRequest, type GenerateOptions,
  type LlmModelInfo, type ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { PROVIDER_ID } from 'dsh-opencode-go'
import { assertAllowedPilotModel, discoverPilotModels, type PilotModel } from './provider.ts'
import { runShiftingEvidence, shiftingSourceHashes, type ShiftingMode, type ShiftingLiveProviderMount } from './shifting-evidence-run.ts'
import { summarizeAdaptiveProbe, summarizeShiftingRuns,
  type ShiftingRunObservation, assertTopologyComparisonPreflight, SHIFTING_ARMS } from './shifting-evidence-protocol.ts'
import { assertSimplificationDesign, registeredSimplificationArms, summarizeSimplificationRuns, type SimplificationDesign } from './simplification-protocol.ts'

export interface ImportedProfileOptions {
  directory: string; models?: string[]; modes?: ShiftingMode[]; purpose: 'adaptive-probe' | 'comparison'
  priorProbe?: string; repeats?: number; seed?: number; agents?: number; chainLength?: number; topologyBinding?: boolean
  perNodeSteps?: number; maxCalls?: number; maxOutputTokens?: number; observedTokenLimit?: number; timeoutMs?: number
  profile?: string; sourceProfile?: string
  studyDesign?: string
}
type ImportedLlm = Pick<LlmRuntime, 'listProviders' | 'listModels' | 'resolveModelInfo' | 'prepareCall'>
export interface ImportedRequestIdentity {
  markAgentLoopRequest<T extends GenerateOptions>(request: T): T
  isAgentLoopRequest(request: GenerateOptions): boolean
}

/** Never fetches HTTP or reads keys; the mounted profile prepares every request. */
export class ImportedProfileAdapter extends LlmAdapter {
  constructor(private readonly source: ImportedLlm, private readonly retryPolicy: ResolvedRetryPolicy,
    private readonly record: (event: Record<string, unknown>) => void = () => {},
    private readonly sourceIdentity?: ImportedRequestIdentity) { super() }
  override providerInfo(provider: string) {
    const info = this.source.listProviders().find(row => row.id === provider)
    if (!info) throw new Error('Imported dsh provider is no longer mounted')
    return info
  }
  override providerRetryPolicy() { return this.retryPolicy }
  override listModels(provider: string) { return this.source.listModels(provider) }
  override resolveModel(provider: string, model: string, signal?: AbortSignal) {
    return this.source.resolveModelInfo(provider, model, signal)
  }
  override async *stream(options: GenerateOptions) {
    const callId = randomUUID(), startedAt = Date.now()
    this.record({ type: 'imported-call-start', callId, provider: options.provider, model: options.model,
      sessionId: options.sessionId, startedAt, maxTokens: options.maxTokens,
      messages: options.messages.length, tools: (options.tools ?? []).map(tool => tool.name).sort(),
      agentLoopRequest: isAgentLoopRequest(options) })
    try {
      const prepared = await this.source.prepareCall({ provider: options.provider, model: options.model,
        maxTokens: options.maxTokens, reasoningEffort: options.reasoningEffort,
        temperature: options.temperature, stop: options.stop }, options.signal)
      if (prepared.config.provider !== options.provider || prepared.config.model !== options.model ||
        (options.maxTokens !== undefined && (!Number.isFinite(prepared.config.maxTokens) ||
          prepared.config.maxTokens! <= 0 || prepared.config.maxTokens! > options.maxTokens))) {
        throw new Error('Imported profile changed the requested route or output bound')
      }
      const request = { ...options, ...prepared.config }
      if (isAgentLoopRequest(options)) {
        markAgentLoopRequest(request)
        this.sourceIdentity?.markAgentLoopRequest(request)
      }
      this.record({ type: 'imported-call-prepared', callId, provider: request.provider, model: request.model,
        maxTokens: request.maxTokens, agentLoopRequest: isAgentLoopRequest(request),
        sourceAgentLoopRequest: this.sourceIdentity?.isAgentLoopRequest(request) ?? null })
      for await (const chunk of prepared.stream(request)) {
        if (chunk.type === 'finish') this.record({ type: 'imported-call-finish', callId,
          elapsedMs: Date.now() - startedAt, kind: chunk.reason.kind,
          ...(chunk.reason.kind === 'error' ? { code: chunk.reason.failure.code, status: chunk.reason.failure.status ?? null } : {}) })
        yield chunk
      }
    } catch (error) {
      this.record({ type: 'imported-call-thrown', callId, elapsedMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : 'unknown', aborted: !!options.signal?.aborted })
      throw error
    }
  }
}

export function selectImportedValidationModels(imported: readonly LlmModelInfo[], catalog: readonly PilotModel[], requested?: readonly string[]) {
  const ids = new Set(imported.filter(row => row.provider === PROVIDER_ID).map(row => row.id))
  const selected = requested ? requested.map(id => {
    const model = catalog.find(row => row.id === id)
    if (!ids.has(id) || !model) throw new Error(`Model absent from the actual dsh import or live authorized catalog: ${id}`)
    assertAllowedPilotModel(model)
    return model
  }) : catalog.filter(model => ids.has(model.id))
  if (!selected.length || new Set(selected.map(row => row.id)).size !== selected.length) throw new Error('No unique authorized imported models')
  selected.forEach(assertAllowedPilotModel)
  return selected
}

export async function runImportedProfileValidation(parent: Context, options: ImportedProfileOptions, sourceIdentity: ImportedRequestIdentity) {
  const study: SimplificationDesign | null = options.studyDesign ? JSON.parse(await readFile(resolve(options.studyDesign), 'utf8')) : null
  if (study) {
    assertSimplificationDesign(study)
    const designRoot = dirname(resolve(options.studyDesign!))
    const reference = JSON.parse(await readFile(join(designRoot, 'reference.json'), 'utf8'))
    const criterion = JSON.parse(await readFile(join(designRoot, 'criterion-validation.json'), 'utf8'))
    const referenceModes = registeredSimplificationArms(study)
    if (!reference.passed || reference.issuedModelCalls !== 0 || !isDeepStrictEqual(reference.seeds, study.seeds) ||
      referenceModes.some(mode => study.seeds.some(seed => reference.rows.filter((row: { mode: string; seed: number; configurationPassed: boolean }) =>
        row.mode === mode && row.seed === seed && row.configurationPassed).length !== 1)) ||
      Date.parse(reference.generatedAt) > Date.parse(study.frozenAt)) throw new Error('Every registered arm needs its pre-run zero-model reference')
    if (criterion.passed !== true || criterion.issuedModelCalls !== 0 ||
      !['SIMPLIFICATION-BRIEF-REJECT', 'SIMPLIFICATION-BRIEF-ACCEPT'].every(name => criterion.requiredCases.includes(name)) ||
      !(Date.parse(criterion.completedAt) <= Date.parse(study.frozenAt))) throw new Error('Revised-brief criterion tests must pass before live runs')
  }
  if (!sourceIdentity?.markAgentLoopRequest || !sourceIdentity.isAgentLoopRequest) throw new Error('The installed profile request identity is required')
  const source = parent.get('llm') as ImportedLlm | undefined
  if (!source?.listProviders().some(row => row.id === PROVIDER_ID)) throw new Error('Actual dsh profile has not imported OpenCode Go')
  const imported = await source.listModels(PROVIDER_ID), catalog = await discoverPilotModels()
  const selected = selectImportedValidationModels(imported, catalog.models, options.models)
  if (options.topologyBinding && selected.some(model => model.id === 'longcat-2.5-preview-free')) throw new Error('LongCat is capability-insufficient and excluded from topology-binding arms')
  const repeats = options.repeats ?? 5
  const modes = options.modes ?? (study ? registeredSimplificationArms(study) : options.purpose === 'adaptive-probe' ? ['adaptive'] : options.topologyBinding ? [...SHIFTING_ARMS] : ['fixed'])
  if (!Number.isSafeInteger(repeats) || repeats < 5) throw new Error('At least five independent repeats are required')
  if (options.purpose === 'adaptive-probe' && (modes.length !== 1 || modes[0] !== 'adaptive')) throw new Error('Separate probe contains only adaptive')
  if (new Set(modes).size !== modes.length) throw new Error('Duplicate experiment arm')
  const common = { agents: options.agents ?? 8, seed: options.seed ?? 17, chainLength: options.chainLength ?? 2,
    perNodeSteps: options.perNodeSteps ?? 48, maxCalls: options.maxCalls ?? 384,
    maxOutputTokens: options.maxOutputTokens ?? 4096, observedTokenLimit: options.observedTokenLimit ?? 8_000_000,
    timeoutMs: options.timeoutMs ?? 600_000, autoAdvance: false }
  const conditions = { ...common, ...(options.topologyBinding ? { topologyBinding: true } : {}) }
  const root = resolve(options.directory)
  await mkdir(root)
  const hashes = await shiftingSourceHashes()
  if (study && (options.purpose !== 'comparison' || !isDeepStrictEqual(modes, registeredSimplificationArms(study)) ||
    !isDeepStrictEqual(hashes, study.sourceHashes) || !isDeepStrictEqual(conditions, { ...study.conditions, seed: study.seeds[0] }) ||
    repeats !== study.seeds.length || selected.length !== 1 || selected[0].id !== study.model)) {
    throw new Error('Live study differs from the registered mechanisms, seeds, source, model or budget')
  }
  const prior: ShiftingRunObservation[] = options.priorProbe
    ? (JSON.parse(await readFile(resolve(options.priorProbe), 'utf8')).completed ?? []) : []
  if (modes.length > 1 || options.topologyBinding && options.purpose === 'comparison') for (const model of selected) assertTopologyComparisonPreflight(prior.filter(row => row.model === model.id),
    { model: model.id, conditions, sourceHashes: hashes }, Array.from({ length: repeats }, (_, i) => common.seed + i * 14))
  await writeFile(join(root, 'imported-models.json'), JSON.stringify(imported, null, 2) + '\n')
  await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
  await writeFile(join(root, 'plan.json'), JSON.stringify({ execution: 'live-provider', provider: PROVIDER_ID,
    profile: options.profile ?? 'desktop-import-validation', sourceProfile: options.sourceProfile ?? 'desktop',
    selectedModels: selected, purpose: options.purpose, repeats, modes, conditions,
    sourceHashes: hashes, node: process.version, providerMountedByProfile: true, directHttpInference: false,
    ...(study ? { studyDesign: study, primaryMetric: 'all-run coordination cost (including failures)', causalClaim: false } : {}) }, null, 2) + '\n')
  const completed: Array<Awaited<ReturnType<typeof runShiftingEvidence>> & { directory: string }> = []
  for (const model of selected) for (let repeat = 0; repeat < repeats; repeat++) for (const mode of modes) {
    const directory = join(root, `${model.id}-${mode}-seed-${common.seed + repeat * 14}`)
    let traceWrites = Promise.resolve()
    const prepared = await source.prepareCall({ provider: PROVIDER_ID, model: model.id, maxTokens: common.maxOutputTokens })
    const adapter = new ImportedProfileAdapter(source, prepared.retryPolicy, event => {
      traceWrites = traceWrites.then(() => appendFile(join(directory, 'imported-provider-calls.jsonl'), JSON.stringify(event) + '\n'))
    }, sourceIdentity)
    const mount: ShiftingLiveProviderMount = {
      provenance: { provider: PROVIDER_ID, plugin: 'dsh-opencode-go', profile: options.profile ?? 'desktop-import-validation',
        sourceProfile: options.sourceProfile ?? 'desktop', modelImport: 'dsh-desktop-profile-llm', mount: 'dsh-profile-import' },
      async liveProviderMount(ctx) { ctx.llm.registerAdapter([PROVIDER_ID], adapter) },
    }
    const report = await runShiftingEvidence({ ...conditions, seed: common.seed + repeat * 14, model, mode,
      directory, purpose: options.purpose }, undefined, mount)
    await traceWrites
    completed.push({ ...report, directory })
    await writeFile(join(root, 'batch.json'), JSON.stringify({ purpose: options.purpose, completed,
      planned: selected.length * repeats * modes.length,
      summaries: selected.map(model => ({ model: model.id, ...(options.purpose === 'adaptive-probe'
        ? summarizeAdaptiveProbe(completed.filter(row => row.model === model.id))
        : study ? summarizeSimplificationRuns(completed.filter(row => row.model === model.id), study)
          : summarizeShiftingRuns(completed.filter(row => row.model === model.id), prior.filter(row => row.model === model.id))) })),
      causalClaim: false }, null, 2) + '\n')
    console.log('DSH_IMPORTED_ATN_RUN ' + JSON.stringify({ model: model.id, mode, seed: report.seed, passed: report.passed,
      steps: report.protocol.stepHeadroom, rewires: report.protocol.rewireTelemetry.successfulRewires,
      feedback: report.protocol.requesterFeedback, stopReason: report.stopReason, directory }))
  }
  return { completed: completed.length, planned: selected.length * repeats * modes.length, directory: root }
}
