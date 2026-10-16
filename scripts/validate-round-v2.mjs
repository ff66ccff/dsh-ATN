/** Sequential, fail-fast phase gates. Runs only the repository's scripted providers. */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const directory = process.argv[2]
if (!/^docs\/execution-evidence\/round-v2-(phase[0-5]|final)$/.test(directory ?? '')) throw new Error('Expected a round-v2 evidence directory')
await mkdir(directory, { recursive: true })
const env = { ...process.env,
 DSH_CLI: resolve('.scratch/harness-alpha4/node_modules/.bin/dsh.cmd'),
 SIDEBAR_PACKAGE_DIR: resolve('.scratch/sidebar-0261/node_modules/dsh-better-sidebar'),
}
const results = []
for (const command of ['npm ci', 'npm run typecheck', 'npm test', 'npm run build', 'npm run pack:tarball', 'npm run smoke:profile', 'npm run smoke:visualization', 'npm run verify:sidebar', 'git diff --check']) {
 console.log(`GATE START ${command}`)
 const startedAt = new Date().toISOString()
 const result = await new Promise((done, reject) => {
  const child = spawn(command, { env, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  child.on('error', reject)
  child.on('close', code => done({ command, code, startedAt, finishedAt: new Date().toISOString(), output }))
 })
 const name = command.replaceAll(/[^a-z0-9]+/g, '-') + '.txt'
 await writeFile(`${directory}/${name}`, result.output)
 const { output, ...summary } = result
 results.push({ ...summary, file: name })
 await writeFile(`${directory}/gates.json`, JSON.stringify({ DSH_CLI: env.DSH_CLI, SIDEBAR_PACKAGE_DIR: env.SIDEBAR_PACKAGE_DIR, results }, null, 2) + '\n')
 console.log(`GATE END ${command}: ${result.code}`)
 if (result.code !== 0) { console.error(output.slice(-8000)); process.exitCode = 1; break }
}
