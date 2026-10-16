/** Optional loading and browser purity are release contracts. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

test('SIDEBAR-PACKAGE: provider is an optional peer with no installation or runtime value dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const verifiedVersion = execFileSync(process.execPath, ['--input-type=module', '-e',
    "import { VERIFIED_SIDEBAR_VERSION } from './scripts/sidebar-compatibility.mjs'; console.log(VERIFIED_SIDEBAR_VERSION)"],
  { cwd: new URL('../../', import.meta.url), encoding: 'utf8' }).trim()
  assert.equal(verifiedVersion, '0.26.1')
  assert.equal(manifest.peerDependencies['dsh-better-sidebar'], verifiedVersion)
  const lock = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')).packages['']
  assert.equal(lock.peerDependencies['dsh-better-sidebar'], verifiedVersion)
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
