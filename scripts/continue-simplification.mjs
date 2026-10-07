/** Resume the registered schedule after a carrier exception, without replaying any attempted sample.
 * Reuses the frozen runner and the same imported provider adapter; never handles credentials. */
import { readFile, writeFile, appendFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { PROVIDER_ID } from 'dsh-opencode-go'
import { discoverPilotModels } from '../experiments/provider.ts'
import { ImportedProfileAdapter, selectImportedValidationModels } from '../experiments/shifting-evidence-profile-run.ts'
import { runShiftingEvidence, shiftingSourceHashes } from '../experiments/shifting-evidence-run.ts'
import { assertSimplificationDesign, registeredSimplificationArms, summarizeSimplificationRuns } from '../experiments/simplification-protocol.ts'

export async function retainInterruptedInitialization(root) {
  const design = JSON.parse(await readFile(join(root, 'design.json'), 'utf8'))
  const plan = JSON.parse(await readFile(join(root, 'runs', 'plan.json'), 'utf8'))
  assertSimplificationDesign(design)
  const reference = JSON.parse(await readFile(join(root, 'reference.json'), 'utf8'))
  const mode = 'adaptive', seed = design.seeds[0]
  const directory = join(root, 'runs', `${design.model}-${mode}-seed-${seed}`)
  const events = (await readFile(join(directory, 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  const start = events.find(row => row.kind === 'experiment.start')
  if (!start || !isDeepStrictEqual(plan.sourceHashes, design.sourceHashes) || !isDeepStrictEqual(plan.conditions, { ...design.conditions, seed })) {
    throw new Error('Interrupted initialization differs from the registered sample')
  }
  // Missing end-of-run telemetry is unknown, even when no model.start was persisted.
  const report = { runId: start.runId, startedAt: start.at, completedAt: Date.now(), mode, seed, model: design.model,
    conditions: { ...design.conditions, seed }, sourceHashes: design.sourceHashes, execution: 'live-provider', purpose: 'comparison',
    hostInitializationFailure: true, passed: false, phase1Submitted: false, phase2Submitted: false, phase1Correct: false, phase2Correct: false,
    solvingFailure: false, submissionDisciplineFailure: false, stopReason: 'host-carrier-interrupted-initialization', cleanup: 'interrupted',
    issuedModelCalls: null, entrySteps: null, atnTotalInteractions: null, atnTotalTransferBytes: null,
    meanInputTokensPerCall: null, relativeInteractions: null, relativeTransferBytes: null, metrics: null, protocol: null,
    mechanisms: { requesterFeedback: true, sharedBoard: true }, reference: reference.rows.find(row => row.mode === mode && row.seed === seed).reference,
    factFlowAudit: { version: 1, passed: true, submittedCheckpoints: 0, auditedFacts: 0, facts: [], violations: [], noSubmission: true,
      interpretation: 'No surviving submitted checkpoint. Host interruption is retained as failure; no completion or mechanism effect is inferred.' },
    failures: [{ code: 'HOST_CARRIER_INTERRUPTED', status: null }],
    interruptionEvidence: { persistedEvents: events.length, persistedModelStarts: events.filter(row => row.kind === 'model.start').length,
      eventsSha256: createHash('sha256').update(await readFile(join(directory, 'events.jsonl'))).digest('hex'),
      finalTelemetryMissing: true, rerun: false },
    rawAudit: { passed: false, checks: { completeRawSession: false }, routeSignatures: [], toolSchemaSignatures: [], permissionSignatures: [],
      interpretation: 'Full raw identity/cost audit is unavailable after the carrier interruption. Keep uncertainty and forbid removal recommendations.' } }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  await writeFile(join(root, 'retained-interruption.json'), JSON.stringify({ directory, report }, null, 2) + '\n', { flag: 'wx' })
  return report
}

export async function runImportedProfileValidation(parent, options, sourceIdentity) {
  const root = dirname(resolve(options.studyDesign)), design = JSON.parse(await readFile(resolve(options.studyDesign), 'utf8'))
  assertSimplificationDesign(design)
  const reference = JSON.parse(await readFile(join(root, 'reference.json'), 'utf8'))
  const criterion = JSON.parse(await readFile(join(root, 'criterion-validation.json'), 'utf8'))
  const modes = registeredSimplificationArms(design), hashes = await shiftingSourceHashes()
  const { seed: firstSeed, repeats, directory, models, modes: selectedModes, purpose, profile, sourceProfile, studyDesign, ...conditions } = options
  if (!reference.passed || !isDeepStrictEqual(reference.seeds, design.seeds) || reference.issuedModelCalls !== 0 ||
    !criterion.passed || criterion.issuedModelCalls !== 0 || !isDeepStrictEqual(hashes, design.sourceHashes) ||
    !isDeepStrictEqual(conditions, design.conditions) || !isDeepStrictEqual(selectedModes, modes) ||
    repeats !== design.seeds.length || firstSeed !== design.seeds[0] || purpose !== 'comparison') throw new Error('Continuation must preserve the entire registered design')
  const source = parent.get('llm')
  if (!source?.listProviders().some(row => row.id === PROVIDER_ID) || !sourceIdentity?.isAgentLoopRequest) throw new Error('Actual imported profile is required')
  const imported = await source.listModels(PROVIDER_ID), catalog = await discoverPilotModels()
  const selected = selectImportedValidationModels(imported, catalog.models, models)
  if (selected.length !== 1 || selected[0].id !== design.model) throw new Error('The registered model is frozen')
  const model = selected[0], completed = []
  const retained = JSON.parse(await readFile(join(root, 'retained-interruption.json'), 'utf8'))
  const planned = design.seeds.length * modes.length, runRoot = resolve(directory)
  await mkdir(runRoot, { recursive: true })
  await writeFile(join(root, 'continuation-plan.json'), JSON.stringify({ createdAt: new Date().toISOString(), planned,
    retainedRunId: retained.report.runId, retainedFailures: 1, rerunInterruptedSample: false,
    remainingRuns: planned - 1, sourceHashes: hashes, model: model.id, conditions: design.conditions,
    adapter: 'same ImportedProfileAdapter as the frozen profile runner', causalClaim: false }, null, 2) + '\n', { flag: 'wx' })
  for (const seed of design.seeds) for (const mode of modes) {
    const runDirectory = join(runRoot, `${model.id}-${mode}-seed-${seed}`)
    let report
    if (runDirectory === retained.directory) report = retained.report
    else {
      // Existing attempted samples are never overwritten or replaced.
      if ((await readdir(runRoot)).includes(`${model.id}-${mode}-seed-${seed}`)) throw new Error('Refusing to replay an attempted sample')
      let writes = Promise.resolve()
      const prepared = await source.prepareCall({ provider: PROVIDER_ID, model: model.id, maxTokens: design.conditions.maxOutputTokens })
      const adapter = new ImportedProfileAdapter(source, prepared.retryPolicy, event => {
        writes = writes.then(() => appendFile(join(runDirectory, 'imported-provider-calls.jsonl'), JSON.stringify(event) + '\n'))
      }, sourceIdentity)
      const mount = { provenance: { provider: PROVIDER_ID, plugin: 'dsh-opencode-go', profile, sourceProfile,
        modelImport: 'dsh-desktop-profile-llm', mount: 'dsh-profile-import' },
        async liveProviderMount(ctx) { ctx.llm.registerAdapter([PROVIDER_ID], adapter) } }
      report = await runShiftingEvidence({ ...design.conditions, seed, model, mode, directory: runDirectory, purpose }, undefined, mount)
      await writes
    }
    completed.push({ ...report, directory: runDirectory })
    await writeFile(join(runRoot, 'batch.json'), JSON.stringify({ purpose, completed, planned,
      summaries: [{ model: model.id, ...summarizeSimplificationRuns(completed, design) }], causalClaim: false }, null, 2) + '\n')
    console.log('DSH_IMPORTED_ATN_RUN ' + JSON.stringify({ mode, seed, passed: report.passed, calls: report.issuedModelCalls,
      hostInitializationFailure: report.hostInitializationFailure ?? false, recorded: completed.length, planned }))
  }
  return { completed: completed.length, planned, directory: runRoot }
}
