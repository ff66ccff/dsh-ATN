/** Fixed per-call protocol costs are measured from the live registry. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootKernel } from '../fixtures/kernel.ts'
import { measureAtnFixedContext, SHARED_RULES } from '../../src/tools.ts'

test('RECOVERY-CONTEXT: eight tools, eight behavioral rules and bounded fixed bytes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-fixed-context-'))
  const kernel = await bootKernel(scratch)
  try {
    const schemas = kernel.ctx.tools.schemas().filter(row => row.name.startsWith('atn_'))
    assert.deepEqual(schemas.map(row => row.name).sort(), [
      'atn_finish', 'atn_publish', 'atn_search', 'atn_send', 'atn_spawn', 'atn_start', 'atn_status', 'atn_visit',
    ])
    assert.ok(SHARED_RULES.split('\n').length <= 8)
    const measured = measureAtnFixedContext(schemas)
    assert.equal(measured.systemPromptBytes, Buffer.byteLength(SHARED_RULES))
    assert.equal(measured.toolSchemaBytes, Buffer.byteLength(JSON.stringify(schemas)))
    assert.ok(measured.fixedContextBytes < 8500, `fixed context ${measured.fixedContextBytes} must fit the reviewed eight-tool UTF-8 ceiling`)
    assert.equal(measured.fixedContextBytes, 7956, 'round-v2 forbids any change to model tools, parameters or fixed context')
    for (const schema of schemas) assert.match(schema.name, /^atn_[a-z]+$/)
    assert.doesNotMatch(SHARED_RULES, /atn_(feedback|rewire)\b/)
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})

// Disabling substrate retains the exact previously measured five-tool protocol.
test('SUBSTRATE-OFF: tools and prompt bytes return to the alpha.4 baseline', async () => {
 const scratch = await mkdtemp(join(tmpdir(), 'atn-context-off-'))
 const kernel = await bootKernel(scratch, { config: { substrateEnabled: false } })
 try {
  const schemas = kernel.ctx.tools.schemas().filter(row => row.name.startsWith('atn_'))
  assert.deepEqual(schemas.map(row => row.name).sort(), ['atn_finish','atn_send','atn_spawn','atn_start','atn_status'])
  assert.deepEqual(measureAtnFixedContext(schemas, false), { systemPromptBytes:1161, toolSchemaBytes:4749, fixedContextBytes:5910 })
 } finally { await kernel.ctx.fiber.dispose(); await rm(scratch, {recursive:true,force:true}) }
})
