/** Minimum host compatibility and reproducible rc.3 development baseline. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

test('HARNESS-01: host peers accept rc.3 and later while development pins rc.3', () => {
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '>=0.2.1-rc.3', name)
  }
  for (const section of [manifest.devDependencies, manifest.overrides['dsh-opencode-go']]) {
    for (const [name, version] of Object.entries(section)) {
      if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, '0.2.1-rc.3', name)
    }
  }
  assert.equal(manifest.engines.node, '>=24.9.0')
  assert.equal(manifest.engines.dsh, '>=0.2.1-rc.3')
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '4.0.5')
  assert.equal(manifest.dependencies['@deepseek-ai/schemastery'], '3.18.5')
  assert.equal(manifest.devDependencies['@deepseek-ai/cordis-plugin-include'], '1.0.10')
  assert.equal(manifest.devDependencies['@deepseek-ai/cordis-plugin-loader'], '1.0.6')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-util-values'], '>=0.2.1-rc.3')
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-util-values'], '0.2.1-rc.3')
  for (const file of ['package.json', 'package-lock.json']) {
    assert.doesNotMatch(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'),
      /0\.2\.1-(?:alpha\.|rc\.[12]\b)|4\.0\.5-alpha\.|3\.18\.5-alpha\.|1\.0\.(6|10)-alpha\./)
  }
})

test('HARNESS-02: removed invariants and unresolved cwd templates are absent', () => {
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-invariants'], undefined)
  assert.doesNotMatch(readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8'), /\{\{cwd\}\}/)
})
