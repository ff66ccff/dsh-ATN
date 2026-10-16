/** Offline classifier. No provider, account, network or runtime imports. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

export const SEMANTICS_PATH = 'docs/PROBE_LIVENESS_EVENT_SEMANTICS_V2.md'
export const sha256 = (raw: string | Uint8Array) => createHash('sha256').update(raw).digest('hex')
export const lines = (raw: string): Record<string, any>[] => raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
export interface SemanticGate { complete: true; sha256: string; path: string; code?: { path: string; sha256: string }[] }
export async function establishSemantics(): Promise<SemanticGate> {
  const raw = await readFile(SEMANTICS_PATH, 'utf8')
  for (const name of ['mail.state queued', 'mail.state delivered', 'step/start', 'step/end', 'model.start', 'model.end',
    'turn/start', 'turn/end', 'task.state', 'node.state', 'tool.start', 'tool.end']) {
    const row = raw.split('\n').find(line => line.startsWith(`| ${name} |`))
    assert.ok(row && row.split('|').length === 7 && /(?:src\/|node_modules\/|experiments\/).*:\d+/.test(row), `Missing semantic row: ${name}`)
  }
  assert.match(raw, /sequence 不是可靠代理/)
  assert.match(raw, /替代锚点/)
  const paths = ['src/runtime.ts', 'src/mailbox.ts', 'experiments/telemetry.ts',
    'node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js', 'node_modules/@deepseek-ai/dsh-session/lib/index.js',
    'node_modules/@deepseek-ai/dsh-llm/lib/index.js']
  const sources = await Promise.all(paths.map(async path => ({ path, raw: await readFile(path, 'utf8') })))
  const runtime = sources[0].raw, loop = sources[3].raw, telemetry = sources[2].raw
  const delivery = runtime.slice(runtime.indexOf('  async deliverMail('), runtime.indexOf('  private alreadyQueued('))
  assert.ok(delivery.indexOf("if (mail.status !== 'queued') return mail.status") < delivery.indexOf('agent.send('))
  assert.ok(delivery.indexOf('flushInputReceipt(agent, message)') < delivery.indexOf('markDelivered(current, mailId'))
  assert.match(runtime, /if \(!this.hasLoggedInput\(agent, marker\)\) return false/)
  assert.ok(loop.indexOf('this.session.append("step/start"') < loop.indexOf('this.session.append("user/message", message'))
  assert.ok(loop.indexOf('this.session.append("user/message", message') < loop.indexOf('const stream = preparedCall?.stream(request)'))
  assert.ok(telemetry.indexOf("emit('model.start'") < telemetry.indexOf('for await (const chunk of next())'))
  return { complete: true, sha256: sha256(raw), path: SEMANTICS_PATH,
    code: sources.map(source => ({ path: source.path, sha256: sha256(source.raw) })) }
}
export interface MailFacts {
  mail: string; input: boolean; modelStarted: boolean; delivered: boolean; terminalAtDelivery: boolean
}
export function classifyMail(gate: SemanticGate, facts: MailFacts) {
  assert.equal(gate?.complete, true, 'Semantic gate must precede classification')
  if (!facts.input) {
    assert.equal(facts.delivered, false, '7.4: delivered mail without a uniquely associated input')
    assert.equal(facts.modelStarted, false)
    assert.equal(facts.terminalAtDelivery, true, '7.1: queued without input requires admission/retry evidence')
    return { category: 'unreachable', defect: false } as const
  }
  if (!facts.modelStarted) return { category: 'input-without-model', defect: true } as const
  if (!facts.delivered) return { category: 'receipt-missing', defect: true } as const
  return { category: 'normal-receipt', defect: false } as const
}
export function verdict(gate: SemanticGate, support: ReturnType<typeof classifyMail>[]) {
  assert.equal(gate?.complete, true)
  assert.ok(support.length)
  return support.some(row => row.defect) ? 'mechanism-gap' : 'no-wake-eligible-work'
}
export const exactlyOne = <T>(rows: T[], why: string): T => {
  assert.equal(rows.length, 1, `7.4: ${why}; matches=${rows.length}`)
  return rows[0]
}
