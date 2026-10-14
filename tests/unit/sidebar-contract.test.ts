/** Optional loading and browser purity are release contracts. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

test('SIDEBAR-PACKAGE: provider is an optional peer with no installation or runtime value dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.peerDependencies['dsh-better-sidebar'], '^0.26.0')
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
