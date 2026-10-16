/** Reviewed published versions; the optional peer must describe exactly this set. */
import ts from 'typescript'
import { access, readFile, mkdir, mkdtemp } from 'node:fs/promises'
import { resolve } from 'node:path'

export const VERIFIED_SIDEBAR_VERSIONS = ['0.26.1', '0.27.0']
export const VERIFIED_SIDEBAR_RANGE = VERIFIED_SIDEBAR_VERSIONS.join(' || ')

function reject(details) {
  console.error('SIDEBAR_CONTRACT_REJECTED ' + JSON.stringify(details))
  process.exit(1)
}

export async function verifiedSidebarPackage() {
  const consumer = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
  for (const [source, manifest] of [['package.json', consumer], ['package-lock.json', lock.packages['']]]) {
    if (manifest.peerDependencies?.['dsh-better-sidebar'] !== VERIFIED_SIDEBAR_RANGE ||
      manifest.peerDependenciesMeta?.['dsh-better-sidebar']?.optional !== true ||
      ['dependencies', 'devDependencies', 'optionalDependencies'].some(key => 'dsh-better-sidebar' in (manifest[key] ?? {}))) {
      reject({ source, verifiedVersions: VERIFIED_SIDEBAR_VERSIONS,
        message: '声明范围与验证集合不一致：dsh-better-sidebar 必须仅为已验证版本的可选 peer。' })
    }
  }
  const directory = process.env.SIDEBAR_PACKAGE_DIR
  if (!directory) reject({ message: '请设置 SIDEBAR_PACKAGE_DIR，指向独立安装的 dsh-better-sidebar 包目录。' })
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (manifest.name !== 'dsh-better-sidebar' || !VERIFIED_SIDEBAR_VERSIONS.includes(manifest.version)) {
    reject({ package: manifest.name, installedVersion: manifest.version,
      declaredRange: consumer.peerDependencies['dsh-better-sidebar'], verifiedVersions: VERIFIED_SIDEBAR_VERSIONS,
      message: '该包或版本未被验证，不在声明的兼容范围内；拒绝执行契约检查。' })
  }
  let declarationDirectory = directory
  let declarationBasis = 'published'
  try {
    await access(resolve(directory, 'lib/types/client/service.d.ts'))
  } catch {
    // Build the real source declaration graph, including its transitive types.
    // A matching service.ts alone cannot prove imported types are unchanged.
    await mkdir(resolve('.scratch'), { recursive: true })
    declarationDirectory = await mkdtemp(resolve('.scratch/sidebar-types-'))
    const program = ts.createProgram([resolve(directory, 'src/client/service.ts')], {
      strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true,
      declaration: true, emitDeclarationOnly: true, noEmitOnError: true,
      allowImportingTsExtensions: true, target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX, rootDir: resolve(directory, 'src'),
      outDir: resolve(declarationDirectory, 'lib/types'),
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    if (diagnostics.length) reject({ message: '上游源码声明编译失败。',
      diagnostics: ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: value => value, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
      }) })
    const emitted = program.emit()
    if (emitted.emitSkipped || emitted.diagnostics.length) reject({ message: '上游声明生成失败。' })
    declarationBasis = 'compiled-upstream-source'
  }
  return { directory, manifest, declarationDirectory, declarationBasis }
}
