/** Zero-model/offline entry. Generates all three scheduling controls. */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createShiftingEvidenceTask } from '../experiments/shifting-evidence-task.ts'
import { deriveProbeLowerBound, evaluateProbeFeasibility, type ProbeGateInput } from '../experiments/live-probe-feasibility.ts'
import { loadProbeHistory } from '../experiments/live-probe-history.ts'

const directory = resolve(process.argv[2] ?? '.artifacts/probe-gate-quiescence/20261015')
await mkdir(directory, { recursive: true })
const history = await loadProbeHistory()
const lowerBounds = [17, 31, 45, 59, 73].map(seed => deriveProbeLowerBound(createShiftingEvidenceTask(8, seed, 2)))
const input: ProbeGateInput = { lowerBound: lowerBounds[0], latency: history.latency,
  reference: { actions: 60, maxNodeActions: 8, source: 'docs/execution-evidence/agy-model-20261015/references.json; constructive-policy counts only' },
  conditions: { agents: 8, perNodeSteps: 12, maxCalls: 96, timeoutMs: 120000, concurrency: 1 },
  margin: { actionFactor: 1.125, nodeFactor: 1.125, overheadMs: 30000,
    rationale: '12.5% explicit action/node planning headroom plus 30 seconds for preparation, tools and host work. Bounded smoke, not a completion guarantee.' },
  schedulingRemedy: 'deadline' }
const previous = evaluateProbeFeasibility(input)
const feasible = evaluateProbeFeasibility({ ...input, conditions: { ...input.conditions, timeoutMs: previous.requiredDeadlineMs } })
const concurrency = evaluateProbeFeasibility({ ...input, schedulingRemedy: 'concurrency' })
const frozen = evaluateProbeFeasibility({ ...input, conditions: { ...input.conditions, timeoutMs: 600000 } })
const result = { execution: 'offline-zero-model', lowerBounds, history, previous, feasible, concurrency, frozen,
  revision: 'User authorized deriving a genuine lower bound after section-7.2 stop. Scheduling admission is conditional planning, not a mathematical impossibility certificate.' }
await writeFile(join(directory, 'feasibility.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
