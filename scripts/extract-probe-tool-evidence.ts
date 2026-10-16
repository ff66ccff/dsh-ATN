/** Offline, one-time projection of existing persisted sessions. Never executes tools. */
import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const sourceRoot = process.argv[2] ?? '.artifacts/live-probe-resumed/20261015/batch'
const output = 'docs/execution-evidence/probe-gate-quiescence-20261015/tool-identities.json'
const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex')
const seeds = []
for (const seed of [17, 31, 45, 59, 73]) {
  const eventFile = `docs/execution-evidence/live-probe-resumed-20261015/seed-${seed}-events.jsonl`
  const eventRaw = await readFile(eventFile, 'utf8')
  const events = eventRaw.trim().split('\n').map(line => JSON.parse(line))
  const directory = join(sourceRoot, `seed-${seed}`, 'sessions')
  const files = (await readdir(directory, { recursive: true })).filter(file => file.endsWith('session.v4.jsonl')).sort()
  const calls = [], sources = []
  for (const file of files) {
    const path = join(directory, file).replaceAll('\\', '/')
    const raw = await readFile(path, 'utf8')
    const rows = raw.trim().split('\n').map(line => JSON.parse(line))
    const firstTurn = rows.find(row => row.type === 'turn/start')
    const sessionMatches = events.filter(event => event.kind === 'turn/start' && event.at === firstTurn.time && event.turn === firstTurn.data.turn)
    assert.equal(sessionMatches.length, 1, 'Ambiguous session alias; do not guess')
    const session = sessionMatches[0].session
    sources.push({ path, sha256: sha256(raw), session, firstTurnSourceSeq: firstTurn.seq, firstTurnEventSequence: sessionMatches[0].sequence })
    for (const row of rows.filter(row => row.type === 'tool/call')) {
      const matches = events.filter(event => event.kind === 'tool.start' && event.session === session
        && event.at === row.time && event.turn === row.data.turn && event.step === row.data.step)
      assert.equal(matches.length, 1, 'Ambiguous tool correlation; do not guess')
      const event = matches[0]
      const args = JSON.parse(row.data.arguments)
      const name: string = row.data.name
      const category = name === 'atn_status' ? (args.rewire !== undefined ? 'rewire'
        : args.review !== undefined || args.claimTaskId !== undefined ? 'protocol' : 'discovery')
        : ['atn_spawn', 'atn_send', 'atn_finish', 'submit_checkpoint'].includes(name) ? 'protocol' : 'other'
      calls.push({ eventSequence: event.sequence, session, tool: event.tool, name, turn: event.turn, step: event.step,
        at: row.time, source: path, sourceSeq: row.seq, argumentKeys: Object.keys(args).sort(), category })
    }
  }
  assert.equal(calls.length, events.filter(event => event.kind === 'tool.start').length)
  seeds.push({ seed, eventFile, eventSha256: sha256(eventRaw), sources, calls: calls.sort((a, b) => a.eventSequence - b.eventSequence) })
}
await writeFile(output, JSON.stringify({ execution: 'offline-zero-model', method: 'Join first turn by exact time/turn; join tool/call to tool.start by session/time/turn/step. Unique matches required. Names and argument key names only; no argument values, prompts or responses.', seeds }, null, 2) + '\n')
console.log(JSON.stringify({ output, seeds: seeds.map(row => ({ seed: row.seed, calls: row.calls.length, sessions: row.sources.length })) }))
