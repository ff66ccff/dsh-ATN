/** Model-facing peer reviews and rewiring retain the compact six-tool protocol. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools'
import { SHARED_RULES } from '../../src/tools.ts'
import { bootKernel, createHostAgent, settle, type Kernel } from '../fixtures/kernel.ts'

async function fixture(run: (kernel: Kernel) => Promise<void>): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-peer-variance-tools-'))
  const kernel = await bootKernel(scratch, { clock: () => 1_000_000 })
  try { await run(kernel) }
  finally { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) }
}

test('PEER-VARIANCE-RULES: reviews enumerate locally checkable rejection criteria', () => {
  assert.equal(SHARED_RULES.split('\n').length, 6)
  const reviewRule = SHARED_RULES.split('\n').find(line => line.includes('review'))!
  assert.match(reviewRule, /check.*phase\/version.*key.*required fields/i)
  assert.match(reviewRule, /reject.*phase\/version mismatch/i)
  assert.match(reviewRule, /missing required fields/i)
  assert.match(reviewRule, /wrong key/i)
  assert.match(reviewRule, /comparisonKey/)
  assert.match(reviewRule, /not host verification or human permission/)
})

test('PEER-VARIANCE-SCHEMA: model rewire exposes peers only and no host evidence ids', async () => {
  await fixture(async kernel => {
    const schemas = kernel.ctx.tools.schemas().filter(row => row.name.startsWith('atn_'))
    const status = schemas.find(row => row.name === 'atn_status')!
    assertObjectJsonSchema(status.parameters)
    const rewire = status.parameters.properties!.rewire
    assert.deepEqual(Object.keys(rewire.properties!), ['peers'])
    assert.deepEqual(rewire.required, ['peers'])
    assert.equal(rewire.additionalProperties, false)
    assert.doesNotMatch(JSON.stringify(schemas), /baselineTaskIds|candidateTaskIds/)
    assert.match(status.description!, /ONE atomic write: claimTaskId, review or rewire/)
  })
})

test('PEER-VARIANCE-DISCOVERY: rules teach status query before its concrete rewire entry', async () => {
  await fixture(async kernel => {
    const status = kernel.ctx.tools.schemas().find(row => row.name === 'atn_status')!
    assert.match(SHARED_RULES, /Query atn_status before rewiring/)
    assert.match(SHARED_RULES, /atn_status rewire=\{peers:\[.*\]\}/)
    assert.match(status.description!, /Discover peers.*rewire=\{peers:\[.*\]\}/)
  })
})

test('PEER-VARIANCE-ATOMIC: all competing status writes are refused without changing network', async () => {
  await fixture(async kernel => {
    const host = await createHostAgent(kernel, 'variance-tools-host')
    const started = await kernel.atn.start(host, {
      objective: 'Review versioned peer evidence.', successCriteria: 'Locally check returned fields.', constraints: 'Scripted test.',
    })
    const born = await kernel.atn.spawn(host, { task: 'Return evidence.', context: '' })
    await settle(kernel)
    await kernel.atn.send(kernel.ctx.agents.get(SessionId(born.sessionId))!, {
      to: started.nodeId, kind: 'result', taskId: born.taskId,
      body: 'phase=1; key=alpha; proof=current', summary: 'Current evidence.', evidence: ['phase-1:alpha'],
    })
    await settle(kernel)
    const before = await kernel.atn.network(started.networkId)
    const review = { taskId: born.taskId, status: 'accepted' as const, summary: 'Checked.', evidence: ['phase-1:alpha'] }
    for (const input of [
      { review, rewire: { peers: [] } },
      { claimTaskId: born.taskId, review },
      { claimTaskId: born.taskId, rewire: { peers: [] } },
    ]) {
      await assert.rejects(kernel.atn.status(host, input), { code: 'multiple-status-mutations' })
      assert.deepEqual(await kernel.atn.network(started.networkId), before)
    }
  })
})
