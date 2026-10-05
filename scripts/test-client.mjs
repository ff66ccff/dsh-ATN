/** Bundle focused UI interaction tests with shared primitives isolated as fixtures. */
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = fileURLToPath(new URL('../.artifacts/tests-client/observer-ui.test.mjs', import.meta.url))
await mkdir(new URL('../.artifacts/tests-client/', import.meta.url), { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['tests/client/observer-ui.test.tsx'],
  outfile: output,
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  sourcemap: 'inline',
  tsconfig: 'tsconfig.client.json',
  alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('../tests/client/modal-fixture.tsx', import.meta.url)) },
})
const child = spawn(process.execPath, ['--test', output], { cwd: root, stdio: 'inherit' })
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
