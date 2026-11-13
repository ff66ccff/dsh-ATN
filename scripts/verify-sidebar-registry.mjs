/** Exercise ATN registration against the provider's actual shipped service implementation. */
import { build } from 'esbuild'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { verifiedSidebarPackage } from './sidebar-compatibility.mjs'
const { directory, manifest } = await verifiedSidebarPackage()
await mkdir('.artifacts/sidebar-registry', { recursive: true })
const entry = resolve('.artifacts/sidebar-registry/entry.ts')
const output = resolve('.artifacts/sidebar-registry/check.mjs')
await writeFile(entry, `import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { JSDOM } from 'jsdom'
import * as plugin from '../../src/client/index.tsx'
import { createBetterSidebarService } from ${JSON.stringify(resolve(directory, 'src/client/service.ts').replaceAll('\\', '/'))}
import { createSidebarStore } from ${JSON.stringify(resolve(directory, 'src/client/state.ts').replaceAll('\\', '/'))}
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
Object.assign(globalThis, { document: dom.window.document, window: dom.window })
const ctx = new Context()
const store = createSidebarStore()
const service = createBetterSidebarService(store)
assert.equal(service.version, ${JSON.stringify(manifest.version)}, 'Service implementation must match the verified manifest')
ctx.provide('betterSidebar', service)
ctx.provide('slots', { inject: (_key, callback) => ctx.effect(callback), register: () => () => {} })
ctx.provide('locale', { register: () => () => {}, bind: () => key => key })
ctx.provide('sessions', { list: { getSnapshot: () => ({ byId: {
  'atn-session': { projectionValues: { agentPreset: 'atn' } },
  'other-session': { projectionValues: { agentPreset: 'standard' } },
} }), subscribe: () => () => {} } })
ctx.provide('connection', { rpc: { call: async () => { throw new Error('Registration must not fetch') } } })
try {
  const fiber = await ctx.plugin(plugin)
  assert.equal(service.getTabs().length, 1)
  const tab = service.getTab('atn-network')!
  assert.equal(tab.id, 'atn-network')
  assert.equal(tab.single, true)
  assert.equal('bottomOnly' in tab, false, 'ATN must remain available to the native right Sidebar')
  assert.equal(tab.available?.(ctx, { sessionId: 'atn-session' }, store.getSnapshot().state), true)
  assert.equal(tab.available?.(ctx, { sessionId: 'other-session' }, store.getSnapshot().state), false)
  assert.equal(tab.available?.(ctx, { sessionId: 'missing-session' }, store.getSnapshot().state), false)
  assert.throws(() => service.registerTab(tab), /already registered/)
  await fiber.dispose()
  assert.equal(service.getTabs().length, 0)
  await ctx.plugin(plugin)
  assert.equal(service.getTabs().length, 1)
  console.log('SIDEBAR_REAL_REGISTRY '+JSON.stringify({ version: service.version, registered: true, duplicateRejected: true, disposed: true, remounted: true, presetGating: true, bottomOnly: false, modelCalls: 0, implementationBasis: 'provider src/client/service.ts and src/client/state.ts', hostUi: 'fixture-only; not rendered', hostActivation: 'not-tested-by-this-check' }))
} finally { await ctx.fiber.dispose(); dom.window.close() }
`)
await build({ entryPoints: [entry], outfile: output, bundle: true, format: 'esm', platform: 'node',
  packages: 'external', jsx: 'automatic', alias: { '@deepseek-ai/dsh-client-ui-primitives': resolve('tests/client/modal-fixture.tsx') } })
const child = spawn(process.execPath, [output], { stdio: 'inherit' })
await new Promise((done, reject) => { child.on('error', reject); child.on('exit', code => { process.exitCode = code ?? 1; done() }) })
