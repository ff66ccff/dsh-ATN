/** Repeat the two unchanged historical flaky files, preserving every output. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs'
const directory = 'docs/execution-evidence/probe-liveness-audit-v2-20261015'
mkdirSync(directory, { recursive: true })
const repetitions = Number(process.argv[2] ?? 10)
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) throw new Error('Expected 1..100 repetitions')
const files = ['tests/integration/result-outcome.test.ts', 'tests/integration/knowledge-feedback.test.ts']
const results = []
for (const file of files) {
  const runs = []
  for (let attempt = 1; attempt <= repetitions; attempt++) {
    const log = `${directory}/${file.split('/').at(-1)}.repeat-${attempt}.log`
    const fd = openSync(log, 'w')
    const startedAt = Date.now()
    const child = spawnSync(process.execPath, ['--import', 'tsx/esm', '--test', file], { stdio: ['ignore', fd, fd], timeout: 60000 })
    closeSync(fd)
    runs.push({ attempt, exitCode: child.status, signal: child.signal, errorCode: child.error?.code ?? null, elapsedMs: Date.now() - startedAt, log })
  }
  results.push({ file, command: `node --import tsx/esm --test ${file}`, repetitions,
    failures: runs.filter(run => run.exitCode !== 0).length, runs })
}
writeFileSync(`${directory}/flaky-reproduction.json`, JSON.stringify({ execution: 'offline-scripted-tests', node: process.version,
  repeatCommand: `node scripts/reproduce-probe-flakes-v2.mjs ${repetitions}`, results }, null, 2) + '\n')
console.log(JSON.stringify(results.map(({ file, repetitions, failures }) => ({ file, repetitions, failures })), null, 2))
