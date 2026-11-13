/**
 * CONFIG-01: every count and duration is validated at load time, so a `0` bound
 * or an illegal domain name fails immediately instead of at the first write.
 * @module dsh-atn/tests/unit/config
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { assertConfigRelations, limitsFromConfig, Config as configSchema, type Config } from '../../src/config.ts'
import { networkLimitsSchema } from '../../src/schema.ts'
import { testConfig } from '../fixtures/network.ts'

test('CONFIG-01: a zero count or duration is rejected at load time', () => {
  const fields: (keyof Config)[] = [
    'maxCollaborationPeers',
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

test('CONFIG-02: outgoing ceiling accepts 1–8, persists two, and defaults new configs to eight', () => {
  for (const maxCollaborationPeers of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const config = testConfig({ maxCollaborationPeers })
    assert.doesNotThrow(() => assertConfigRelations(config))
    assert.equal(limitsFromConfig(config).maxCollaborationPeers, maxCollaborationPeers)
  }
  for (const maxCollaborationPeers of [-1, 0, 1.5, 9, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => assertConfigRelations({ ...testConfig(), maxCollaborationPeers }), /maxCollaborationPeers/)
  }
  const { maxCollaborationPeers: _configured, ...legacy } = testConfig()
  assert.doesNotThrow(() => assertConfigRelations(legacy))
  assert.equal(limitsFromConfig(legacy).maxCollaborationPeers, 8)
  assert.equal(limitsFromConfig(testConfig()).maxCollaborationPeers, 8)
})

test('CONFIG-03: omitted host configuration resolves complete defaults', () => {
  const config = configSchema(undefined)
  assert.deepEqual(config, configSchema({} as Config))
  assert.doesNotThrow(() => assertConfigRelations(config))
  assert.equal(limitsFromConfig(config).peerDisclosure, 'full')
})

test('CONFIG-03: Cordis loads the plugin when the host omits config', async () => {
  const ctx = new Context()
  let loaded: Config | undefined
  try {
    await ctx.plugin({
      Config: configSchema,
      apply: (_ctx: Context, config: Config) => {
        assertConfigRelations(config)
        loaded = config
      },
    })
    assert.deepEqual(loaded, configSchema({} as Config))
  } finally {
    await ctx.fiber.dispose()
  }
})

test('CONFIG-03: host disclosure defaults full, freezes valid modes, and rejects invalid config or records', () => {
  assert.equal(limitsFromConfig(testConfig()).peerDisclosure, 'full')
  for (const peerDisclosure of ['full', 'coarse', 'minimal'] as const) {
    const config = testConfig({ peerDisclosure })
    assert.doesNotThrow(() => assertConfigRelations(config))
    assert.equal(networkLimitsSchema.parse(limitsFromConfig(config)).peerDisclosure, peerDisclosure)
  }
  for (const peerDisclosure of ['', 'secret', null, 3]) {
    assert.throws(() => configSchema({ ...testConfig(), peerDisclosure } as Config), /peerDisclosure/)
    assert.throws(() => assertConfigRelations({ ...testConfig(), peerDisclosure } as Config), /peerDisclosure/)
    assert.throws(() => networkLimitsSchema.parse({ ...limitsFromConfig(testConfig()), peerDisclosure }), /peerDisclosure/)
  }
  const { peerDisclosure: _mode, ...legacy } = limitsFromConfig(testConfig())
  assert.equal(networkLimitsSchema.parse(legacy).peerDisclosure, undefined)
})
