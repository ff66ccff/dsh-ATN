/** Fixed per-call protocol costs are measured from the live registry. */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootKernel } from '../fixtures/kernel.ts'
import { measureAtnFixedContext, SHARED_RULES } from '../../src/tools.ts'

test('RECOVERY-CONTEXT: five tools, six behavioral rules and bounded fixed bytes', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-fixed-context-'))
  const kernel = await bootKernel(scratch)
  try {
    const schemas = kernel.ctx.tools.schemas().filter(row => row.name.startsWith('atn_'))
    assert.deepEqual(schemas.map(row => row.name).sort(), [
      'atn_finish', 'atn_send', 'atn_spawn', 'atn_start', 'atn_status',
    ])
    assert.ok(SHARED_RULES.split('\n').length <= 6)
    const measured = measureAtnFixedContext(schemas)
    assert.equal(measured.systemPromptBytes, Buffer.byteLength(SHARED_RULES))
    assert.equal(measured.toolSchemaBytes, Buffer.byteLength(JSON.stringify(schemas)))
    assert.ok(measured.fixedContextBytes < 7160, `fixed context ${measured.fixedContextBytes} must decrease from 7160 UTF-8 bytes`)
    for (const schema of schemas) assert.match(schema.name, /^atn_[a-z]+$/)
    assert.doesNotMatch(SHARED_RULES, /atn_(feedback|publish|rewire)\b/)
  } finally {
    await kernel.ctx.fiber.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
})
