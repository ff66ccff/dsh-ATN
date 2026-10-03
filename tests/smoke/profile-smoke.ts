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
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, access, copyFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

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
  const version = process.env.npm_package_version ?? '0.2.0'
  return join(process.cwd(), '.artifacts', `dsh-atn-${version}.tgz`)
}

async function dsh(home: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  // `dsh` on Windows is a .cmd shim, so the command goes through the shell.
  // stdin is closed: a booted profile must never wait for interactive input.
  const command = [cliPath(), ...args].map((part) => `"${part}"`).join(' ')
  console.log(`  $ ${args.join(' ')}`)
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: home,
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
      if (process.platform === 'win32' && child.pid !== undefined) {
        // The launcher is a .cmd shim; killing only the shell leaves its Web
        // server alive. Restrict termination to this test command's process tree.
        execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => {})
      } else child.kill()
      stderr += `\ndsh timed out after ${TIMEOUT_MS}ms`
    }, TIMEOUT_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ exitCode: 1, stdout, stderr: `${stderr}\n${error.message}` })
    })
  })
}

/** Rows of a composed `--dump-config` document, keyed by row id. */
function rowsOf(config: string): Map<string, string> {
  const rows = load(config, { schema: entryListSchema }) as { id: string }[]
  // Keep each preset's children inside its own row. Repeated child ids such as
  // persona or tool-fs must not hide changes to a different preset.
  return new Map(rows.map(row => [row.id, JSON.stringify(row)]))
}

async function main(): Promise<void> {
  const tarball = tarballPath()
  const registrySpec = process.env.ATN_INSTALL_SPEC
  if (registrySpec !== undefined && !/^dsh-atn@\d+\.\d+\.\d+$/.test(registrySpec)) {
    throw new Error('ATN_INSTALL_SPEC must be an exact dsh-atn version, such as dsh-atn@0.1.0')
  }
  const installSpec = registrySpec ?? tarball
  if (registrySpec === undefined && !existsSync(tarball)) {
    throw new Error(`packed tarball not found at ${tarball}; run "npm run build && npm run pack:tarball" first`)
  }
  if (!existsSync(cliPath())) {
    throw new Error(`No dsh CLI at ${cliPath()}; set DSH_CLI to a launcher and re-run.`)
  }

  const home = await mkdtemp(join(tmpdir(), 'dsh-atn-profile-'))
  const report: StepReport[] = []
  console.log(`profile smoke: home=${home} installSpec=${installSpec}`)
  try {
    const baseName = 'atn-smoke-base'
    const atnName = 'atn-smoke-atn'

    const initBase = await dsh(home, ['--profile', baseName, '--from-default-profile', 'web', '--dump-config'])
    if (initBase.exitCode !== 0) throw new Error(`baseline profile initialization failed: ${initBase.stderr}`)
    report.push({ step: 'PROFILE-01 init base profile', command: `dsh --profile ${baseName} --from-default-profile web --dump-config`, exitCode: 0, detail: 'initialized isolated Web profile' })
    const initAtn = await dsh(home, ['--profile', atnName, '--from-default-profile', 'web', '--dump-config'])
    if (initAtn.exitCode !== 0) throw new Error(`target profile initialization failed: ${initAtn.stderr}`)
    report.push({ step: 'PROFILE-01 init target profile', command: `dsh --profile ${atnName} --from-default-profile web --dump-config`, exitCode: 0, detail: 'initialized isolated Web profile' })

    const before = await dsh(home, ['--profile', baseName, '--dump-config'])
    if (before.exitCode !== 0) throw new Error(`baseline --dump-config failed: ${before.stderr}`)
    const patchBefore = await readFile(join(home, 'profiles', atnName, 'cordis.patch.yml'), 'utf8').catch(() => '')

    const add = await dsh(home, ['plugin', '--profile', atnName, 'add', installSpec])
    if (add.exitCode !== 0) throw new Error(`package install failed: ${add.stderr || add.stdout}`)
    report.push({ step: 'PROFILE-01 install package', command: `dsh plugin --profile ${atnName} add ${installSpec}`, exitCode: add.exitCode, detail: (add.stdout || add.stderr).trim().split(/\r?\n/).slice(-3).join(' | ') })

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
    if (!composed.includes('id: preset-atn')) throw new Error('ATN preset declaration is absent')
    report.push({ step: 'PROFILE-02 loader composes the bundle layer', command: `dsh --profile ${atnName} --dump-config`, exitCode: 0, detail: 'host runtime and standalone ATN preset are present' })

    // Compare complete existing rows, including nested presets, permissions
    // and models. Only the disposable profile's own path is normalized.
    const baseRows = rowsOf(before.stdout)
    const atnRows = rowsOf(composed)
    const normalize = (row: string): string => row.replaceAll(baseName, '<profile>').replaceAll(atnName, '<profile>')
    const removed = [...baseRows.keys()].filter(id => !atnRows.has(id))
    if (removed.length > 0) throw new Error(`the bundle removed rows: ${removed.join(', ')}`)
    const added = [...atnRows.keys()].filter((id) => !['atn', 'preset-atn'].includes(id) && !baseRows.has(id))
    const changed = [...baseRows.keys()].filter((id) => atnRows.has(id) && normalize(atnRows.get(id)!) !== normalize(baseRows.get(id)!))
    if (added.length > 0) throw new Error(`the bundle added unexpected rows: ${added.join(', ')}`)
    if (changed.length > 0) {
      throw new Error(`the bundle changed existing rows: ${changed.join(', ')}`)
    }
    report.push({
      step: 'PROFILE-04 bundle does not override existing rows',
      command: 'diff of --dump-config with and without the bundle',
      exitCode: 0,
      detail: `${baseRows.size} complete pre-existing rows unchanged; only ATN runtime and preset added`,
    })

    // A test-only observer runs after the real Web profile is ready. It uses a
    // scripted adapter, so roster, isolation and ATN calls need no credentials.
    const observer = join(home, 'profiles', atnName, 'preset-observer.mjs')
    await copyFile(new URL('./preset-observer.mjs', import.meta.url), observer)
    const overlay = join(home, 'preset-smoke.patch.yml')
    await writeFile(overlay, `- insert:\n    - id: atn-smoke-observer\n      name: ${JSON.stringify(pathToFileURL(observer).href)}\n`, 'utf8')
    const boot = await dsh(home, ['--profile', atnName, '--patch', overlay, '--no-open', '--port', '0'])
    const bootText = `${boot.stdout}\n${boot.stderr}`.replace(/([?&]token=)[^\s&]+/g, '$1<redacted>')
    if (/Cannot find (module|package)|ERR_MODULE_NOT_FOUND|Cannot find package|invalid plugin|SyntaxError/.test(bootText)) {
      throw new Error(`the profile failed to load the bundle: ${bootText.trim()}`)
    }
    if (boot.exitCode !== 0 || !boot.stdout.includes('ATN_PRESET_SMOKE ')) throw new Error(`ATN preset smoke failed: ${bootText.trim().slice(-8000)}`)
    report.push({
      step: 'PRESET Web roster, scoped model requests and child creation (partial PROFILE-03)',
      command: `dsh --profile ${atnName} --patch <observer> --no-open --port 0`,
      exitCode: boot.exitCode,
      detail: boot.stdout.split(/\r?\n/).find(line => line.startsWith('ATN_PRESET_SMOKE '))!,
    })

    const patchAfter = await readFile(join(home, 'profiles', atnName, 'cordis.patch.yml'), 'utf8').catch(() => '')
    if (patchAfter !== patchBefore) {
      report.push({ step: 'PROFILE-04 user patch untouched', command: 'read profile cordis.patch.yml', exitCode: 1, detail: 'the profile patch changed during install' })
      throw new Error('installing the bundle modified the profile\'s own cordis.patch.yml')
    }
    report.push({ step: 'PROFILE-04 user patch untouched', command: 'read profile cordis.patch.yml', exitCode: 0, detail: 'unchanged' })

    console.log(JSON.stringify({ installSpec, home, steps: report }, null, 2))
  } finally {
    await rm(home, { recursive: true, force: true })
    await access(home).then(
      () => console.error(`WARNING: temporary home ${home} still exists`),
      () => undefined,
    )
  }
}

await main()
