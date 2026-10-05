import { strict as assert } from 'node:assert'
import test from 'node:test'
import { getTopologyTask, renderTopologyPrompt, TopologyScenario, TOPOLOGY_TASK_IDS, type RecoveryMode } from '../../experiments/topology-task.ts'
import { evaluateTopologyTask } from '../../experiments/topology-evaluation.ts'

function fixture(recoveryMode: RecoveryMode = 'self-organized') {
  const task = getTopologyTask('shift-ledger-1', 8)
  const scenario = new TopologyScenario(task, { recoveryMode })
  for (let slot = 0; slot < 8; slot++) scenario.register(`session-${slot}`)
  scenario.recordInitialTopology({ nodes: 8, maxPeers: 4, minPeers: 2, reachableFromEntry: 8 })
  return { task, scenario }
}

test('distributed fixtures require a sparse-capable scale and never share shard text in the prompt', () => {
  for (const count of [1, 4, 7, 17, 8.5]) assert.throws(() => getTopologyTask('shift-ledger-1', count), /8–16/)
  for (const id of TOPOLOGY_TASK_IDS) {
    const task = getTopologyTask(id, 8)
    assert.deepEqual(task, getTopologyTask(id, 8))
    const prompt = renderTopologyPrompt(task)
    for (const shard of task.shards) assert.equal(prompt.includes(shard.initial[0].id), false)
    assert.equal(task.shards.length, 8)
    assert.equal(task.shards.flatMap(shard => shard.initial).length, 96)
  }
  assert.notDeepEqual(getTopologyTask('shift-ledger-1', 8).shards, getTopologyTask('shift-ledger-2', 8).shards)
})

test('host ACL denies cross-node and unreleased documents, including guessed ids and unknown sessions', () => {
  const { scenario } = fixture()
  assert.deepEqual(scenario.read('session-0', 'mine'), { slot: 0, phase: 1, documents: ['initial-0'] })
  assert.throws(() => scenario.read('session-0', 'initial-1'), /access denied/)
  assert.throws(() => scenario.read('session-0', 'correction-0'), /not yet released/)
  assert.throws(() => scenario.read('unknown', 'mine'), /access denied/)
  const result = scenario.read('session-0', 'initial-0') as { data: Array<{ amount: number }> }
  result.data[0].amount = 99999
  assert.notDeepEqual(scenario.read('session-0', 'initial-0'), result, 'reads cannot modify source evidence')
})

test('phase gate counts distinct shards, then failure transfers only the failed slot to its backup', () => {
  const { scenario } = fixture('preassigned-backup')
  for (let index = 0; index < 12; index++) scenario.read('session-0', 'initial-0')
  assert.equal(scenario.readyForPhaseChange, false)
  assert.throws(() => scenario.advancePhase({ wasActive: true, confirmed: true }), /all initial/)
  for (let slot = 1; slot < 8; slot++) scenario.read(`session-${slot}`, `initial-${slot}`)
  assert.equal(scenario.readyForPhaseChange, true)
  scenario.advancePhase({ wasActive: true, confirmed: true })
  assert.throws(() => scenario.read('session-7', 'mine'), /access denied/)
  assert.deepEqual(scenario.read('session-1', 'mine'), { slot: 1, phase: 2,
    documents: ['initial-1', 'correction-1', 'initial-7', 'correction-7'] })
  assert.throws(() => scenario.read('session-0', 'correction-7'), /access denied/)
  assert.equal(scenario.snapshot().valid, true, 'successful manipulation is independent of recovery performance')
  assert.deepEqual(scenario.snapshot().outcomeChecks, { revisedEvidenceRead: false, failedShardRecovered: false })
  for (let slot = 0; slot < 7; slot++) scenario.read(`session-${slot}`, `correction-${slot}`)
  scenario.read('session-1', 'initial-7')
  scenario.read('session-1', 'correction-7')
  assert.equal(scenario.snapshot().valid, true)
  assert.deepEqual(scenario.snapshot().outcomeChecks, { revisedEvidenceRead: true, failedShardRecovered: true })
  assert.equal(scenario.snapshot().causalClaim, false)
})

test('default recovery has no preassigned ACL; an explicit host grant authorizes any surviving slot', () => {
  const { scenario } = fixture()
  for (let slot = 0; slot < 8; slot++) scenario.read(`session-${slot}`, `initial-${slot}`)
  scenario.advancePhase({ wasActive: true, confirmed: true })
  assert.equal(scenario.snapshot().recoveryMode, 'self-organized')
  assert.equal(scenario.snapshot().backupSlot, null)
  for (let slot = 0; slot < 7; slot++) assert.throws(() => scenario.read(`session-${slot}`, 'initial-7'), /access denied/)
  scenario.authorizeRecovery('session-4', 7)
  assert.deepEqual(scenario.read('session-4', 'mine'), { slot: 4, phase: 2,
    documents: ['initial-4', 'correction-4', 'initial-7', 'correction-7'] })
  scenario.read('session-4', 'initial-7')
  scenario.read('session-4', 'correction-7')
  assert.equal(scenario.snapshot().outcomeChecks.failedShardRecovered, true)
  assert.throws(() => scenario.read('session-1', 'correction-7'), /access denied/)
  scenario.authorizeRecovery('session-2', 7)
  assert.throws(() => scenario.read('session-4', 'correction-7'), /access denied/)
  scenario.read('session-2', 'correction-7')
  assert.throws(() => scenario.authorizeRecovery('session-7', 7), /Invalid/)
  assert.throws(() => scenario.authorizeRecovery('unknown', 7), /Invalid/)
})

test('shared protocol demands subtotal-only messages and supplies a complete deterministic evidence manifest', () => {
  const { task, scenario } = fixture()
  const prompt = renderTopologyPrompt(task)
  assert.match(prompt, /four account subtotals/)
  assert.match(prompt, /Do not send raw entries/)
  assert.match(prompt, /No backup is preassigned/)
  assert.match(prompt, /current delivery holder/)
  assert.equal(scenario.evidenceIds().length, 16)
  assert.equal(new Set(scenario.evidenceIds()).size, 16)
  assert.match(renderTopologyPrompt(task, 'preassigned-backup'), /separate preassigned-backup control arm/)
})

test('manipulation validity rejects complete graphs, disconnected graphs and a fault after natural retirement', () => {
  for (const condition of ['dense', 'disconnected', 'not-active']) {
    const { scenario } = fixture('preassigned-backup')
    scenario.recordInitialTopology({ nodes: 8, maxPeers: condition === 'dense' ? 7 : 4, minPeers: 2,
      reachableFromEntry: condition === 'disconnected' ? 4 : 8 })
    for (let slot = 0; slot < 8; slot++) scenario.read(`session-${slot}`, `initial-${slot}`)
    scenario.advancePhase({ wasActive: condition !== 'not-active', confirmed: true })
    for (let slot = 0; slot < 8; slot++) scenario.read(`session-${slot === 7 ? 1 : slot}`, `correction-${slot}`)
    scenario.read('session-1', 'initial-7')
    assert.equal(scenario.snapshot().valid, false, condition)
  }
})

test('final oracle requires changed-phase arithmetic and exact evidence independently of protocol status', () => {
  const { task } = fixture()
  const answer = { phase: 2, netByAccount: { A: 1042, B: 811, C: 805, D: 935 },
    evidence: task.shards.flatMap(shard => [`initial-${shard.slot}`, `correction-${shard.slot}`]) }
  assert.equal(evaluateTopologyTask(task, JSON.stringify(answer)).passed, true)
  assert.equal(evaluateTopologyTask(task, JSON.stringify({ ...answer, phase: 1 })).passed, false)
  assert.equal(evaluateTopologyTask(task, JSON.stringify({ ...answer, netByAccount: { ...answer.netByAccount, A: 1043 } })).passed, false)
  assert.equal(evaluateTopologyTask(task, JSON.stringify({ ...answer, evidence: [...answer.evidence, 'initial-0'] })).passed, false)
  assert.equal(evaluateTopologyTask(task, JSON.stringify({ ...answer, protocol: 'completed' })).passed, false)
  assert.equal(evaluateTopologyTask(task, 'null').error, 'answer-must-be-object')
})
