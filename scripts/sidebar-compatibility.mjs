/** Reviewed published versions; the optional peer must describe exactly this set. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const VERIFIED_SIDEBAR_VERSION = '0.26.0'

function reject(details) {
  console.error('SIDEBAR_CONTRACT_REJECTED ' + JSON.stringify(details))
  process.exit(1)
}

export async function verifiedSidebarPackage() {
  const consumer = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
  for (const [source, manifest] of [['package.json', consumer], ['package-lock.json', lock.packages['']]]) {
    if (manifest.peerDependencies?.['dsh-better-sidebar'] !== VERIFIED_SIDEBAR_VERSION ||
      manifest.peerDependenciesMeta?.['dsh-better-sidebar']?.optional !== true ||
      ['dependencies', 'devDependencies', 'optionalDependencies'].some(key => 'dsh-better-sidebar' in (manifest[key] ?? {}))) {
      reject({ source, verifiedVersions: [VERIFIED_SIDEBAR_VERSION],
        message: '声明范围与验证集合不一致：dsh-better-sidebar 必须仅为精确版本的可选 peer。' })
    }
  }
  const directory = process.env.SIDEBAR_PACKAGE_DIR
  if (!directory) reject({ message: '请设置 SIDEBAR_PACKAGE_DIR，指向独立安装的 dsh-better-sidebar 包目录。' })
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  if (manifest.name !== 'dsh-better-sidebar' || manifest.version !== VERIFIED_SIDEBAR_VERSION) {
    reject({ package: manifest.name, installedVersion: manifest.version,
      declaredRange: consumer.peerDependencies['dsh-better-sidebar'], verifiedVersions: [VERIFIED_SIDEBAR_VERSION],
      message: '该包或版本未被验证，不在声明的兼容范围内；拒绝执行契约检查。' })
  }
  return { directory, manifest }
}
