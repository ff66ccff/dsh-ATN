/**
 * Shared-document governance, independent of the communication graph.
 * @module dsh-atn/governance
 */
import type { GoalDocument, NetworkRecord, NodeId } from './schema.ts'

/** Startup contract fields that a model proposal cannot replace or weaken. */
export const PROTECTED_GOAL_FIELDS = ['objective', 'successCriteria', 'constraints'] as const

/**
 * Freeze every currently active, published participant except the proposer.
 * Communication choices and birth branches confer no governance privilege.
 * New participants join future reviews; departing participants retain their
 * already recorded obligations until the proposal settles or expires.
 */
export function governanceVoters(record: NetworkRecord, proposerId: NodeId): NodeId[] {
  return Object.values(record.nodes)
    .filter(node => node.id !== proposerId && node.lifecycle === 'active' && node.creationState === 'published')
    .map(node => node.id)
    .sort()
}

/**
 * Find startup contract fields changed by a proposed working document.
 * The first durable revision supplies the baseline for old and new records;
 * later revisions cannot retroactively redefine it. Only the optional plan
 * is mutable through model consensus.
 */
export function changedContractFields(record: NetworkRecord, document: GoalDocument): (typeof PROTECTED_GOAL_FIELDS)[number][] {
  const initial = record.goalHistory[0]
  if (initial === undefined) throw new Error(`network ${record.id} has no startup contract`)
  return PROTECTED_GOAL_FIELDS.filter(field => document[field] !== initial.document[field])
}
