/** Real packaged Web-profile integration. ATN_VISUAL_PREVIEW=1 retains the app for browser QA. */
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: {
  cli: { type: 'string' }, sidebar: { type: 'string' }, port: { type: 'string' }, preview: { type: 'boolean' },
} })
const CLI = values.cli === undefined
  ? process.env.DSH_CLI ?? 'D:\\DeepSeekDesktop\\resources\\runtime\\cli\\bin\\dsh.cmd'
  : resolve(values.cli)
const portText = values.port ?? process.env.ATN_VISUAL_PORT ?? '0'
if (!/^\d+$/.test(portText) || !Number.isSafeInteger(Number(portText)) || Number(portText) > 65535) {
  throw new Error('Visualization port must be an integer from 0 through 65535')
}
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
const TARBALL = resolve('.artifacts', `dsh-atn-${version}.tgz`)
const preview = values.preview ?? process.env.ATN_VISUAL_PREVIEW === '1'
const sidebarSpec = values.sidebar ?? process.env.ATN_SIDEBAR_SPEC
const redact = (text: string): string => text.replace(/([?&]token=)[^\s&"'<>]+/g, '$1<redacted>')

async function dsh(home: string, args: string[], live = false): Promise<string> {
  const command = [CLI, ...args].map(part => {
    if (/["\r\n%]/.test(part)) throw new Error('Unsupported shell metacharacter in smoke path')
    return `"${part}"`
  }).join(' ')
  return new Promise((done, reject) => {
    const child = spawn(command, {
      cwd: home, windowsHide: true, shell: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD|^DSH_/i.test(key))),
        DSH_HOME: home,
        ATN_VISUAL_PREVIEW: preview ? '1' : '0',
        ...(sidebarSpec === undefined ? {} : { ATN_SIDEBAR_SPEC: sidebarSpec }),
      },
    })
    let output = ''
    let lines = ''
    let timedOut = false
    const kill = (): void => {
      if (process.platform === 'win32' && child.pid !== undefined) {
        execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {})
      } else child.kill()
    }
    const interrupt = (): void => { kill() }
    process.once('SIGINT', interrupt)
    process.once('SIGTERM', interrupt)
    const timer = setTimeout(() => { timedOut = true; kill() }, live && preview ? 17 * 60_000 : 180_000)
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        output = (output + chunk).slice(-100_000)
        if (!live) return
        lines += chunk
        const complete = lines.split(/\r?\n/)
        lines = complete.pop() ?? ''
        for (const line of complete) if (line.startsWith('ATN_VISUALIZATION_')) console.log(redact(line))
      })
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      process.removeListener('SIGINT', interrupt)
      process.removeListener('SIGTERM', interrupt)
    }
    child.on('error', error => { cleanup(); reject(error) })
    child.on('close', code => {
      cleanup()
      if (timedOut || code !== 0) reject(new Error(`Isolated dsh command failed (${timedOut ? 'timeout' : code}):\n${redact(output).slice(-12_000)}`))
      else done(output)
    })
  })
}

async function main(): Promise<void> {
  if (!existsSync(CLI)) throw new Error(`DSH_CLI not found: ${CLI}`)
  if (!existsSync(TARBALL)) throw new Error('Build and pack the package before running visualization smoke')
  if (sidebarSpec !== undefined && !/^dsh-better-sidebar@\d+\.\d+\.\d+$/.test(sidebarSpec)) {
    throw new Error('ATN_SIDEBAR_SPEC must be an exact dsh-better-sidebar version')
  }
  const home = await mkdtemp(join(tmpdir(), 'dsh-atn-visualization-'))
  console.log(`visualization smoke: isolated home=${home}`)
  try {
    const profile = 'atn-visualization'
    await dsh(home, ['--profile', profile, '--from-default-profile', 'web', '--dump-config'])
    await dsh(home, ['plugin', '--profile', profile, 'add', TARBALL])
    if (sidebarSpec !== undefined) await dsh(home, ['plugin', '--profile', profile, 'add', sidebarSpec])
    const observer = join(home, 'profiles', profile, 'visualization-observer.mjs')
    await copyFile(new URL('./visualization-observer.mjs', import.meta.url), observer)
    const overlay = join(home, 'visualization.patch.yml')
    await writeFile(overlay, `- insert:\n    - id: atn-visualization-observer\n      name: ${JSON.stringify(pathToFileURL(observer).href)}\n`, 'utf8')
    const output = await dsh(home, ['--profile', profile, '--patch', overlay, '--no-open', '--port', portText], true)
    if (!output.includes('ATN_VISUALIZATION_SMOKE ')) throw new Error(`Observer did not finish:\n${redact(output).slice(-12_000)}`)
  } finally {
    // A fixed mkdtemp prefix and exact parent check fence every recursive removal.
    const target = resolve(home)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('dsh-atn-visualization-')) {
      throw new Error('Refusing to remove an unexpected smoke directory')
    }
    await rm(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 })
  }
}

await main()
