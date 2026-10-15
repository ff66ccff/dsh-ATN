import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { VERIFIED_SIDEBAR_VERSION } from '../../../scripts/sidebar-compatibility.mjs'

const root = 'docs/execution-evidence/residual'
const directory = resolve('.scratch/residual-sidebar/node_modules/dsh-better-sidebar')
const env = { ...process.env, SIDEBAR_PACKAGE_DIR: directory }
const summary = []
async function runNpm(name, expectedCode, expectedText, absentText) {
  const result = spawnSync('npm run verify:sidebar', { shell: true, env, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  await writeFile(`${root}/${name}.txt`, `$ npm run verify:sidebar\n${output}\nEXIT_CODE=${result.status}\n`)
  assert.equal(result.status, expectedCode, `${name}: ${output}`)
  assert.match(output, expectedText)
  if (absentText) assert.doesNotMatch(output, absentText)
  summary.push({ name, exitCode: result.status, expectationMet: true })
}
async function run(name, args, expectedCode, expectedText, overrides = {}) {
  const result = spawnSync(process.execPath, args, { env: { ...env, ...overrides }, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  await writeFile(`${root}/${name}.txt`, `$ node ${args.join(' ')}\n${output}\nEXIT_CODE=${result.status}\n`)
  assert.equal(result.status, expectedCode, `${name}: ${output}`)
  assert.match(output, expectedText)
  summary.push({ name, exitCode: result.status, expectationMet: true })
}
const projection = 'src/client/better-sidebar-contract.d.ts'
const originalProjection = await readFile(projection)
try {
  assert.match(originalProjection.toString(), /single\?: boolean/)
  await writeFile(projection, originalProjection.toString().replace('single?: boolean', 'singleDrifted?: boolean'))
  await run('optional-field-drift-rejected', ['scripts/verify-sidebar-contract.mjs'], 1, /singleDrifted.*is not assignable/s)
  await runNpm('entrypoint-contract-drift-rejected', 1, /singleDrifted/, /SIDEBAR_REAL_REGISTRY/)
} finally { await writeFile(projection, originalProjection) }
await run('restored-sidebar-contract', ['scripts/verify-sidebar-contract.mjs'], 0, /consumerKeysExistInPublished.*true/s)

const providerService = `${directory}/src/client/service.ts`
const originalService = await readFile(providerService)
try {
  await writeFile(providerService, originalService.toString() + '\nthrow new Error("RESIDUAL_REGISTRY_FAILURE_SENTINEL")\n')
  await runNpm('entrypoint-registry-failure-rejected', 1,
    /consumerKeysExistInPublished.*true[\s\S]*RESIDUAL_REGISTRY_FAILURE_SENTINEL/)
} finally { await writeFile(providerService, originalService) }

// The npm-installed out-of-range version is real; future-version metadata is synthetic.
const outsideEnv = { SIDEBAR_PACKAGE_DIR: resolve('.scratch/residual-sidebar-outside/node_modules/dsh-better-sidebar') }
const before = spawnSync('git', ['show', '334673ada126d5da91eab5a465659091d9cf7b88:scripts/verify-sidebar-registry.mjs'], { encoding: 'utf8' })
assert.equal(before.status, 0)
await writeFile('.scratch/verify-sidebar-registry-before.mjs', before.stdout)
await run('before-published-0.25.0-rejected', ['.scratch/verify-sidebar-registry-before.mjs'], 1, /pinned to the reviewed 0.26.0 contract/, outsideEnv)
for (const script of ['contract', 'registry']) {
  await run(`published-0.25.0-${script}-rejected`, [`scripts/verify-sidebar-${script}.mjs`], 1,
    /SIDEBAR_CONTRACT_REJECTED.*"installedVersion":"0.25.0".*该包或版本未被验证/, outsideEnv)
}
const manifestFile = `${directory}/package.json`
const originalManifest = await readFile(manifestFile)
try {
  const manifest = JSON.parse(originalManifest)
  manifest.version = '0.26.1'
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2))
  for (const script of ['contract', 'registry']) {
    await run(`synthetic-0.26.1-${script}-rejected`, [`scripts/verify-sidebar-${script}.mjs`], 1,
      /SIDEBAR_CONTRACT_REJECTED.*"installedVersion":"0.26.1".*该包或版本未被验证/)
  }
} finally { await writeFile(manifestFile, originalManifest) }

const consumerFile = 'package.json'
const originalConsumer = await readFile(consumerFile)
try {
  const consumer = JSON.parse(originalConsumer)
  consumer.peerDependencies['dsh-better-sidebar'] = '^0.26.0'
  await writeFile(consumerFile, JSON.stringify(consumer, null, 2))
  await run('peer-range-drift-rejected', ['scripts/verify-sidebar-contract.mjs'], 1,
    /SIDEBAR_CONTRACT_REJECTED.*声明范围与验证集合不一致/)
} finally { await writeFile(consumerFile, originalConsumer) }

const workflow = load(await readFile('.github/workflows/ci.yml', 'utf8'))
const previousWorkflow = spawnSync('git', ['show', 'HEAD:.github/workflows/ci.yml'], { encoding: 'utf8' })
assert.equal(previousWorkflow.status, 0)
assert.deepEqual(workflow.jobs.verify, load(previousWorkflow.stdout).jobs.verify)
assert.deepEqual(Object.keys(workflow.jobs).sort(), ['sidebar-contract', 'verify'])
assert.deepEqual(workflow.jobs['sidebar-contract'].strategy.matrix.os, ['ubuntu-latest', 'windows-latest'])
assert.equal(workflow.jobs['sidebar-contract']['continue-on-error'], undefined)
const steps = workflow.jobs['sidebar-contract'].steps
assert(steps.every(step => !step['continue-on-error']))
const install = steps.find(step => step.run?.startsWith('npm install --prefix'))
assert(install)
assert(install.run.endsWith(`dsh-better-sidebar@${VERIFIED_SIDEBAR_VERSION}`))
assert(install.run.includes('--ignore-scripts --legacy-peer-deps'))
assert.equal(steps.at(-1).run, 'npm run verify:sidebar')
assert.equal(workflow.jobs['sidebar-contract'].env.SIDEBAR_PACKAGE_DIR,
  '${{ runner.temp }}/atn-sidebar-provider/node_modules/dsh-better-sidebar')
assert.equal(JSON.parse(originalConsumer).scripts['verify:sidebar'],
  'node scripts/verify-sidebar-contract.mjs && node scripts/verify-sidebar-registry.mjs')
summary.push({ name: 'ci-yaml-and-blocking-wiring', expectationMet: true,
  existingVerifyJobUnchanged: true, providerPinMatchesVerifiedSet: true })
await runNpm('sidebar-0.26.0', 0, /SIDEBAR_REAL_REGISTRY/)
await writeFile(`${root}/gate-checks.json`, JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
