/** Release contract checks for the explicitly supported Harness build. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

test('HARNESS-01: every Harness dependency and override uses the supported release', () => {
  for (const section of [manifest.peerDependencies, manifest.devDependencies, manifest.overrides['dsh-opencode-go']]) {
    for (const [name, version] of Object.entries(section)) {
      if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.2.1-alpha.4', name)
    }
  }
  assert.equal(manifest.engines.node, '>=24')
  assert.equal(manifest.engines.dsh, '>=0.2.1-alpha.4 <0.3.0')
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '4.0.5-alpha.2')
  assert.equal(manifest.dependencies['@deepseek-ai/schemastery'], '3.18.5-alpha.2')
  assert.equal(manifest.devDependencies['@deepseek-ai/cordis-plugin-include'], '1.0.10-alpha.2')
  assert.equal(manifest.devDependencies['@deepseek-ai/cordis-plugin-loader'], '1.0.6-alpha.2')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-util-values'], '0.2.1-alpha.4')
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-util-values'], '0.2.1-alpha.4')
  for (const file of ['package.json', 'package-lock.json']) {
    assert.doesNotMatch(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'),
      /0\.2\.1-alpha\.2|4\.0\.5-alpha\.1|3\.18\.5-alpha\.1/)
  }
})

test('HARNESS-02: removed invariants and unresolved cwd templates are absent', () => {
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-invariants'], undefined)
  assert.doesNotMatch(readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'), /\{\{cwd\}\}/)
})
