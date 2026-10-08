/** Run with: node --import tsx/esm examples/information-boundary.ts (zero paid calls). */
import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineCustodyPolicy } from '../src/index.ts'
import { bootKernel, createHostAgent, settle } from '../tests/fixtures/kernel.ts'

const scratch = await mkdtemp(join(tmpdir(), 'atn-boundary-example-'))
const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
try {
  const custody = new Map<string, Set<string>>([['node-1', new Set(['root-document'])]])
  const policy = defineCustodyPolicy({
    custody: nodeId => custody.get(nodeId) ?? [],
    // Demonstration protocol only: claim:ID means "I hold artifact ID".
    // Production hosts must extract their actual structured claims from every field.
    extractClaims: input => [...JSON.stringify(input).matchAll(/claim:([a-z-]+)/g)].map(match => match[1]),
    describeArtifact: id => ({ topics: [id] }),
  })
  const dispose = kernel.atn.installOutboundPolicy('*', policy)
  const root = await createHostAgent(kernel, 'example-entry')
  const started = await kernel.atn.start(root, { objective: 'Check actual local custody.',
    successCriteria: 'Owned claims pass and unowned claims fail atomically.', constraints: 'No paid model calls.' })
  const worker = await kernel.atn.spawn(root, { task: 'Read your local artifact.', context: '' })
  await settle(kernel)
  const agent = kernel.ctx.agents.get(SessionId(worker.sessionId))!
  custody.set(worker.nodeId, new Set(['worker-document']))
  await kernel.atn.refreshCustody(started.networkId)
  await kernel.atn.send(root, { to: worker.nodeId, kind: 'note', body: 'claim:root-document' })
  await kernel.atn.send(agent, { to: started.nodeId, kind: 'result', taskId: worker.taskId,
    body: 'claim:worker-document', summary: 'claim:worker-document', evidence: ['claim:worker-document'] })
  await settle(kernel)
  const before = await kernel.atn.network(started.networkId)
  await assert.rejects(kernel.atn.status(root, { review: { taskId: worker.taskId, status: 'accepted',
    summary: 'claim:worker-document', evidence: ['local-check'] } }), { code: 'evidence-not-owned' })
  assert.deepEqual(await kernel.atn.network(started.networkId), before)
  await kernel.atn.rewire(root, { peers: [] })
  assert.deepEqual((await kernel.atn.status(root, { query: 'worker-document' })).candidates, [worker.nodeId])
  console.log('Owned note/result accepted; unowned review refused atomically; custody discovery works without a board.')
  dispose()
} finally {
  await kernel.ctx.fiber.dispose()
  await rm(scratch, { recursive: true, force: true })
}
