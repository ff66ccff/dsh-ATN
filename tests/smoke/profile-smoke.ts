/**
 * PROFILE smoke: install the packed tarball into a real `dsh` profile in an
 * isolated Harness home and verify what the launcher composes.
 *
 * This script never touches the user's own Harness home, credentials or
 * sessions: every path is created under a fresh temporary directory and removed
 * afterwards. It requires a `dsh` CLI; point `DSH_CLI` at it or rely on the
 * default DeepSeek Desktop launcher path.
 *
 * Run with: npm run smoke:profile
 * @module dsh-atn/tests/smoke/profile-smoke
 */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Per-command timeout; the launcher must never wait for interactive input. */
const TIMEOUT_MS = 180_000

const DEFAULT_DSH_CLI = 'D:\\DeepSeekDesktop\\resources\\runtime\\cli\\bin\\dsh.cmd'

interface StepReport {
  step: string
  command: string
  exitCode: number
  detail: string
}

function cliPath(): string {
  return process.env.DSH_CLI ?? DEFAULT_DSH_CLI
}

function tarballPath(): string {
  const version = process.env.npm_package_version ?? '0.1.0'
  return join(process.cwd(), '.artifacts', `dsh-atn-${version}.tgz`)
}

async function dsh(home: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // `dsh` on Windows is a .cmd shim, so the command goes through the shell.
  // stdin is closed: a booted profile must never wait for interactive input.
  const command = [cliPath(), ...args].map((part) => `"${part}"`).join(' ')
  console.log(`  $ ${args.join(' ')}`)
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|TOKEN|SECRET|CREDENTIAL|PASSWORD|^DSH_/i.test(key))), DSH_HOME: home },
      windowsHide: true,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    const timer = setTimeout(() => {
      child.kill()
      stderr += `\ndsh timed out after ${TIMEOUT_MS}ms`
    }, TIMEOUT_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
  })
}

/** Rows of a composed `--dump-config` document, keyed by row id. */
function rowsOf(config: string): Map<string, string> {
  const rows = new Map<string, string>()
  let current: string | null = null
  for (const line of config.split(/\r?\n/)) {
    const id = /^\s*-\s+id:\s*(\S+)/.exec(line)
    if (id) {
      current = id[1]!
      rows.set(current, line.trim())
      continue
    }
    if (current !== null) rows.set(current, `${rows.get(current)!}\n${line}`)
  }
  return rows
}

async function main(): Promise<void> {
  const tarball = tarballPath()
  if (!existsSync(tarball)) {
    throw new Error(`packed tarball not found at ${tarball}; run "npm run build && npm run pack:tarball" first`)
  }
  if (!existsSync(cliPath())) {
    throw new Error(`No dsh CLI at ${cliPath()}; set DSH_CLI to a launcher and re-run.`)
  }

  const home = await mkdtemp(join(tmpdir(), 'dsh-atn-profile-'))
  const report: StepReport[] = []
  console.log(`profile smoke: home=${home} tarball=${tarball}`)
  try {
    const baseName = 'atn-smoke-base'
    const atnName = 'atn-smoke-atn'

    const initBase = await dsh(home, ['--profile', baseName, '--from-default-profile', 'headless'])
    report.push({ step: 'PROFILE-01 init base profile', command: `dsh --profile ${baseName} --from-default-profile headless`, exitCode: initBase.exitCode, detail: (initBase.stderr || initBase.stdout).trim().slice(0, 200) })
    const initAtn = await dsh(home, ['--profile', atnName, '--from-default-profile', 'headless'])
    report.push({ step: 'PROFILE-01 init target profile', command: `dsh --profile ${atnName} --from-default-profile headless`, exitCode: initAtn.exitCode, detail: (initAtn.stderr || initAtn.stdout).trim().slice(0, 200) })

    const before = await dsh(home, ['--profile', baseName, '--dump-config'])
    if (before.exitCode !== 0) throw new Error(`baseline --dump-config failed: ${before.stderr}`)
    const patchBefore = await readFile(join(home, 'profiles', atnName, 'cordis.patch.yml'), 'utf8').catch(() => '')

    const add = await dsh(home, ['plugin', '--profile', atnName, 'add', tarball])
    if (add.exitCode !== 0) throw new Error(`tarball install failed: ${add.stderr || add.stdout}`)
    report.push({ step: 'PROFILE-01 install tarball', command: `dsh plugin --profile ${atnName} add ${tarball}`, exitCode: add.exitCode, detail: (add.stdout || add.stderr).trim().split(/\r?\n/).slice(-3).join(' | ') })

    const manifest = JSON.parse(await readFile(join(home, 'profiles', atnName, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    const bundles = manifest.dsh?.profile?.bundles ?? []
    if (!bundles.includes('dsh-atn')) throw new Error('dsh-atn did not join the profile bundle list')
    report.push({ step: 'PROFILE-01 bundle list', command: 'read profile manifest', exitCode: 0, detail: bundles.join(', ') })

    const after = await dsh(home, ['--profile', atnName, '--dump-config'])
    if (after.exitCode !== 0) throw new Error(`--dump-config failed: ${after.stderr}`)
    const composed = after.stdout
    for (const needle of ['# == dsh-atn', 'name: dsh-atn', 'name: dsh-atn/tools']) {
      if (!composed.includes(needle)) throw new Error(`composed config is missing "${needle}"`)
    }
    report.push({ step: 'PROFILE-02 loader composes the bundle layer', command: `dsh --profile ${atnName} --dump-config`, exitCode: 0, detail: 'rows atn and atn-tools are present' })

    // PROFILE-04: the bundle adds rows and changes nothing else about the profile.
    // Only the row identity line (id + plugin name) is compared: `!!js`
    // expressions in the composed document are evaluated in the profile's own
    // context, so comparing raw bodies would compare generated text.
    const baseRows = rowsOf(before.stdout)
    const atnRows = rowsOf(composed)
    const identity = (row: string): string => row.split('\n').filter(line => /^\s*-?\s*(id|name):/.test(line)).map(line => line.trim()).join('|')
    const removed = [...baseRows.keys()].filter(id => !atnRows.has(id))
    if (removed.length > 0) throw new Error(`the bundle removed rows: ${removed.join(', ')}`)
    const added = [...atnRows.keys()].filter((id) => id !== 'atn' && id !== 'atn-tools' && !baseRows.has(id))
    const changed = [...baseRows.keys()].filter((id) => atnRows.has(id) && identity(atnRows.get(id)!) !== identity(baseRows.get(id)!))
    if (added.length > 0) throw new Error(`the bundle added unexpected rows: ${added.join(', ')}`)
    if (changed.length > 0) {
      const detail = changed.map((id) => `${id}\n  before: ${identity(baseRows.get(id)!)}\n  after:  ${identity(atnRows.get(id)!)}`).join('\n')
      throw new Error(`the bundle changed existing row identities:\n${detail}`)
    }
    report.push({
      step: 'PROFILE-04 bundle does not override existing rows',
      command: 'diff of --dump-config with and without the bundle',
      exitCode: 0,
      detail: `${baseRows.size} pre-existing row identities unchanged; only atn and atn-tools added`,
    })

    // PROFILE-02: the profile actually boots the composed tree. There is no
    // credential in the isolated home, so a boot that reaches the provider and
    // reports a missing key verifies launch reached the provider check. The
    // separate kernel integration tests verify ATN service and tools activation.
    const boot = await dsh(home, ['--profile', atnName, 'noop'])
    const bootText = `${boot.stdout}\n${boot.stderr}`
    if (/Cannot find (module|package)|ERR_MODULE_NOT_FOUND|Cannot find package|invalid plugin|SyntaxError/.test(bootText)) {
      throw new Error(`the profile failed to load the bundle: ${bootText.trim()}`)
    }
    if (!/MISSING_CREDENTIAL|no API key/.test(bootText)) {
      throw new Error(`expected the boot to stop at the provider credential check, got: ${bootText.trim().slice(0, 400)}`)
    }
    report.push({
      step: 'PROFILE-02 profile boots to provider credential check',
      command: `dsh --profile ${atnName} noop`,
      exitCode: boot.exitCode,
      detail: bootText.trim().split(/\r?\n/).slice(-2).join(' | ').slice(0, 200),
    })

    const patchAfter = await readFile(join(home, 'profiles', atnName, 'cordis.patch.yml'), 'utf8').catch(() => '')
    if (patchAfter !== patchBefore) {
      report.push({ step: 'PROFILE-04 user patch untouched', command: 'read profile cordis.patch.yml', exitCode: 1, detail: 'the profile patch changed during install' })
      throw new Error('installing the bundle modified the profile\'s own cordis.patch.yml')
    }
    report.push({ step: 'PROFILE-04 user patch untouched', command: 'read profile cordis.patch.yml', exitCode: 0, detail: 'unchanged' })

    console.log(JSON.stringify({ tarball, home, steps: report }, null, 2))
  } finally {
    await rm(home, { recursive: true, force: true })
    await access(home).then(
      () => console.error(`WARNING: temporary home ${home} still exists`),
      () => undefined,
    )
  }
}

await main()
