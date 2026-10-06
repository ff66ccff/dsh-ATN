/** Pure fixture-bound direct-edge proof. No runtime, provider or behavioral observations. */
import { createHash } from 'node:crypto'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createShiftingEvidenceTask, expectedChain, type ShiftingEvidenceTask } from './shifting-evidence-task.ts'

export interface BindingTopology { entrySlot: number; maxCollaborationPeers: number; initialPeers: number[] }
export function initialBindingTopology(agents: number): BindingTopology {
  return { entrySlot: 0, maxCollaborationPeers: 2, initialPeers: [agents - 1, 1] }
}
export function proveTopologyBinding(task: ShiftingEvidenceTask, topology = initialBindingTopology(task.agents)) {
  if (!Number.isSafeInteger(topology.entrySlot) || topology.entrySlot < 0 || topology.entrySlot >= task.agents ||
    !Number.isSafeInteger(topology.maxCollaborationPeers) || topology.maxCollaborationPeers < 1 ||
    !Array.isArray(topology.initialPeers) || topology.initialPeers.length > topology.maxCollaborationPeers ||
    new Set(topology.initialPeers).size !== topology.initialPeers.length || topology.initialPeers.some(slot =>
      !Number.isSafeInteger(slot) || slot < 0 || slot >= task.agents || slot === topology.entrySlot)) throw new Error('Invalid binding topology')
  const requiredFacts = ([1, 2] as const).flatMap(phase => expectedChain(task, phase).chain.map(row => ({
    phase, key: row.key, document: row.document, holder: task.phases[phase - 1].holders[row.key],
  })))
  if (requiredFacts.some(row => !Number.isSafeInteger(row.holder) || row.holder < 0 || row.holder >= task.agents)) throw new Error('Invalid fact holder')
  const holders = [...new Set(requiredFacts.map(row => row.holder))].filter(slot => slot !== topology.entrySlot).sort((a, b) => a - b)
  const requiredDirectEdges = holders.map(to => ({ from: topology.entrySlot, to }))
  const unreachableFacts = requiredFacts.filter(row => row.holder !== topology.entrySlot && !topology.initialPeers.includes(row.holder))
  const fixedReachable = task.topologyBinding === true && unreachableFacts.length === 0
  return { version: 1, seed: task.seed, agents: task.agents, chainLength: task.chainLength, taskRevision: task.revision,
    topologyBinding: task.topologyBinding === true, topology: structuredClone(topology),
    fixtureHash: createHash('sha256').update(JSON.stringify({ task, topology })).digest('hex'),
    requiredFacts, initialOutdegreeLimit: topology.maxCollaborationPeers, requiredDirectEdges,
    requiredDirectEdgeCount: requiredDirectEdges.length, exceedsStaticDegree: requiredDirectEdges.length > topology.maxCollaborationPeers,
    unreachableFacts, fixedReachable, conclusion: task.topologyBinding !== true ? 'unbound' : fixedReachable ? 'reachable' : 'unreachable',
    argument: 'Only the exact local owner may answer a fact request. The entry needs every listed owner edge across both phases. A fixed edge set cannot rotate; adaptive edges may rotate sequentially within the degree bound.' }
}
export type TopologyBindingProof = ReturnType<typeof proveTopologyBinding>
export function verifyTopologyBindingProof(task: ShiftingEvidenceTask, proof: unknown, topology = initialBindingTopology(task.agents)): proof is TopologyBindingProof {
  try { return isDeepStrictEqual(proof, proveTopologyBinding(task, topology)) } catch { return false }
}
export function isComparisonSeed(task: ShiftingEvidenceTask, proof: unknown, topology = initialBindingTopology(task.agents)) {
  return verifyTopologyBindingProof(task, proof, topology) && proof.topologyBinding && !proof.fixedReachable && proof.exceedsStaticDegree
}

async function main() {
  const { values } = parseArgs({ options: { seeds: { type: 'string', default: '17,31,45,59,73' },
    agents: { type: 'string', default: '8' }, 'chain-length': { type: 'string', default: '2' },
    out: { type: 'string', default: 'experiments/results/topology-binding-proof-20261006.json' } } })
  const proofs = values.seeds.split(',').map(Number).map(seed => {
    const task = createShiftingEvidenceTask(Number(values.agents), seed, Number(values['chain-length']), true)
    return proveTopologyBinding(task)
  })
  const result = { version: 1, issuedModelCalls: 0, proofs,
    eligibleSeeds: proofs.filter(row => !row.fixedReachable && row.exceedsStaticDegree).map(row => row.seed),
    ineligibleSeeds: proofs.filter(row => row.fixedReachable || !row.exceedsStaticDegree).map(row => row.seed) }
  await mkdir(dirname(resolve(values.out)), { recursive: true })
  await writeFile(resolve(values.out), JSON.stringify(result, null, 2) + '\n')
  for (const proof of proofs) console.log(JSON.stringify({ seed: proof.seed, requiredFacts: proof.requiredFacts,
    initialOutdegreeLimit: proof.initialOutdegreeLimit, requiredDirectEdgeCount: proof.requiredDirectEdgeCount,
    conclusion: proof.conclusion, eligible: !proof.fixedReachable && proof.exceedsStaticDegree, fixtureHash: proof.fixtureHash }))
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error); process.exitCode = 1 })
