/** Build from a fresh generated directory so removed modules cannot enter a tarball. */
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)))
const generatedDirectory = resolve(projectRoot, 'lib')
if (dirname(generatedDirectory) !== projectRoot) throw new Error('Build output must stay inside the project')
await rm(generatedDirectory, { recursive: true, force: true })
