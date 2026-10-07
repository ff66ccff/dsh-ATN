/** Offline pre-registration calculation; never imports the live runner. */
import { parseArgs } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { simplificationPower } from '../experiments/simplification-statistics.ts'
const { values } = parseArgs({ options: { n: { type: 'string', default: '14' },
  delta: { type: 'string', default: '0.25' }, discordance: { type: 'string', default: '1' }, out: { type: 'string' } } })
const result = simplificationPower(Number(values.n), Number(values.delta), Number(values.discordance))
if (values.out) {
  await mkdir(dirname(resolve(values.out)), { recursive: true })
  await writeFile(resolve(values.out), JSON.stringify(result, null, 2) + '\n')
}
console.log(JSON.stringify(result, null, 2))
