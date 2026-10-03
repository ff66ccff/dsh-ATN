/**
 * CONFIG-01: every count and duration is validated at load time, so a `0` bound
 * or an illegal domain name fails immediately instead of at the first write.
 * @module dsh-atn/tests/unit/config
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { assertConfigRelations, limitsFromConfig, type Config } from '../../src/config.ts'
import { testConfig } from '../fixtures/network.ts'

test('CONFIG-01: a zero count or duration is rejected at load time', () => {
  const fields: (keyof Config)[] = [
    'maxResidentNodes',
    'maxTotalNodes',
    'maxTasks',
    'maxProposals',
    'maxPendingMailPerNode',
    'maxRetainedMail',
    'maxMessageBytes',
    'maxDocumentBytes',
    'defaultLeaseMs',
    'maxLeaseExtensionMs',
    'networkDeadlineMs',
    'proposalDeadlineMs',
    'stepBudget',
  ]
  for (const field of fields) {
    const config = testConfig({ [field]: 0 } as Partial<Config>)
    assert.throws(
      () => assertConfigRelations(config),
      (error: unknown) => String((error as Error).message).includes(field),
      `${field}=0 must be rejected by name`,
    )
  }
})

test('CONFIG-01: a negative or fractional bound is rejected too', () => {
  assert.throws(() => assertConfigRelations(testConfig({ maxTasks: -1 })), /maxTasks/)
  assert.throws(() => assertConfigRelations(testConfig({ defaultLeaseMs: 1.5 })), /defaultLeaseMs/)
  assert.throws(() => assertConfigRelations(testConfig({ stepBudget: Number.NaN })), /stepBudget/)
})

test('CONFIG-01: an illegal domain name is rejected at load time', () => {
  for (const domainName of ['', 'Atn_Networks', '1atn', 'atn-networks', 'atn networks', 'ATN']) {
    assert.throws(
      () => assertConfigRelations(testConfig({ domainName })),
      /domainName/,
      `${JSON.stringify(domainName)} must be rejected`,
    )
  }
})

test('CONFIG-01: a legal domain name and a complete default configuration load', () => {
  assert.doesNotThrow(() => assertConfigRelations(testConfig()))
  assert.doesNotThrow(() => assertConfigRelations(testConfig({ domainName: 'atn_networks_v2' })))
  const limits = limitsFromConfig(testConfig({ domainName: 'atn_test' }))
  assert.equal(limits.stepBudget > 0, true)
  assert.equal(limits.maxTasks > 0, true)
  assert.equal(limits.networkDeadlineMs > 0, true)
})

test('CONFIG-01: a broken relation between two valid fields still fails', () => {
  assert.throws(() => assertConfigRelations(testConfig({ maxTotalNodes: 2, maxResidentNodes: 8 })), /maxTotalNodes must be at least maxResidentNodes/)
  assert.throws(() => assertConfigRelations(testConfig({ proposalDeadlineMs: 10_000_000 })), /proposalDeadlineMs must not exceed networkDeadlineMs/)
})
