import { strict as assert } from 'node:assert'
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join, relative, dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { classifyToolError } from '../experiments/tool-error-audit.ts'

const root = resolve('.')
const { values } = parseArgs({ options: {
  directory: { type: 'string', default: '.artifacts/experiments/measurability-live-fixed-20261005-v2' },
  out: { type: 'string', default: '.artifacts/measurability/live-tool-error-audit.json' },
} })
const directory = values.directory
const hash = text => createHash('sha256').update(text).digest('hex')
const portable = file => relative(root, file).replaceAll('\\', '/')
const batchText = await readFile(join(directory, 'batch.json'), 'utf8')
const batch = JSON.parse(batchText)
assert.equal(batch.completed.length, 5)
async function files(dir) {
  const all = []
  for (const row of await readdir(dir, { withFileTypes: true })) {
    if (row.isDirectory()) all.push(...await files(join(dir, row.name)))
    else if (row.name === 'session.v4.jsonl') all.push(join(dir, row.name))
  }
  return all.sort()
}
function classify(row) {
  try { return classifyToolError(row) } catch (error) {
    const { message } = row
    if (row.errorCode === 'UNKNOWN_TOOL' && /<body>|<invoke|<\/invoke>/.test(row.toolName)) return 'incoming-tool-name-contains-markup'
    if (message.includes('Board discovery accepts only')) return 'experiment-board-discovery-boundary'
    if (message.includes('invalid whiteboard read cursor')) return 'malformed-board-cursor'
    if (/expected revision \d+ but current revision is \d+; reread before retrying/.test(message)) return 'stale-board-write-revision'
    if (row.errorCode === 'INVALID_ARGS' && message.includes('must be')) return 'malformed-argument-type-or-enum'
    if (message.startsWith('Error: [')) {
      const issues = JSON.parse(message.slice(7))
      if (issues.some(issue => issue.path[0] === 'key' && issue.message.includes('received undefined'))) return 'missing-board-key'
      if (issues.every(issue => ['unrecognized_keys', 'invalid_format'].includes(issue.code))) return 'invalid-board-argument-shape'
    }
    if (message.includes('Evidence access denied or stale phase')) return 'experiment-evidence-access-boundary'
    if (/already holds \d+ resident nodes/.test(message)) return 'network-node-capacity'
    throw error
  }
}
const errors = [], finishErrors = [], runs = [], nulEvidence = [], malformedNameEvidence = []
const statusCalls = [], boardCalls = [], registryChecks = []
for (const report of batch.completed) {
  const start = errors.length, finishStart = finishErrors.length, statusStart = statusCalls.length, boardStart = boardCalls.length
  const reportFile = join(report.directory, 'report.json')
  const reportText = await readFile(reportFile, 'utf8')
  for (const file of await files(join(report.directory, 'sessions'))) {
    const text = await readFile(file, 'utf8'), sha256 = hash(text)
    const calls = new Map(), streamCalls = new Map()
    let schema = [], headerSource = null, lastReadHints = null
    const lines = text.trimEnd().split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      const event = JSON.parse(line)
      const source = { file: portable(file), sha256, line: index + 1, seq: event.seq }
      if (event.type === 'request/header') {
        schema = event.data.header.tools; headerSource = source
        const names = schema.map(tool => tool.name)
        registryChecks.push({ seed: report.seed, source, names,
          invalidNames: names.filter(name => !/^[a-z][a-z0-9_]*$/.test(name)),
          duplicateNames: names.filter((name, i) => names.indexOf(name) !== i) })
      }
      for (const item of event.data?.stream ?? []) {
        if (item.type === 'tool-call-chunks') streamCalls.set(item.id, { name: item.name, source })
        if (item.chunk?.type === 'finish' && item.chunk.reason.kind === 'error') finishErrors.push({ seed: report.seed, source, ...item.chunk.reason.failure })
      }
      if (event.type === 'tool/call') {
        const call = { ...event.data, source, args: JSON.parse(event.data.arguments), result: null }
        calls.set(call.callId, call)
        if (call.name === 'atn_status') statusCalls.push({ seed: report.seed, ...call })
        if (call.name === 'atn_board') boardCalls.push({ seed: report.seed, ...call })
      }
      if (event.type === 'tool/result') {
        const callId = event.data.message.toolCallId, call = calls.get(callId)
        assert.ok(call, 'every result has its original call')
        const message = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
        const result = { isError: event.data.message.isError === true, source, errorCode: event.data.error?.code ?? null }
        call.result = result
        const saved = [...statusCalls, ...boardCalls].find(row => row.callId === callId)
        if (saved) saved.result = result
        if (call.name === 'read_evidence' && !result.isError) {
          try { lastReadHints = { source, ...JSON.parse(message) } } catch { /* Only JSON evidence responses have metadata. */ }
        }
        if (!result.isError) continue
        const base = { seed: report.seed, runId: report.runId, source, callSource: call.source,
          errorCode: result.errorCode, toolName: call.name, message }
        const category = classify(base)
        const nameContainsMarkup = category === 'incoming-tool-name-contains-markup'
        // A malformed name may contain an entire attempted message; keep only
        // hashes and the original event location rather than copying that body.
        const safeBase = nameContainsMarkup ? { ...base,
          toolName: `${call.name.split('<', 1)[0]}<…>`,
          toolNameSha256: hash(call.name), toolNameBytes: Buffer.byteLength(call.name),
          message: 'Unknown tool name contains embedded markup; full original retained at source.',
          messageSha256: hash(message), messageBytes: Buffer.byteLength(message) } : base
        const args = call.args
        const comparison = lastReadHints?.discoveryHints
        errors.push({ ...safeBase, category, argumentKeys: Object.keys(args), argumentsSha256: hash(call.arguments),
          ...(call.name === 'atn_board' ? { board: { action: args.action ?? null, key: args.key ?? null,
            documents: args.documents ?? null, topics: args.topics ?? null, expectedRevision: args.expectedRevision ?? null,
            lastReadHints: comparison ? { source: lastReadHints.source, phase: lastReadHints.phase, ...comparison } : null,
            documentsOutsideLastReadHints: comparison && Array.isArray(args.documents) ? args.documents.filter(value => !comparison.documents.includes(value)) : null,
            topicsOutsideLastReadHints: comparison && Array.isArray(args.topics) ? args.topics.filter(value => !comparison.topics.includes(value)) : null } } : {}),
          ...(call.name === 'atn_status' ? { statusArguments: args } : {}) })
        if (call.name.includes('\0')) {
          const stream = streamCalls.get(callId)
          assert.equal(stream?.name, call.name)
          assert.ok(schema.every(tool => !tool.name.includes('\0')))
          nulEvidence.push({ seed: report.seed, name: call.name, incomingStream: stream, dispatchedCall: call.source,
            errorSource: source, requestHeaderSource: headerSource, advertisedNames: schema.map(tool => tool.name),
            conclusion: 'Malformed name already present at the incoming stream boundary; raw HTTP is not recorded.' })
        }
        if (nameContainsMarkup) {
          const stream = streamCalls.get(callId)
          assert.equal(stream?.name, call.name)
          assert.ok(schema.every(tool => /^[a-z][a-z0-9_]*$/.test(tool.name)))
          malformedNameEvidence.push({ seed: report.seed, category, toolName: safeBase.toolName,
            toolNameSha256: safeBase.toolNameSha256, toolNameBytes: safeBase.toolNameBytes,
            incomingStreamSource: stream.source, dispatchedCall: call.source, errorSource: source,
            requestHeaderSource: headerSource, advertisedNames: schema.map(tool => tool.name),
            conclusion: 'Markup-containing name already present at the incoming stream boundary; raw HTTP is not recorded. Name and error body are omitted and retained only by hashes and source locations.' })
        }
      }
    }
  }
  const runErrors = errors.slice(start), runFinish = finishErrors.slice(finishStart)
  assert.equal(runErrors.length, report.metrics.totals.toolErrors)
  assert.equal(runFinish.length, report.failures.length)
  const statuses = statusCalls.slice(statusStart), boards = boardCalls.slice(boardStart)
  assert.ok(statuses.every(call => call.result !== null))
  runs.push({ seed: report.seed, runId: report.runId, directory: portable(report.directory),
    report: { file: portable(reportFile), sha256: hash(reportText) }, sourceHashes: report.sourceHashes, conditions: report.conditions,
    phase1Submitted: report.phase1Submitted, phase1Correct: report.phase1Correct, phase2Submitted: report.phase2Submitted,
    phase2Correct: report.phase2Correct, stopReason: report.stopReason,
    toolErrors: runErrors.length, reportedToolErrors: report.metrics.totals.toolErrors, finishErrors: runFinish.length,
    status: { calls: statuses.length, errors: statuses.filter(call => call.result.isError).length,
      reviews: statuses.filter(call => call.args.review).length, reviewErrors: statuses.filter(call => call.args.review && call.result.isError).length,
      rewires: statuses.filter(call => call.args.rewire).length, rewireErrors: statuses.filter(call => call.args.rewire && call.result.isError).length },
    board: { calls: boards.length, publishCalls: boards.filter(call => call.args.action === 'publish').length,
      publishCallsMissingRevision: boards.filter(call => call.args.action === 'publish' && call.args.expectedRevision === undefined).length,
      missingRevisionErrors: runErrors.filter(row => row.category === 'missing-board-write-revision').length,
      staleRevisionErrors: runErrors.filter(row => row.category === 'stale-board-write-revision').length,
      revisionErrors: runErrors.filter(row => ['missing-board-write-revision', 'stale-board-write-revision'].includes(row.category)).length } })
}
const categoryCounts = {}, finishCounts = {}
for (const error of errors) categoryCounts[error.category] = (categoryCounts[error.category] ?? 0) + 1
for (const error of finishErrors) finishCounts[error.code] = (finishCounts[error.code] ?? 0) + 1
assert.equal(errors.length, batch.completed.reduce((sum, report) => sum + report.metrics.totals.toolErrors, 0))
assert.ok(registryChecks.every(row => row.invalidNames.length === 0 && row.duplicateNames.length === 0))
assert.equal(new Set(batch.completed.map(report => report.model)).size, 1)
assert.ok(batch.completed.every(report => report.mode === 'fixed'))
const output = { version: 1, model: batch.completed[0].model, mode: 'fixed', directory,
  batch: { file: `${directory}/batch.json`, sha256: hash(batchText) }, runs,
  totalToolErrors: errors.length, categoryCounts, totalFinishErrors: finishErrors.length, finishCounts, unclassified: 0,
  registryChecks, nulEvidence, malformedNameEvidence, errors, finishErrors, causalClaim: false,
  limitations: [
    'Categories describe observed failures, not a causal allocation of final task failure or token cost.',
    'Board metadata rejections are experiment access guards; latest local read hints may be stale after a global phase transition.',
    'No raw provider HTTP was captured, so NUL attribution stops at the incoming Harness stream boundary.',
    'A zero observed revision error count is not proof that stronger descriptions alone caused a reduction.',
  ] }
await mkdir(dirname(values.out), { recursive: true })
await writeFile(values.out, JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ runs: runs.map(({ sourceHashes, ...run }) => run), totalToolErrors: errors.length, categoryCounts, totalFinishErrors: finishErrors.length, finishCounts,
  requestHeaders: registryChecks.length, invalidRegisteredNames: 0, nulIncidents: nulEvidence.map(row => ({ seed: row.seed, name: row.name })) }, null, 2))
