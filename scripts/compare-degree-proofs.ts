/** Re-derive every historical seed under explicit experimental and default ceilings. */
import { Config, limitsFromConfig } from '../src/config.ts'
import { collaborationPeerLimit } from '../src/topology.ts'
import type { NodeRecord } from '../src/schema.ts'
import { createShiftingEvidenceTask } from '../experiments/shifting-evidence-task.ts'
import { proveTopologyBinding } from '../experiments/topology-binding-proof.ts'

const nodes = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i), {} as NodeRecord]))
const defaultLimits = limitsFromConfig(Config({}))
const rows = [17, 31, 45, 59, 73].flatMap(seed => {
  const task = createShiftingEvidenceTask(8, seed, 2, true)
  return [
    { policy: 'historical-degree-two-ring', ceiling: 2, oldLimit: 2, initialPeers: [7, 1] },
    { policy: 'default-fixed-wide', ceiling: defaultLimits.maxCollaborationPeers, oldLimit: 4, initialPeers: [7, 1, 2, 3] },
  ].map(policy => {
    const newLimit = collaborationPeerLimit({ limits: { ...defaultLimits, maxCollaborationPeers: policy.ceiling }, nodes })
    const derive = (limit: number) => proveTopologyBinding(task, { entrySlot: 0,
      maxCollaborationPeers: limit, initialPeers: policy.initialPeers })
    const before = derive(policy.oldLimit), after = derive(newLimit)
    return { seed, policy: policy.policy, oldLimit: policy.oldLimit, newLimit,
      before: { conclusion: before.conclusion, exceedsStaticDegree: before.exceedsStaticDegree },
      after: { conclusion: after.conclusion, exceedsStaticDegree: after.exceedsStaticDegree },
      conclusionFlipped: before.conclusion !== after.conclusion,
      eligibilityFlipped: (!before.fixedReachable && before.exceedsStaticDegree) !== (!after.fixedReachable && after.exceedsStaticDegree),
      requiredDirectEdgeCount: after.requiredDirectEdgeCount, beforeHash: before.fixtureHash, afterHash: after.fixtureHash }
  })
})
console.log(JSON.stringify({ issuedModelCalls: 0, agents: 8, rows,
  flippedSeeds: [...new Set(rows.filter(row => row.conclusionFlipped || row.eligibilityFlipped).map(row => row.seed))],
  scope: 'Historical five seeds, degree-two ring explicitly frozen and default fixed-wide. Does not establish arbitrary larger-network reachability.' }, null, 2))
