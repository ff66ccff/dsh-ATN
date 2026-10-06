/** Audit existing revision-3 batches without rewriting their original observations. */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve } from 'node:path'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { auditFactFlow } from '../experiments/topology-binding-audit.ts'
import { createShiftingEvidenceTask } from '../experiments/shifting-evidence-task.ts'
const { values } = parseArgs({ options: { batches: { type: 'string' },
  out: { type: 'string', default: 'experiments/results/four-arm-historical-fact-flow-20261006.json' } } })
if (!values.batches) throw new Error('--batches is required (comma-separated batch directories)')
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const portable = path => relative(process.cwd(), resolve(path)).replaceAll('\\', '/')
const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) : value } catch { return null } }
async function walk(path) { return (await Promise.all((await readdir(path, { withFileTypes: true })).map(row =>
  row.isDirectory() ? walk(join(path, row.name)) : [join(path, row.name)]))).flat() }
const runs = []
for (const root of values.batches.split(',')) {
  const batchFile = join(resolve(root), 'batch.json'), batch = await json(batchFile)
  for (const observation of batch.completed) {
    const directory = resolve(observation.directory), reportFile = join(directory, 'report.json'), report = await json(reportFile)
    if (report.conditions.topologyBinding !== true) throw new Error('Only revision-3 topology-bound runs are supported')
    const task = createShiftingEvidenceTask(report.conditions.agents, report.seed, report.conditions.chainLength, true)
    const stored = await json(join(directory, 'storage/atn_networks.json'))
    const network = Object.values(stored.tables.networks).find(row => row?.entryNodeId)
    if (!network || report.runId !== observation.runId) throw new Error('Missing network or mismatched run identity')
    const audit = auditFactFlow(task, network, report.attempts), liveCalls = []
    for (const file of (await walk(join(directory, 'sessions'))).filter(file => file.endsWith('session.v4.jsonl'))) {
      const events = (await readFile(file, 'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
      const sessionId = events.find(row => row.type === 'session')?.id
      const nodeId = Object.values(network.nodes).find(row => row.sessionId === sessionId)?.id
      const calls = new Map()
      for (const event of events) {
        if (event.type === 'tool/call') {
          const call = { nodeId, name: event.data.name, args: parse(event.data.arguments), completed: false, isError: null }
          calls.set(event.data.callId, call); liveCalls.push(call)
        }
        if (event.type === 'tool/result') {
          const call = calls.get(event.data.message.toolCallId)
          if (call) { call.completed = true; call.isError = event.data.message.isError === true }
        }
      }
    }
    const liveOwnerDeliveries = audit.facts.every(witness => liveCalls.some(call => call.completed && call.isError === false &&
      call.name === 'atn_send' && call.nodeId === witness.ownerNodeId && call.args?.kind === 'result' &&
      call.args.taskId === witness.taskId && call.args.to === network.entryNodeId &&
      call.args.summary === network.tasks[witness.taskId].result.summary))
    const liveSubmissionsMatch = isDeepStrictEqual(report.attempts.map(row => ({ phase: row.phase, answer: row.answer })),
      liveCalls.filter(call => call.name === 'submit_checkpoint' && call.nodeId === network.entryNodeId && call.completed && call.isError === false)
        .map(call => ({ phase: call.args.phase, answer: call.args.answer })))
    runs.push({ runId: report.runId, seed: report.seed, mode: report.mode, model: report.model,
      report: { path: portable(reportFile), sha256: await hashFile(reportFile) }, originalSourceHashes: report.sourceHashes,
      factFlowAudit: audit, liveOwnerDeliveries, liveSubmissionsMatch, passed: audit.passed && liveOwnerDeliveries && liveSubmissionsMatch,
      originalCompletionPassed: report.passed, issuedModelCalls: report.issuedModelCalls, comparisonAdmission: false })
  }
}
const output = { version: 1, auditedAt: new Date().toISOString(), runs, allPassed: runs.length > 0 && runs.every(row => row.passed),
  issuedNewModelCalls: 0, interpretation: 'Historical provenance audit only. Original failures remain; old source identities cannot qualify a new comparison.' }
await mkdir(dirname(resolve(values.out)), { recursive: true })
await writeFile(resolve(values.out), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify({ out: portable(values.out), runs: runs.length, allPassed: output.allPassed,
  submittedFacts: runs.reduce((sum, row) => sum + row.factFlowAudit.auditedFacts, 0) }))
