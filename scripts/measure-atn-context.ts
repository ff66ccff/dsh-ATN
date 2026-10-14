/** Measure actual advertised protocol bytes with a keyless real kernel. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootKernel } from '../tests/fixtures/kernel.ts'
import { measureAtnFixedContext } from '../src/tools.ts'

const scratch = await mkdtemp(join(tmpdir(), 'atn-context-measure-'))
const kernel = await bootKernel(scratch)
try {
  console.log(JSON.stringify(measureAtnFixedContext(kernel.ctx.tools.schemas()), null, 2))
} finally {
  await kernel.ctx.fiber.dispose()
  await rm(scratch, { recursive: true, force: true })
}
