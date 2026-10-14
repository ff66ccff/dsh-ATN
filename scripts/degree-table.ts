/** Offline default-config degree table, using the same runtime limit function. */
import { collaborationPeerLimit } from '../src/topology.ts'
import { Config, limitsFromConfig } from '../src/config.ts'
import type { NodeRecord } from '../src/schema.ts'

const config = Config({})
const limits = limitsFromConfig(config)
console.log('N,effectiveLimit,outgoingUpperBound,fullDirectedEdges,ratio')
for (let n = 1; n <= config.maxTotalNodes; n++) {
  const nodes = Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), {} as NodeRecord]))
  const limit = collaborationPeerLimit({ limits, nodes })
  const upperBound = n * Math.min(n - 1, limit)
  const full = n * (n - 1)
  console.log([n, limit, upperBound, full, full === 0 ? 'n/a' : (upperBound / full).toFixed(6)].join(','))
}
