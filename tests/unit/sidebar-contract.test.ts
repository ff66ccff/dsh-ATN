/** Optional loading and browser purity are release contracts. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

// Synthetic verifier fixtures, not evidence of a real provider or host mount.
// Temp-directory providers cannot inherit the consumer's node_modules. Like the
// published package, they import React types without shipping @types/react.
const fixtureScope = 'export interface SessionScope { sessionId: string; cwd?: string }'
const cordisTypes = fileURLToPath(new URL('../../node_modules/@deepseek-ai/cordis/lib/types/index.d.ts', import.meta.url)).replaceAll('\\', '/')
const fixtureService = `import type { SessionScope } from './scope.ts'
  import type { ReactNode } from 'react'
  import type { Context } from ${JSON.stringify(cordisTypes)}
  export interface TabComponentProps {
    ctx: Context; store: unknown; scope: SessionScope
    tab: { id: string; type: string; title: string; path?: string; line?: number; meta?: unknown }
    visible: boolean; expanded?: string[]
  }
  export interface TabDescriptor {
    id: string; title: string | (() => string); description?: string | (() => string)
    order?: number; single?: boolean; bottomOnly?: boolean
    available?: (ctx: Context, scope: SessionScope, state: unknown) => boolean
    component: (props: TabComponentProps) => ReactNode
  }`

function installReactRuntimeFixture(provider: string) {
  const directory = join(provider, 'node_modules/react')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'react', main: 'index.js' }))
  writeFileSync(join(directory, 'index.js'), 'module.exports = {}')
}

test('SIDEBAR-PACKAGE: provider is an optional peer with no installation or runtime value dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const verified = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { VERIFIED_SIDEBAR_VERSIONS, VERIFIED_SIDEBAR_RANGE } from './scripts/sidebar-compatibility.mjs'; console.log(JSON.stringify({ versions: VERIFIED_SIDEBAR_VERSIONS, range: VERIFIED_SIDEBAR_RANGE }))"],
  { cwd: new URL('../../', import.meta.url), encoding: 'utf8' }))
  assert.deepEqual(verified.versions, ['0.32.0'])
  const verifiedRange = verified.range
  assert.equal(verifiedRange, '0.32.0')
  assert.equal(manifest.peerDependencies['dsh-better-sidebar'], verifiedRange)
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')).packages['']
  assert.equal(lock.peerDependencies['dsh-better-sidebar'], verifiedRange)
  assert.equal(lock.peerDependenciesMeta['dsh-better-sidebar'].optional, true)
  assert.equal(manifest.peerDependenciesMeta['dsh-better-sidebar'].optional, true)
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) assert.equal(manifest[section]?.['dsh-better-sidebar'], undefined)
  const client = new URL('../../src/client/', import.meta.url)
  assert.equal(existsSync(new URL('layout.ts', client)), false)
  for (const path of readdirSync(client).filter(path => /\.tsx?$/.test(path))) {
    const source = readFileSync(new URL(path, client), 'utf8')
    assert.doesNotMatch(source, /atn-canvas|atn-edge|<svg|zoomIn|zoomOut/)
    for (const line of source.split('\n').filter(line => /^import.*from ['"]dsh-better-sidebar/.test(line))) assert.match(line, /^import type /)
  }
  const index = readFileSync(new URL('index.tsx', client), 'utf8')
  assert.match(index, /export const inject = \['slots', 'locale', \.\.\.transportInject\]/)
})

test('SIDEBAR-SOURCE: source-only compatibility rejects drift and unreviewed releases', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'atn-sidebar-contract-'))
  const provider = join(scratch, 'provider')
  const service = fixtureService
  try {
    installReactRuntimeFixture(provider)
    mkdirSync(join(provider, 'src/client'), { recursive: true })
    writeFileSync(join(provider, 'package.json'), JSON.stringify({ name: 'dsh-better-sidebar', version: '0.32.0' }))
    writeFileSync(join(provider, 'src/client/scope.ts'), fixtureScope)
    writeFileSync(join(provider, 'src/client/service.ts'), service)
    const check = () => spawnSync(process.execPath, ['scripts/verify-sidebar-contract.mjs'], {
      cwd: new URL('../../', import.meta.url), encoding: 'utf8',
      env: { ...process.env, SIDEBAR_PACKAGE_DIR: provider },
    })
    const matching = check()
    assert.equal(matching.status, 0, matching.stderr)
    assert.match(matching.stdout, /compiled-upstream-source/)
    assert.match(matching.stdout, /"consumerPropsAcceptPublishedProps": true/)
    assert.match(matching.stdout, /not whole-provider or host activation/)
    for (const changed of [service.replace('id: string; title:', 'tabId: string; title:'),
      service.replace('description?:', 'summary?:'), service.replace('visible: boolean', 'visible: string')]) {
      writeFileSync(join(provider, 'src/client/service.ts'), changed)
      const drift = check()
      assert.equal(drift.status, 1)
      assert.match(drift.stderr, /SIDEBAR_CONTRACT_REJECTED/)
    }
    writeFileSync(join(provider, 'src/client/service.ts'), service)
    writeFileSync(join(provider, 'src/client/scope.ts'), fixtureScope.replace('sessionId: string', 'sessionId: number'))
    const transitiveDrift = check()
    assert.equal(transitiveDrift.status, 1)
    assert.match(transitiveDrift.stderr, /SIDEBAR_CONTRACT_REJECTED/)
    writeFileSync(join(provider, 'src/client/scope.ts'), fixtureScope)
    writeFileSync(join(provider, 'src/client/service.ts'), 'export interface Broken {')
    const invalid = check()
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /源码声明编译失败/)
    for (const version of ['0.28.0', '0.32.1']) {
      writeFileSync(join(provider, 'package.json'), JSON.stringify({ name: 'dsh-better-sidebar', version }))
      const unverified = check()
      assert.equal(unverified.status, 1)
      assert.match(unverified.stderr, /未被验证/)
    }
  } finally {
    assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
    assert.ok(basename(scratch).startsWith('atn-sidebar-contract-'))
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('SIDEBAR-PUBLISHED: shipped declarations override source and reject transitive drift or unresolved props', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'atn-sidebar-published-'))
  const provider = join(scratch, 'provider')
  const service = fixtureService.replace("'./scope.ts'", "'./scope.js'")
  try {
    installReactRuntimeFixture(provider)
    mkdirSync(join(provider, 'lib/types/client'), { recursive: true })
    mkdirSync(join(provider, 'src/client'), { recursive: true })
    writeFileSync(join(provider, 'package.json'), JSON.stringify({ name: 'dsh-better-sidebar', version: '0.32.0', type: 'module' }))
    writeFileSync(join(provider, 'lib/types/client/service.d.ts'), service)
    writeFileSync(join(provider, 'lib/types/client/scope.d.ts'), fixtureScope)
    // Passing must use the shipped declarations, never a lookalike source fallback.
    writeFileSync(join(provider, 'src/client/service.ts'), 'export interface Broken {')
    const check = () => spawnSync(process.execPath, ['scripts/verify-sidebar-contract.mjs'], {
      cwd: new URL('../../', import.meta.url), encoding: 'utf8',
      env: { ...process.env, SIDEBAR_PACKAGE_DIR: provider },
    })
    const matching = check()
    assert.equal(matching.status, 0, matching.stderr)
    assert.match(matching.stdout, /"declarationBasis": "published"/)
    assert.match(matching.stdout, /"declarationSha256": "[a-f0-9]{64}"/)
    assert.match(matching.stdout, /"consumerPropsAcceptPublishedProps": true/)
    writeFileSync(join(provider, 'lib/types/client/scope.d.ts'), fixtureScope.replace('sessionId: string', 'sessionId: number'))
    const drift = check()
    assert.equal(drift.status, 1)
    assert.match(drift.stderr, /SIDEBAR_CONTRACT_REJECTED/)
    writeFileSync(join(provider, 'lib/types/client/scope.d.ts'), fixtureScope)
    writeFileSync(join(provider, 'lib/types/client/service.d.ts'), service.replace("'./scope.js'", "'./missing.js'"))
    const unresolved = check()
    assert.equal(unresolved.status, 1)
    assert.match(unresolved.stderr, /SIDEBAR_CONTRACT_REJECTED/)
  } finally {
    assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
    assert.ok(basename(scratch).startsWith('atn-sidebar-published-'))
    rmSync(scratch, { recursive: true, force: true })
  }
})
