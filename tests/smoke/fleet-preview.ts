/** Disposable loopback browser fixture. Its operator selector is test-only, not an authentication carrier. */
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import RemoteAccess from '@deepseek-ai/dsh-api-remote-access'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import { bootKernel, createHostAgent } from '../fixtures/kernel.ts'
import { AtnObserver } from '../../src/observer.ts'
import { ATN_FLEET_READER, fleetNetworkResourceId } from '../../src/observer-access.ts'
import { testGoal } from '../fixtures/network.ts'
declare module '@deepseek-ai/dsh-typert-protocol' {
 interface PrincipalMap { 'fleet-preview': { readonly kind: 'fleet-preview'; readonly id: string } }
}
const scratch = await mkdtemp(join(tmpdir(), 'atn-fleet-browser-'))
const kernel = await bootKernel(scratch, { clock: () => 100 })
const a = await createHostAgent(kernel, 'browser-network-a'), b = await createHostAgent(kernel, 'browser-network-b')
const na = await kernel.atn.start(a, testGoal), nb = await kernel.atn.start(b, testGoal)
await kernel.atn.publish(a, { sub_task: 'parser fixture', artifact: 'local', rationale: 'local' })
await kernel.ctx.plugin(TypertRegistry); await kernel.ctx.plugin(RemoteAccess); await kernel.ctx.plugin(TypertGateway); await kernel.ctx.plugin(AtnObserver)
kernel.ctx.remoteAccess.registerPolicy('fleet-preview', { bindings: principal => principal.id === 'none' ? [] : [
 { role: ATN_FLEET_READER, resource: { kind: 'atn-fleet', id: 'index' } },
 ...(principal.id === 'all' ? [na.networkId, nb.networkId] : [principal.id === 'a' ? na.networkId : nb.networkId])
  .map(id => ({ role: ATN_FLEET_READER, resource: { kind: 'atn-fleet' as const, id: fleetNetworkResourceId(id) } })),
] })
await kernel.atn.publish(a, { sub_task: 'x', artifact: 'private rejected fixture', rationale: 'msg:99', refs: ['msg:99'] }).catch(() => {})
const bundle = await build({ entryPoints: ['tests/smoke/fleet-preview-ui.tsx'], bundle: true, write: false, format: 'esm', platform: 'browser',
 tsconfig: 'tsconfig.client.json', alias: { '@deepseek-ai/dsh-client-ui-primitives': new URL('../client/modal-fixture.tsx', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') },
 define: { 'process.env.NODE_ENV': '"production"' } })
const peers = new Map(['a', 'b', 'all', 'none'].map(id => [id, new Peer(kernel.ctx, { principal: { kind: 'fleet-preview', id } })]))
const server = createServer(async (request, response) => {
 const url = new URL(request.url!, 'http://localhost')
 if (url.pathname === '/bundle.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle.outputFiles[0].text); return }
 if (url.pathname === '/fleet') {
  try {
   const peer = peers.get(url.searchParams.get('operator') ?? 'none')!
   const value = await kernel.ctx.typertGateway.invoke({ peer, namespace: 'atnObserver', method: 'fleet', args: {}, signal: new AbortController().signal })
   response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value))
  } catch { response.statusCode = 403; response.end('{"error":"denied"}') }
  return
 }
 response.setHeader('content-type', 'text/html; charset=utf-8')
 response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><title>ATN Fleet validation</title><style>:root{--dsw-alias-label-primary:#162434;--dsw-alias-label-secondary:#60758b;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-2:#e5f1f8;--dsw-alias-border-l1:#dce5ec}body{margin:0;background:#f2f6f9;font:15px system-ui}.fixture-head{padding:24px 40px;background:#112f46;color:#fff}h1{font-size:26px}select{margin-left:12px;padding:7px;border-radius:6px}main{margin:24px 40px;background:white;max-width:1120px;border:1px solid #dce5ec;border-radius:12px;overflow:hidden;height:660px}.atn-shell{min-height:0}</style><div id="root"></div><script type="module" src="/bundle.js"></script></html>')
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
await writeFile('.scratch/fleet-browser-ready.json', JSON.stringify({ origin: `http://127.0.0.1:${port}`, networks: [na.networkId, nb.networkId] }, null, 2))
console.log(`FLEET_BROWSER_READY http://127.0.0.1:${port}`)
let closed = false
async function close() { if (closed) return; closed = true; server.close(); await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
process.on('SIGINT', () => { void close().then(() => process.exit()) })
process.on('SIGTERM', () => { void close().then(() => process.exit()) })
