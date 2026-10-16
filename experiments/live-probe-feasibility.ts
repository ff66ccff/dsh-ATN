/** Offline admission arithmetic. No providers, clocks, environment or network. */
import { expectedChain, type ShiftingEvidenceTask } from './shifting-evidence-task.ts'

export const PROBE_ROUTE = { provider: 'agy', model: 'gemini-3.8-flash-tiered', reasoningEffort: 'medium' } as const

/** A lower bound, not a tight minimum or a sufficient allocation. */
export function deriveProbeLowerBound(task: ShiftingEvidenceTask) {
  if (task.topologyBinding || task.agents !== 8 || task.chainLength !== 2) throw new Error('Proof supports only the frozen revision-2 8-node, length-2 task')
  const facts = task.phases.flatMap(phase => expectedChain(task, phase.phase).chain.map(fact => ({
    phase: phase.phase, document: fact.document, owner: phase.holders[fact.key], key: fact.key,
  })))
  const owners = facts.map(fact => fact.owner)
  if (owners.some(owner => !Number.isInteger(owner) || owner <= 0 || owner >= task.agents)
    || new Set(owners).size !== facts.length) throw new Error('Proof requires four distinct non-entry current owners')
  return { version: 1, seed: task.seed, facts, requiredOwners: owners,
    unconditionalModelCalls: 1,
    evidenceCausalModelCalls: facts.length * 2 + 2,
    maxNodeStepsLowerBound: 2,
    arithmetic: `${facts.length} distinct non-entry owners * (read decision + later evidence-send decision) + 2 entry checkpoint decisions = ${facts.length * 2 + 2}`,
    assumptions: [
      'No guessed, hardcoded, prelearned or externally supplied hidden proofs; evidence is acquired through the advertised local read tool and directed mail.',
      'A tool-call argument is fixed before its result is returned; no model consumes its own read result inside the same model response.',
      'Phase-2 current evidence is read after checkpoint-only advancement; its owners and the two phase-1 owners are distinct.',
      'The entry must receive current evidence before generating each checkpoint; its two decisions cannot be the same response.',
      'This bound allows batched tool calls, relays and arbitrary legal rewiring. It omits discovery, requests, stale-copy checks, ratings, idle and extra model calls.',
    ],
    limitation: 'The meaningful bound is conditional on evidence causality, not an unconditional guarantee about arbitrary lucky model output. The unconditional host bound is only >=1 model response. Neither bound proves 120 seconds impossible, or that 10 calls suffice.' }
}

export interface ProbeGateInput {
  lowerBound: ReturnType<typeof deriveProbeLowerBound>
  reference: { actions: number; maxNodeActions: number; source: string }
  conditions: { agents: number; perNodeSteps: number; maxCalls: number; timeoutMs: number; concurrency: number }
  latency: { ms: number; source: string; provider: string; model: string; reasoningEffort: string; limitations: string[]
    coverage?: { quantile: number; sampleCount: number; principle: string } }
  margin: { actionFactor: number; nodeFactor: number; overheadMs: number; rationale: string }
  /** Exactly one scheduling dimension is the proposed remedy; neither is uniquely causal. */
  schedulingRemedy: 'deadline' | 'concurrency'
}

export function evaluateProbeFeasibility(input: ProbeGateInput) {
  const { lowerBound: lower, reference, conditions: c, latency, margin: m } = input
  if (!latency?.source?.trim() || !reference?.source?.trim()) throw new Error('Explicit latency and reference provenance required')
  for (const key of ['provider', 'model', 'reasoningEffort'] as const) {
    if (latency[key] !== PROBE_ROUTE[key]) throw new Error(`Latency route mismatch: ${key}`)
  }
  for (const value of [c.agents, c.perNodeSteps, c.maxCalls, c.timeoutMs, c.concurrency, reference.actions,
    reference.maxNodeActions, lower.evidenceCausalModelCalls, lower.maxNodeStepsLowerBound]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Gate needs positive integer counts and limits')
  }
  if (c.agents !== 8 || c.concurrency > c.agents || !Number.isFinite(latency.ms) || latency.ms <= 0
    || !Number.isFinite(m.actionFactor) || m.actionFactor <= 1 || !Number.isFinite(m.nodeFactor) || m.nodeFactor <= 1
    || !Number.isSafeInteger(m.overheadMs) || m.overheadMs < 0 || !m.rationale?.trim()
    || !['deadline', 'concurrency'].includes(input.schedulingRemedy)) throw new Error('Invalid explicit scheduling assumptions or margins')
  const calls = Math.max(lower.evidenceCausalModelCalls, Math.ceil(reference.actions * m.actionFactor))
  const steps = Math.max(lower.maxNodeStepsLowerBound, Math.ceil(reference.maxNodeActions * m.nodeFactor))
  const workMs = calls * latency.ms
  const requiredDeadlineMs = Math.ceil(workMs / c.concurrency + m.overheadMs)
  const availableServiceMs = c.timeoutMs - m.overheadMs
  const requiredConcurrency = availableServiceMs > 0 ? Math.max(1, Math.ceil(workMs / availableServiceMs)) : null
  const schedulePass = c.timeoutMs >= requiredDeadlineMs
  const dimensions = [
    { dimension: 'nodeSteps', sufficient: c.perNodeSteps >= steps, available: c.perNodeSteps, required: steps, margin: c.perNodeSteps - steps },
    { dimension: 'callCap', sufficient: c.maxCalls >= calls, available: c.maxCalls, required: calls, margin: c.maxCalls - calls },
    { dimension: input.schedulingRemedy, sufficient: schedulePass,
      available: input.schedulingRemedy === 'deadline' ? c.timeoutMs : c.concurrency,
      required: input.schedulingRemedy === 'deadline' ? requiredDeadlineMs : requiredConcurrency,
      margin: input.schedulingRemedy === 'deadline' ? c.timeoutMs - requiredDeadlineMs
        : requiredConcurrency === null ? null : c.concurrency - requiredConcurrency },
  ]
  const insufficient = dimensions.filter(row => !row.sufficient).map(row => row.dimension)
  if (latency.coverage && (!(latency.coverage.quantile > 0 && latency.coverage.quantile <= 1)
    || !Number.isSafeInteger(latency.coverage.sampleCount) || latency.coverage.sampleCount <= 0
    || !latency.coverage.principle.trim())) throw new Error('Invalid latency coverage')
  return { version: 1, admitted: insufficient.length === 0, verdict: insufficient.length ? 'not-admitted-under-assumptions' : 'admitted-under-assumptions',
    coverageMeaning: latency.coverage
      ? `Planning covers p${latency.coverage.quantile * 100} of ${latency.coverage.sampleCount} individual observed service times; not whole-run or future-service coverage.`
      : 'Explicit latency scenario only; no empirical quantile coverage asserted.',
    dimensions, insufficient, primaryInsufficiency: insufficient[0] ?? null,
    effectiveBudgetDimensions: dimensions.map(row => row.dimension),
    unavailableBudgetDimensions: [{ dimension: 'totalTokens', active: false,
      reason: 'AGY reports no totalTokens in the retained batch. The historical 400000 threshold is not an effective budget constraint.' }],
    requiredDeadlineMs, requiredConcurrency, plannedCalls: calls, plannedMaxNodeSteps: steps,
    necessaryConditionalWorkMs: lower.evidenceCausalModelCalls * latency.ms / c.concurrency,
    arithmetic: { calls: `max(${lower.evidenceCausalModelCalls}, ceil(${reference.actions} * ${m.actionFactor})) = ${calls}`,
      steps: `max(${lower.maxNodeStepsLowerBound}, ceil(${reference.maxNodeActions} * ${m.nodeFactor})) = ${steps}`,
      deadline: `ceil(${calls} * ${latency.ms} / ${c.concurrency} + ${m.overheadMs}) = ${requiredDeadlineMs}` },
    assumptions: ['Reference actions are a planning prior, never a strict model-call requirement.',
      'Historical service latency is an explicit planning scenario, not a guaranteed future service bound.',
      'Work/concurrency assumes full slot utilization; causal dependencies can reduce effective concurrency.',
      'A scheduling shortfall can be remedied by either deadline or concurrency; the remedy label is explicit policy, not causal identification.',
      'Admission permits an experiment; it does not guarantee success or completion within this allocation.'],
    input }
}

export async function runAfterProbeGate<T>(input: ProbeGateInput, run: () => Promise<T>): Promise<T> {
  const gate = evaluateProbeFeasibility(input)
  if (!gate.admitted) throw new Error(`Probe refused before provider mount: ${JSON.stringify({ insufficient: gate.insufficient,
    requiredDeadlineMs: gate.requiredDeadlineMs, requiredConcurrency: gate.requiredConcurrency })}`)
  return run()
}
