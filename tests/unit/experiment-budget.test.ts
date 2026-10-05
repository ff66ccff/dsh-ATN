import { strict as assert } from 'node:assert'
import test from 'node:test'
import { createExperimentBudget } from '../../experiments/budget.ts'

const options = { provider: 'allowed', model: 'model', maxCalls: 2, maxOutputTokens: 100, observedTokenLimit: 1000 }
const request = { provider: 'allowed', model: 'model', maxTokens: 100 }
const observation = { ended: false, knownTotalTokens: 0, unknownUsageCalls: 0 }

test('BUDGET-01: concurrent entrants cannot reserve more than the hard visible call limit', async () => {
  const budget = createExperimentBudget(options)
  const admissions = await Promise.all(Array.from({ length: 20 }, async () => budget.admit(request, observation)))
  assert.equal(admissions.filter(row => row.allowed).length, 2)
  assert.equal(budget.snapshot().issued, 2)
  assert.equal(budget.snapshot().denied, 18)
  assert.equal(budget.snapshot().lastRejection, 'call-limit')
})

test('BUDGET-02: route and positive integer output ceiling are checked before reservation', () => {
  const budget = createExperimentBudget(options)
  for (const maxTokens of [undefined, 0, -1, 1.5, NaN, Infinity, 101]) {
    assert.deepEqual(budget.admit({ ...request, maxTokens }, observation), { allowed: false, reason: 'output-limit-not-applied', issued: 0 })
  }
  assert.equal(budget.admit({ ...request, provider: 'other' }, observation).allowed, false)
  assert.equal(budget.admit({ ...request, model: 'other' }, observation).allowed, false)
  assert.equal(budget.snapshot().issued, 0)
  assert.equal(budget.admit(request, observation).allowed, true)
})

test('BUDGET-03: observed token threshold is separate from unknown usage and hard call limit', () => {
  const budget = createExperimentBudget(options)
  assert.equal(budget.admit(request, { ...observation, knownTotalTokens: 999, unknownUsageCalls: 2 }).allowed, true)
  assert.equal(budget.snapshot().unknownUsageCalls, 2)
  assert.deepEqual(budget.admit(request, { ...observation, knownTotalTokens: 1000, unknownUsageCalls: 2 }), {
    allowed: false, reason: 'observed-token-limit', issued: 1,
  })
  assert.match(budget.snapshot().tokenLimitKind, /not a hard token ceiling/)
})

test('BUDGET-04: ended runs and invalid observations do not start new calls', () => {
  const budget = createExperimentBudget(options)
  assert.deepEqual(budget.admit(request, { ...observation, ended: true }), { allowed: false, reason: 'ended', issued: 0 })
  assert.deepEqual(budget.admit(request, { ...observation, knownTotalTokens: NaN }), { allowed: false, reason: 'invalid-observation', issued: 0 })
  for (const maxCalls of [0, -1, 1.5, Infinity]) assert.throws(() => createExperimentBudget({ ...options, maxCalls }), /positive safe integers/)
})
