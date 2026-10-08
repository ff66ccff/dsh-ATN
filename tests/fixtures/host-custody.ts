/** Trusted test host only. This helper is never mounted as a model tool. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AtnRuntime } from '../../src/runtime.ts'
import type { KnowledgeMetadata } from '../../src/knowledge.ts'
import { defineCustodyPolicy } from '../../src/information-boundary.ts'

const registries = new WeakMap<AtnRuntime, Map<string, Map<string, KnowledgeMetadata>>>()

export async function setHostKnowledge(atn: AtnRuntime, agent: Agent, metadata: KnowledgeMetadata) {
  const { record, node } = await atn.callerContext(agent)
  let networks = registries.get(atn)
  if (!networks) { networks = new Map(); registries.set(atn, networks) }
  let registry = networks.get(record.id)
  if (!registry) {
    registry = new Map(); networks.set(record.id, registry)
    const custody = registry
    atn.installOutboundPolicy(record.id, defineCustodyPolicy({
      custody: id => custody.get(id)?.documents ?? [], extractClaims: () => [],
      describeArtifact: id => ({ topics: [...custody.values()].filter(row => row.documents.includes(id)).flatMap(row => row.topics) }),
    }))
  }
  registry.set(node.id, structuredClone(metadata))
  await atn.refreshCustody(record.id)
}
