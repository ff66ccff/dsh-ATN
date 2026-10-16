/** Repository host adapter. Only this host assembly uses the repository's kernel fixture. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootKernel, createHostAgent, settle } from './kernel.ts'
import { makeChain, makeTask } from './network.ts'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { OUTBOUND_CHANNELS, INFORMATION_BOUNDARY_REFUSAL_CODES, defineSubstrateReadPolicy } from '../../src/index.ts'
import { createExampleCustodyPolicy } from '../../examples/information-boundary-policy.ts'
import { allowUnowned, asynchronous } from '../../conformance/negative-fixtures.mjs'
import type { ConformanceAdapter } from '../../conformance/index.mjs'

export function createConformanceAdapter(mode: 'correct' | 'allow-unowned' | 'async' = 'correct'): ConformanceAdapter {
 return { vocabulary: { channels: OUTBOUND_CHANNELS, codes: INFORMATION_BOUNDARY_REFUSAL_CODES }, open: async spec => {
  const scratch = await mkdtemp(join(tmpdir(), 'atn-conformance-'))
  const record = makeChain(['A', 'B', 'C'])
  record.nodes.C.lifecycle = 'failed'
  record.tasks.done = makeTask('done', { status: 'completed', result: { summary: 'Done', evidence: [] }, settledAt: 1, settledBy: 'B' })
  record.tasks.orphan = makeTask('orphan', { holderId: 'C', status: 'unreachable', settledAt: 1 })
  record.tasks.hidden = makeTask('hidden', { requesterId: 'B', holderId: 'C' })
  if (spec.channel !== 'status.claim') record.tasks.open = makeTask('open')
  else delete record.tasks.hidden // caller B must have no open work to claim
  if (spec.contract === 'capacity') record.limits = { ...record.limits, maxSubstrateMessages: 1 }
  const store = new MemoryNetworkStore([record]), kernel = await bootKernel(scratch, { store, clock: () => 100 })
  try {
   const a = await createHostAgent(kernel, 'session-A'), b = await createHostAgent(kernel, 'session-B'), newcomer = await createHostAgent(kernel, 'conformance-new')
   let proposalId = ''
   if (spec.channel === 'vote') {
    proposalId = (await kernel.atn.propose(a, { document: { ...record.goalHistory[0].document, plan: 'update' }, rationale: 'update' })).proposalId
    await settle(kernel)
    for (const mail of Object.values((await kernel.atn.network(record.id)).mails)) await kernel.atn.deliverMail(record.id, mail.id)
   }
   const marker = `claim:${spec.held ? 'owned-document' : 'foreign-document'}`
   const aliases = new Map<string, string>()
   if (spec.channel === 'status.claim') aliases.set('orphan', spec.held ? 'owned-document' : 'foreign-document')
   if (spec.channel === 'status.rewire') aliases.set('B', spec.held ? 'owned-document' : 'foreign-document')
   const custody = () => ['owned-document']
   if (spec.contract !== 'artifact-no-policy') kernel.atn.installOutboundPolicy(spec.channel === 'start' ? '*' : record.id,
    mode === 'allow-unowned' ? allowUnowned(custody) : mode === 'async' ? asynchronous() : createExampleCustodyPolicy(custody, aliases))
   const publish = (refs: string[], rationale = refs.join(' ')) => kernel.atn.publish(a, { sub_task: 'parser', artifact: 'parser', rationale: rationale || 'local', refs })
   let exercise: () => Promise<unknown>
   const goal = { objective: marker, successCriteria: 'Grounded', constraints: '' }
   switch (spec.channel) {
    case 'start': exercise = () => kernel.atn.start(newcomer, goal); break
    case 'spawn': exercise = () => kernel.atn.spawn(a, { task: marker, context: '' }); break
    case 'send.task': exercise = () => kernel.atn.send(a, { to: 'B', kind: 'task', body: marker }); break
    case 'send.note': exercise = () => kernel.atn.send(a, { to: 'B', kind: 'note', body: marker }); break
    case 'send.result': exercise = () => kernel.atn.send(b, { to: 'A', kind: 'result', taskId: 'open', body: marker, summary: marker, evidence: [] }); break
    case 'status.review': exercise = () => kernel.atn.status(a, { review: { taskId: 'done', status: 'accepted', summary: marker, evidence: ['check'] } }); break
    case 'status.claim': exercise = () => kernel.atn.status(b, { claimTaskId: 'orphan' }); break
    case 'status.rewire': exercise = () => kernel.atn.status(a, { rewire: { peers: ['B'] } }); break
    case 'finish.node': exercise = () => kernel.atn.finish(b, marker); break
    case 'finish.network': exercise = () => kernel.atn.deliver(a, { summary: marker, evidence: [], goalVersion: 1 }); break
    case 'propose': exercise = () => kernel.atn.propose(a, { document: { ...record.goalHistory[0].document, plan: marker }, rationale: marker }); break
    case 'vote': exercise = () => kernel.atn.vote(b, { proposalId, approve: true, reason: marker }); break
    case 'renew': exercise = () => kernel.atn.renew(b, { taskId: 'open', extendMs: 100, basis: marker }); break
    case 'publish': exercise = () => kernel.atn.publish(a, { sub_task: 'parser', artifact: marker, rationale: 'local' }); break
    default: {
     if (spec.field) exercise = () => kernel.atn.send(a, { to: 'B', kind: 'task', body: 'Check',
      ...(spec.field === 'dependsOn' ? { dependsOn: [marker] } : { [spec.field!]: marker }) })
     else if (spec.contract.startsWith('read-policy')) {
      await publish([])
      if (spec.contract !== 'read-policy-missing') kernel.atn.installSubstrateReadPolicy(record.id,
       spec.contract === 'read-policy-throw' ? () => { throw new Error('host fault') }
        : spec.contract === 'read-policy-async' ? (async () => new Set<string>()) as any
        : defineSubstrateReadPolicy({ principalFor: () => undefined, decide: () => ({ kind: 'allow' }) }))
      exercise = () => kernel.atn.visit(a, { addresses: ['msg:1'] })
     } else {
      if (['msg-existing', 'msg-future', 'msg-self', 'rationale', 'capacity'].includes(spec.contract)) await publish([])
      const refs: Record<string, string[]> = { 'msg-existing': ['msg:1'], 'msg-future': ['msg:9'], 'msg-self': ['msg:2'],
       'task-visible': ['task:open'], 'task-hidden': ['task:hidden'], 'task-missing': ['task:missing'],
       'artifact-owned': ['artifact:owned-document'], 'artifact-unowned': ['artifact:foreign-document'],
       'artifact-no-policy': ['artifact:owned-document'], 'rationale': ['msg:1'], 'capacity': [] }
      exercise = () => publish(refs[spec.contract], spec.contract === 'rationale' ? 'not named' : undefined)
     }
    }
   }
   return { exercise,
    snapshot: async () => ({ record: await kernel.atn.network(record.id), networks: await store.list(), writes: store.writes,
     agents: kernel.ctx.agents.list().map(agent => ({ id: agent.id, events: agent.session.snapshotEvents() })), requests: kernel.model.requests.length }),
    close: async () => { await settle(kernel); await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }) },
   }
  } catch (error) { await kernel.ctx.fiber.dispose(); await rm(scratch, { recursive: true, force: true }); throw error }
 } }
}
