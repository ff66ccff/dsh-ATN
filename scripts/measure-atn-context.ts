/** Measure actual advertised protocol bytes with a keyless real kernel. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootKernel } from '../tests/fixtures/kernel.ts'
import { measureAtnFixedContext } from '../src/tools.ts'

const scratch = await mkdtemp(join(tmpdir(), 'atn-context-measure-'))
const kernel = await bootKernel(scratch)
try {
  const schemas=kernel.ctx.tools.schemas()
  const baseline=await bootKernel(join(scratch,'off'),{config:{substrateEnabled:false}})
  try {
    console.log(JSON.stringify({enabled:measureAtnFixedContext(schemas), disabled:measureAtnFixedContext(baseline.ctx.tools.schemas()),
      addedToolSchemaBytes:Object.fromEntries(schemas.filter(row=>['atn_publish','atn_search','atn_visit'].includes(row.name))
        .map(row=>[row.name,Buffer.byteLength(JSON.stringify(row))]))},null,2))
  } finally {await baseline.ctx.fiber.dispose()}
} finally {
  await kernel.ctx.fiber.dispose()
  await rm(scratch, { recursive: true, force: true })
}
