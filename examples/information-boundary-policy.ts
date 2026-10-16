/** Example host claim grammar, shared with its black-box conformance adapter. */
import { defineCustodyPolicy, type CustodyResolver, type NetworkOutboundPolicy } from '../src/index.ts'
export function createExampleCustodyPolicy(custody: CustodyResolver, aliases = new Map<string, string>()): NetworkOutboundPolicy {
 return defineCustodyPolicy({ custody,
  extractClaims: input => {
   const text = JSON.stringify(input)
   const claims = [...text.matchAll(/claim:([a-z-]+)/g)].map(match => match[1])
   // Host catalog aliases allow identifier-only channels (claim/rewire) to name real held artifacts.
   for (const [alias, artifact] of aliases) if (text.includes(JSON.stringify(alias))) claims.push(artifact)
   return claims
  }, describeArtifact: id => ({ topics: [id] }),
 })
}
