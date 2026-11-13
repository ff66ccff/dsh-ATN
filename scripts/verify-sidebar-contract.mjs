/** Check the consumer projection against the provider's real declaration graph. */
import ts from 'typescript'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { verifiedSidebarPackage } from './sidebar-compatibility.mjs'

const { manifest, declarationDirectory, declarationBasis } = await verifiedSidebarPackage()
const declaration = resolve(declarationDirectory, 'lib/types/client/service.d.ts')
const projection = resolve('src/client/better-sidebar-contract.d.ts')
const fixture = resolve('.scratch/sidebar-contract-check.ts')
await mkdir(resolve('.scratch'), { recursive: true })
await writeFile(fixture, `import type { TabDescriptor as Published, TabComponentProps as PublishedProps } from ${JSON.stringify(declaration.replaceAll('\\', '/'))}
import type { TabDescriptor as Projected, TabComponentProps as ProjectedProps } from 'dsh-better-sidebar'
// Structural assignability alone would silently accept a renamed optional key.
type SupportedKeys = Pick<Published, keyof Projected>
type SupportedPropKeys = Pick<PublishedProps, keyof ProjectedProps>
// skipLibCheck must not turn a missing transitive declaration into an accepted any.
type Assert<T extends true> = T
type IsNotAny<T> = 0 extends (1 & T) ? false : true
type ConcreteFields<T> = false extends { [Key in keyof T]-?: IsNotAny<T[Key]> }[keyof T] ? false : true
type ResolvedDescriptor = Assert<IsNotAny<Published>>
type ResolvedDescriptorFields = Assert<ConcreteFields<SupportedKeys>>
type ResolvedProps = Assert<IsNotAny<PublishedProps>>
type ResolvedPropFields = Assert<ConcreteFields<SupportedPropKeys>>
type ResolvedComponentInput = Assert<IsNotAny<Parameters<Published['component']>[0]>>
declare const descriptor: Projected
const accepted: Published = descriptor
// The provider calls our component, so its props must satisfy our read-only projection.
declare const props: PublishedProps
const received: ProjectedProps = props
void accepted
void received
`)
const program = ts.createProgram([fixture, projection], {
  strict: true, skipLibCheck: true, noEmit: true, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2023,
  // The isolated provider ships React's runtime, not its dev-only typings. Use the
  // consumer's locked types even when the provider is outside the workspace.
  paths: { 'dsh-better-sidebar': [projection], react: [resolve('node_modules/@types/react/index.d.ts')] },
})
const diagnostics = ts.getPreEmitDiagnostics(program)
const checker = program.getTypeChecker()
const unresolvedImports = []
for (const source of program.getSourceFiles()) {
  if (!resolve(source.fileName).startsWith(resolve(declarationDirectory) + sep)) continue
  const visit = node => {
    const moduleName = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
      : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined
    if (moduleName && ts.isStringLiteral(moduleName) && checker.getSymbolAtLocation(moduleName) === undefined) {
      unresolvedImports.push(`${source.fileName}: ${moduleName.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
if (diagnostics.length || unresolvedImports.length) {
  console.error('SIDEBAR_CONTRACT_REJECTED: consumer TabDescriptor or TabComponentProps differs from the provider API')
  if (unresolvedImports.length) console.error('Unresolved provider declarations: ' + unresolvedImports.join('; '))
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: value => value, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
  }))
  process.exitCode = 1
} else console.log(JSON.stringify({ package: manifest.name, version: manifest.version, declarationBasis,
  declarationSha256: createHash('sha256').update(await readFile(declaration)).digest('hex'),
  consumerDescriptorAssignableToPublished: true, consumerKeysExistInPublished: true,
  consumerPropsAcceptPublishedProps: true, consumerPropKeysExistInPublished: true,
  scope: 'Public TabDescriptor and consumed TabComponentProps only; not whole-provider or host activation.' }, null, 2))
