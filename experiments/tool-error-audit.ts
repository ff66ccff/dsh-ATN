/** Reconcile preserved provider finish failures separately from tool execution failures. No inference calls. */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'experiments/results/full-feedback-20261005.json'
const OUTPUT = 'experiments/results/tool-error-audit-20261005.json'
const NUL_FIXTURE = 'tests/fixtures/tool-error-nul.json'
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const portable = (path: string) => path.replaceAll('\\', '/')

interface Run {
  runId: string; directory: string; model: string; mode: string
  failures: { code: string; status: number | null }[]
  modelMetrics: { toolErrors: number }
}
interface ToolCall { callId: string; name: string; arguments: string }
interface Block { type: string; text?: string; id?: string; name?: string; arguments?: string }
interface ToolSchema { name: string; parameters: Record<string, unknown> }
interface StreamItem {
  type: string; name?: string; id?: string; args?: string[]
  chunk?: { type: string; reason?: { kind: string; failure?: { code: string; message: string; status?: number } } }
}
interface LogEvent {
  type: string; seq: number; time: number
  data: {
    header?: { tools: ToolSchema[] }
    callId?: string; name?: string; arguments?: string
    message?: { toolCallId?: string; isError?: boolean; content: Block[] }
    error?: { code?: string; name?: string }
    stream?: StreamItem[]
  }
}
interface SourcePointer { file: string; sha256: string; line: number; seq: number }
interface BaseError { id: string; runId: string; model: string; mode: string; batch: string; source: SourcePointer }
interface FinishError extends BaseError { errorCode: string; status: number | null; message: string; category: string }
interface ToolError extends BaseError { errorCode: string | null; toolName: string; message: string; category: string }

/** Unknown codes must stop an audit; silently labelling everything 'other' hides new failures. */
export function classifyFinishError(code: string): string {
  switch (code) {
    case 'TRANSPORT': return 'transport-or-incomplete-stream'
    case 'RATE_LIMIT': return 'provider-http-429'
    case 'SERVER': return 'provider-http-500'
    case 'EMPTY_RESPONSE': return 'completed-empty-model-response'
    default: throw new Error(`Unclassified finish error: ${code}`)
  }
}

export function classifyToolError(row: { errorCode: string | null; toolName: string; message: string }): string {
  const { message, errorCode, toolName } = row
  if (errorCode === 'UNKNOWN_TOOL' && toolName.includes('\0')) return 'incoming-tool-name-contains-nul'
  if (errorCode === 'INVALID_ARGS' && message.includes('missing required property')) return 'missing-advertised-required-argument'
  if (errorCode === 'ABORTED') return 'cancelled-tool-call'
  if (message.includes('"expectedRevision"') && message.includes('received undefined')) return 'missing-board-write-revision'
  if (message.startsWith('Error: [')) {
    const issues = JSON.parse(message.slice('Error: '.length)) as { code: string; path: string[] }[]
    if (issues.every(issue => ['too_big', 'too_small'].includes(issue.code))) return 'argument-bound-violation'
  }
  if (message.includes('disabled by') && message.includes('ablation')) return 'ablation-guard'
  if (message.includes('not in your collaboration neighbours')) return 'directed-neighbour-guard'
  if (message.includes('only author ') && message.includes('update or remove')) return 'board-author-guard'
  if (message.includes('whiteboard or query changed')) return 'stale-board-cursor'
  if (message.includes('does not hold task') || message.includes('Rewire evidence must come from tasks requested by')) return 'task-ownership-guard'
  if (message.includes('may choose at most')) return 'peer-limit-guard'
  if (message.includes('not part of network') || message.includes('unknown task ')) return 'unknown-task-reference'
  if (message.includes('Only entry may submit')) return 'checkpoint-entry-guard'
  if (message.includes('One checkpoint per current phase')) return 'checkpoint-phase-guard'
  if (message.includes('Discovery accepts only')) return 'experiment-discovery-boundary'
  if (message.includes('Task contents are visible only')) return 'experiment-task-visibility-boundary'
  if (message.includes('must be active and published') || message.includes('is retired and cannot take new tasks')) return 'peer-lifecycle-guard'
  if (message.includes('has no completed holder submission to review')) return 'review-before-submission'
  throw new Error(`Unclassified tool error: ${errorCode ?? 'no-code'} ${message}`)
}

async function sessionFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await sessionFiles(file))
    else if (entry.name === 'session.v4.jsonl') result.push(file)
  }
  return result.sort()
}

function counts(rows: { errorCode: string | null }[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows) result[row.errorCode ?? 'NO_ERROR_CODE'] = (result[row.errorCode ?? 'NO_ERROR_CODE'] ?? 0) + 1
  return result
}
function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
}

/** Requires the original .artifacts archive. The resulting portable census is checked in for CI. */
export async function auditHistoricalErrors(root = ROOT) {
  const sourceText = await readFile(join(root, SOURCE), 'utf8')
  const manifest = JSON.parse(sourceText) as { batches: { directory: string; runs: Run[] }[] }
  const finishErrors: FinishError[] = [], toolErrors: ToolError[] = []
  let requestHeadersAudited = 0, invalidAdvertisedNames = 0
  const runs: { runId: string; directory: string; finishErrors: number; toolErrors: number; finishCountMatchesReport: boolean; toolCountMatchesReport: boolean }[] = []
  const nulEvidence: {
    source: SourcePointer; requestHeaderSource: SourcePointer; streamName: string; dispatchedName: string
    requestSchemaHasNul: boolean; advertisedToolNames: string[]; errorCode: string | null
    textAlsoContainsNul: boolean
  }[] = []
  for (const batch of manifest.batches) for (const run of batch.runs) {
    const finishStart = finishErrors.length, toolStart = toolErrors.length
    for (const file of await sessionFiles(join(root, run.directory, 'sessions'))) {
      const contents = await readFile(file, 'utf8')
      const fileHash = sha256(contents)
      const calls = new Map<string, ToolCall>()
      const streamCalls = new Map<string, { item: StreamItem; textAlsoContainsNul: boolean }>()
      let advertisedTools: ToolSchema[] = [], headerSource: SourcePointer | undefined
      for (const [index, line] of contents.trimEnd().split(/\r?\n/).entries()) {
        const event = JSON.parse(line) as LogEvent
        const source = { file: portable(relative(root, file)), sha256: fileHash, line: index + 1, seq: event.seq }
        const base = { id: `${run.runId}:${source.file.split('/').at(-2)}:${event.seq}`, runId: run.runId,
          model: run.model, mode: run.mode, batch: batch.directory, source }
        if (event.type === 'request/header') {
          advertisedTools = event.data.header!.tools; headerSource = source
          requestHeadersAudited++
          invalidAdvertisedNames += advertisedTools.filter(tool => !/^[a-z][a-z0-9_]*$/.test(tool.name)).length
        }
        if (event.type.startsWith('assistant/')) {
          for (const [streamIndex, item] of (event.data.stream ?? []).entries()) {
            const chunk = item.chunk
            if (chunk?.type === 'finish' && chunk.reason?.kind === 'error') {
              const failure = chunk.reason.failure!
              finishErrors.push({ ...base, id: `${base.id}:${streamIndex}`, errorCode: failure.code,
                status: failure.status ?? null, message: failure.message, category: classifyFinishError(failure.code) })
            }
            if (item.type === 'tool-call-chunks' && item.id) streamCalls.set(item.id, { item,
              textAlsoContainsNul: (event.data.message?.content ?? []).some(block => block.type === 'text' && block.text?.includes('\0')) })
          }
        }
        if (event.type === 'tool/call') calls.set(event.data.callId!, event.data as ToolCall)
        if (event.type === 'tool/result' && event.data.message?.isError) {
          const callId = event.data.message.toolCallId!
          const call = calls.get(callId)
          if (!call) throw new Error(`Missing original tool call at ${source.file}:${source.line}`)
          const errorCode = event.data.error?.code ?? null
          const message = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
          const row = { ...base, errorCode, toolName: call.name, message }
          toolErrors.push({ ...row, category: classifyToolError(row) })
          if (call.name.includes('\0')) {
            const stream = streamCalls.get(callId)
            if (!stream || !headerSource) throw new Error('NUL attribution requires the actual request header and incoming stream')
            nulEvidence.push({ source, requestHeaderSource: headerSource, streamName: stream.item.name!, dispatchedName: call.name,
              requestSchemaHasNul: JSON.stringify(advertisedTools).includes('\\u0000'), advertisedToolNames: advertisedTools.map(tool => tool.name),
              errorCode, textAlsoContainsNul: stream.textAlsoContainsNul })
          }
        }
      }
    }
    const finishCountMatchesReport = sameCounts(counts(finishErrors.slice(finishStart)), counts(run.failures.map(row => ({ errorCode: row.code }))))
    const toolCountMatchesReport = toolErrors.length - toolStart === run.modelMetrics.toolErrors
    if (!finishCountMatchesReport || !toolCountMatchesReport) throw new Error(`Archive/report failure census mismatch for ${run.directory}`)
    runs.push({ runId: run.runId, directory: run.directory, finishErrors: finishErrors.length - finishStart,
      toolErrors: toolErrors.length - toolStart, finishCountMatchesReport, toolCountMatchesReport })
  }
  const toolCategoryCounts: Record<string, number> = {}
  for (const row of toolErrors) toolCategoryCounts[row.category] = (toolCategoryCounts[row.category] ?? 0) + 1
  return {
    version: 1, source: { file: SOURCE, sha256: sha256(sourceText) },
    scope: 'All 24 preserved runs. Finish errors and tool execution errors are distinct censuses; turn/end errors are not counted again.',
    rawProviderHttpCaptured: false, providerVsAdapterAttribution: 'unresolved upstream of the Harness stream boundary',
    atnRegistrationCausedNul: false, requestHeadersAudited, invalidAdvertisedNames,
    finishCounts: counts(finishErrors), toolCategoryCounts,
    unclassified: 0, runs, finishErrors, toolErrors, nulEvidence,
  }
}

async function writeNulFixture(root: string, audit: Awaited<ReturnType<typeof auditHistoricalErrors>>): Promise<void> {
  const first = audit.nulEvidence[0]!
  const contents = await readFile(join(root, first.source.file), 'utf8')
  const events = contents.trimEnd().split(/\r?\n/).map(line => JSON.parse(line) as LogEvent)
  const header = events.find(event => event.seq === first.requestHeaderSource.seq)!
  const incidents = audit.nulEvidence.map(evidence => {
    const result = events.find(event => event.seq === evidence.source.seq)!
    const callId = result.data.message!.toolCallId!
    const call = events.find(event => event.type === 'tool/call' && event.data.callId === callId)!
    const assistant = events.find(event => event.data?.stream?.some(item => item.type === 'tool-call-chunks' && item.id === callId))!
    const stream = assistant.data.stream!.find(item => item.type === 'tool-call-chunks' && item.id === callId)!
    return { source: evidence.source, assistantSeq: assistant.seq, stream, call: call.data,
      result: { error: result.data.error, message: result.data.message!.content } }
  })
  await writeFile(join(root, NUL_FIXTURE), JSON.stringify({ version: 1, source: first.source,
    requestHeaderSource: first.requestHeaderSource, advertisedTools: header.data.header!.tools,
    textAlsoContainsNul: audit.nulEvidence.some(row => row.textAlsoContainsNul), incidents }, null, 2) + '\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const audit = await auditHistoricalErrors()
  await writeFile(join(ROOT, OUTPUT), JSON.stringify(audit, null, 2) + '\n')
  await writeNulFixture(ROOT, audit)
  console.log(JSON.stringify({ output: OUTPUT, runs: audit.runs.length, finishErrors: audit.finishErrors.length,
    finishCounts: audit.finishCounts, toolErrors: audit.toolErrors.length, toolCategoryCounts: audit.toolCategoryCounts,
    nulIncidents: audit.nulEvidence.length, unclassified: audit.unclassified }, null, 2))
}
