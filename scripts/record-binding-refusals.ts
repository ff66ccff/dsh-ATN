/** Repeatable, zero-model compatibility record for the topology-binding policy. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { referenceKernel } from '../experiments/reference-kernel.ts'
import { provisionShifting, shiftingConfig } from '../experiments/shifting-evidence-reference.ts'
import { createShiftingEvidenceTask, ShiftingEvidenceScenario } from '../experiments/shifting-evidence-task.ts'
import { installTopologyBindingAccess } from '../experiments/topology-binding-access.ts'
import { AtnRefusal, type SendInput } from '../src/runtime.ts'

export async function recordBindingRefusals() {
  const directory = await mkdtemp(join(tmpdir(), 'atn-binding-compat-'))
  const scenario = new ShiftingEvidenceScenario(createShiftingEvidenceTask(8, 17, 2, true))
  const kernel = await referenceKernel(directory, scenario, shiftingConfig(8, 48, 30_000))
  try {
    const network = await provisionShifting(kernel.ctx, kernel.entry, scenario)
    const policy = installTopologyBindingAccess(kernel.ctx.atn, network.networkId, scenario)
    const fact = scenario.task.phases[0].facts[0]
    const request = await kernel.ctx.atn.send(kernel.entry, { to: network.ids[1], kind: 'task',
      body: JSON.stringify({ phase: 1, key: fact.key }) })
    const setup = Object.values((await kernel.ctx.atn.network(network.networkId)).tasks)
      .find(task => task.holderId === network.ids[1] && task.requesterId === network.nodeId)!
    const cases: { name: string; sender: number; input: SendInput }[] = [
      { name: 'note', sender: 0, input: { to: network.ids[1], kind: 'note', body: JSON.stringify(fact) } },
      { name: 'messageId', sender: 0, input: { to: network.ids[1], kind: 'task', body: '{}', messageId: 'secret' } },
      { name: 'dependsOn', sender: 0, input: { to: network.ids[1], kind: 'task', body: '{}', dependsOn: ['secret'] } },
      { name: 'retryOf', sender: 0, input: { to: network.ids[1], kind: 'task', body: '{}', retryOf: 'secret' } },
      { name: 'request-payload', sender: 0, input: { to: network.ids[1], kind: 'task', body: JSON.stringify(fact) } },
      { name: 'not-holder', sender: 2, input: { to: network.nodeId, kind: 'result', taskId: request.settledTaskId!,
        body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] } },
      { name: 'setup-payload', sender: 1, input: { to: network.nodeId, kind: 'result', taskId: setup.id,
        body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] } },
      { name: 'unowned-result', sender: 1, input: { to: network.nodeId, kind: 'result', taskId: request.settledTaskId!,
        body: JSON.stringify(fact), summary: JSON.stringify(fact), evidence: [fact.id] } },
    ]
    const outcomes: { name: string; code: string }[] = []
    for (const row of cases) {
      try { await kernel.ctx.atn.send(network.agents[row.sender], row.input); outcomes.push({ name: row.name, code: 'ALLOWED' }) }
      catch (error) { outcomes.push({ name: row.name, code: error instanceof AtnRefusal ? error.code : String(error) }) }
    }
    return { causalClaim: false, modelCalls: kernel.modelCalls(), outcomes, policy: policy.snapshot() }
  } finally { await kernel.ctx.fiber.dispose(); await rm(directory, { recursive: true, force: true }) }
}

if (process.argv[1]?.endsWith('record-binding-refusals.ts')) {
  const output = process.argv[2]
  if (!output) throw new Error('Pass an output JSON path')
  await writeFile(output, JSON.stringify(await recordBindingRefusals(), null, 2) + '\n')
}
