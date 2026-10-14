/** Check the consumer projection against an independently installed published declaration graph. */
import ts from 'typescript'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

const directory = process.env.SIDEBAR_PACKAGE_DIR
if (!directory) throw new Error('Set SIDEBAR_PACKAGE_DIR to the independently installed dsh-better-sidebar package')
const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
const declaration = resolve(directory, 'lib/types/client/service.d.ts')
const projection = resolve('src/client/better-sidebar-contract.d.ts')
const fixture = resolve('.scratch/sidebar-contract-check.ts')
await mkdir(resolve('.scratch'), { recursive: true })
await writeFile(fixture, `import type { TabDescriptor as Published } from ${JSON.stringify(declaration.replaceAll('\\', '/'))}
import type { TabDescriptor as Projected } from 'dsh-better-sidebar'
declare const descriptor: Projected
const accepted: Published = descriptor
void accepted
`)
const program = ts.createProgram([fixture, projection], {
  strict: true, skipLibCheck: true, noEmit: true, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023,
  paths: { 'dsh-better-sidebar': [projection] },
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: value => value, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log(JSON.stringify({ package: manifest.name, version: manifest.version,
  publishedDeclarationSha256: createHash('sha256').update(await readFile(declaration)).digest('hex'),
  consumerDescriptorAssignableToPublished: true, scope: 'Public TabDescriptor shape only; not whole-provider activation.' }, null, 2))
