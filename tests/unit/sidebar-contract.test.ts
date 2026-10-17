/** Optional loading and browser purity are release contracts. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, resolve, basename } from 'node:path'

test('SIDEBAR-PACKAGE: provider is an optional peer with no installation or runtime value dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const verifiedRange = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { VERIFIED_SIDEBAR_RANGE } from './scripts/sidebar-compatibility.mjs'; console.log(VERIFIED_SIDEBAR_RANGE)"],
  { cwd: new URL('../../', import.meta.url), encoding: 'utf8' }).trim()
  assert.equal(verifiedRange, '0.28.0')
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
  const service = `export interface TabDescriptor {
    id: string; title: string | (() => string); description?: string | (() => string)
    order?: number; single?: boolean; available?: (...args: any[]) => boolean
    component: (props: any) => unknown
  }`
  try {
    mkdirSync(join(provider, 'src/client'), { recursive: true })
    writeFileSync(join(provider, 'package.json'), JSON.stringify({ name: 'dsh-better-sidebar', version: '0.28.0' }))
    writeFileSync(join(provider, 'src/client/service.ts'), service)
    const check = () => spawnSync(process.execPath, ['scripts/verify-sidebar-contract.mjs'], {
      cwd: new URL('../../', import.meta.url), encoding: 'utf8',
      env: { ...process.env, SIDEBAR_PACKAGE_DIR: provider },
    })
    const matching = check()
    assert.equal(matching.status, 0, matching.stderr)
    assert.match(matching.stdout, /compiled-upstream-source/)
    writeFileSync(join(provider, 'src/client/service.ts'), service.replace('id: string', 'tabId: string'))
    const drift = check()
    assert.equal(drift.status, 1)
    assert.match(drift.stderr, /SIDEBAR_CONTRACT_REJECTED/)
    writeFileSync(join(provider, 'src/client/service.ts'), 'export interface Broken {')
    const invalid = check()
    assert.equal(invalid.status, 1)
    assert.match(invalid.stderr, /源码声明编译失败/)
    writeFileSync(join(provider, 'package.json'), JSON.stringify({ name: 'dsh-better-sidebar', version: '0.28.1' }))
    const future = check()
    assert.equal(future.status, 1)
    assert.match(future.stderr, /未被验证/)
  } finally {
    assert.equal(dirname(resolve(scratch)), resolve(tmpdir()))
    assert.ok(basename(scratch).startsWith('atn-sidebar-contract-'))
    rmSync(scratch, { recursive: true, force: true })
  }
})
