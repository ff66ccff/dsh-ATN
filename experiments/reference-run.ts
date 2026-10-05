/** Offline deterministic baseline. No adapter, network request or model loop. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { strict as assert } from 'node:assert'
import type { Config } from '../src/config.ts'
import { getTopologyTask, TopologyScenario, type TopologyTaskId } from './topology-task.ts'
import { provisionTopologyScenario, advanceTopologyScenario } from './topology-host.ts'
import { evaluateTopologyTask } from './topology-evaluation.ts'
import { referenceKernel } from './reference-kernel.ts'
import { createAtnCostMeter } from './atn-cost.ts'
import { createReferenceNodeState, referencePolicies, REFERENCE_POLICIES, type ReferencePolicyName } from './reference-policy.ts'

export interface ReferenceOptions {
  policy: ReferencePolicyName
  task?: TopologyTaskId
  agents?: number
  limits?: Partial<Config>
  /** One ACL read or runtime action per admitted step: conservative tool-step proxy. */
  enforceSteps?: boolean
  maxActions?: number
  recoveryMode?: 'self-organized' | 'preassigned-backup'
}

export async function runReference(options: ReferenceOptions) {
  const scenario = new TopologyScenario(getTopologyTask(options.task ?? 'shift-ledger-1', options.agents ?? 8), { recoveryMode: options.recoveryMode })
  const directory = await mkdtemp(join(tmpdir(), 'atn-reference-'))
  let kernel: Awaited<ReturnType<typeof referenceKernel>>
  try { kernel = await referenceKernel(directory, scenario, options.limits) }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  const { ctx, entry } = kernel
  const costs = createAtnCostMeter()
  let aggregateOnly = true
  const seenPayloads = new Set<string>()
  ctx.on('atn/network-updated', ({ record }) => {
    costs.observe(record)
    for (const mail of Object.values(record.mails)) {
      if (seenPayloads.has(mail.id)) continue
      seenPayloads.add(mail.id)
      if (/s\d+-(?:e\d+|late\d+)/.test(mail.body)) aggregateOnly = false
      let data: { type?: string; subtotals?: unknown[] }
      try { data = JSON.parse(mail.body) } catch { continue }
      if (data?.type !== 'reference-subtotals') continue
      if (!Array.isArray(data.subtotals) || !data.subtotals.every(value => {
        if (!value || typeof value !== 'object') return false
        const part = value as Record<string, unknown>
        const totals = part.netByAccount as Record<string, unknown> | undefined
        return Object.keys(part).sort().join(',') === 'appliedEntries,netByAccount,slots'
          && Array.isArray(part.slots) && part.slots.every(Number.isSafeInteger)
          && Number.isSafeInteger(part.appliedEntries) && !!totals
          && Object.keys(totals).sort().join(',') === 'A,B,C,D' && Object.values(totals).every(Number.isSafeInteger)
      })) aggregateOnly = false
    }
  }, { global: true })
  const states = new Map<string, ReturnType<typeof createReferenceNodeState>>()
  const actionsByNode: Record<string, number> = {}
  let delivered = false
  let answer = ''
  let failure: string | null = null
  let actions = 0
  let finalLimits: unknown
  let rewires = 0
  let claims = 0
  let quiescent = false
  try {
    await provisionTopologyScenario(ctx, entry, scenario)
    const networkId = ctx.atn.networkForSession(entry.id)!
    finalLimits = (await ctx.atn.network(networkId)).limits
    for (let round = 0; round < 512 && !delivered; round++) {
      if (scenario.readyForPhaseChange) await advanceTopologyScenario(ctx, entry, scenario, () => false, { wake: false })
      const start = await ctx.atn.network(networkId)
      let progressed = false
      for (const initial of Object.values(start.nodes)) {
        const record = await ctx.atn.network(networkId)
        const node = record.nodes[initial.id]
        if (node.lifecycle !== 'active') continue
        const agent = ctx.agents.list().find(candidate => candidate.id === node.sessionId)!
        const state = states.get(node.id) ?? createReferenceNodeState()
        states.set(node.id, state)
        const action = await referencePolicies[options.policy]({ node, nodes: record.nodes, entryNodeId: record.entryNodeId,
          goalVersion: record.goalHistory.at(-1)!.version, phase: scenario.snapshot().phase,
          inbox: Object.values(record.mails).filter(mail => mail.toId === node.id && mail.status === 'delivered'),
          tasks: Object.values(record.tasks), state,
          canDeliver: quiescent && !Object.values(record.tasks).some(task => task.status === 'open' && task.holderId !== node.id)
            && !Object.values(record.mails).some(mail => mail.status === 'queued')
            && !Object.values(record.proposals).some(proposal => proposal.status === 'pending'),
        }, scenario)
        if (!action) continue
        if (actions >= (options.maxActions ?? 4096)) throw new Error('reference-action-limit')
        if (options.enforceSteps && !await ctx.atn.admitStep(networkId, agent.id)) throw new Error(`reference-step-limit:${node.id}`)
        actionsByNode[node.id] = (actionsByNode[node.id] ?? 0) + 1
        actions++
        progressed = true
        if (action.type === 'send') await ctx.atn.send(agent, action.input)
        else if (action.type === 'rewire') { await ctx.atn.rewire(agent, action.input); rewires++ }
        else if (action.type === 'claim') { await ctx.atn.status(agent, { claimTaskId: action.taskId }); claims++ }
        else if (action.type === 'deliver') {
          answer = action.input.summary
          const result = await ctx.atn.deliver(agent, action.input)
          if (!result.accepted) throw new Error(result.reason ?? 'delivery-refused')
          delivered = evaluateTopologyTask(scenario.task, answer).passed
          if (!delivered) throw new Error('reference-oracle-failed')
          break
        }
      }
      if (!progressed && !scenario.readyForPhaseChange) {
        if (quiescent) throw new Error('reference-stalled')
        quiescent = true
      } else quiescent = false
    }
    if (!delivered) throw new Error('reference-round-limit')
  } catch (error) { failure = error instanceof Error ? error.message : String(error) }
  finally {
    await ctx.fiber.dispose()
    // mkdtemp-owned directory only; never remove caller output directories.
    await rm(directory, { recursive: true, force: true })
  }
  assert.equal(kernel.modelCalls(), 0, 'Reference run issued a model request')
  assert.equal(aggregateOnly, true, 'Reference payload must contain only aggregate vectors and provenance')
  return { policy: options.policy, task: scenario.task.id, agents: scenario.task.agents,
    delivered, issuedModelCalls: kernel.modelCalls(), aggregateOnly, ...costs.snapshot(), actions, actionsByNode,
    maxNodeActions: Math.max(0, ...Object.values(actionsByNode)), stepProxyEnforced: !!options.enforceSteps,
    limits: finalLimits, rewires, claims, failure, answer: answer || null, manipulation: scenario.snapshot() }
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'experiments/results/reference-baseline.json' } } })
  const results = []
  for (const policy of REFERENCE_POLICIES) results.push(await runReference({ policy }))
  const report = { version: 1, issuedModelCalls: 0,
    measurement: 'All durable ATN mail, including setup/control/result envelopes. Each delivered edge is one hop; forwarding is counted again. Context proxy excludes shared prompts and tool outputs.',
    interpretation: 'Achievable deterministic policies, not a proven global optimum or a claim about model performance. Actions do not consume model steps unless stepProxyEnforced is true.', results }
  const output = resolve(values.out)
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.table(results.map(({ policy, delivered, messages, hops, maxContextBytes, maxNodeActions, failure }) =>
    ({ policy, delivered, messages, hops, maxContextBytes, maxNodeActions, failure })))
  assert.ok(results.every(result => result.delivered), 'All reference policies must deliver')
  assert.ok(results[0].messages < results[1].messages, 'Hub must use fewer messages than gossip')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1 })
}
