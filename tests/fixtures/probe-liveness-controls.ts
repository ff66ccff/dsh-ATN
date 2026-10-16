/** Real kernel fault injection; no installed provider or credentials. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MemoryNetworkStore } from '../../src/domain.ts'
import { enqueueMail } from '../../src/mailbox.ts'
import { bootKernel, createHostAgent, settle } from './kernel.ts'
import { classifyMail, verdict, type SemanticGate } from '../../experiments/probe-liveness-audit-v2.ts'

export async function runLivenessControls(gate: SemanticGate) {
  const results = []
  for (const fault of ['normal', 'request-build-failure', 'receipt-flush-failure', 'terminal-retired', 'terminal-failed'] as const) {
    const scratch = await mkdtemp(join(tmpdir(), 'probe-liveness-v2-'))
    const store = new MemoryNetworkStore()
    const kernel = await bootKernel(scratch, { store })
    let undo = () => {}
    try {
      const host = await createHostAgent(kernel, `control-${fault}`)
      const network = await kernel.atn.start(host, { objective: 'Audit input lifecycle.', successCriteria: 'Persist receipts.', constraints: 'Offline scripted control.' })
      await settle(kernel)
      const child = await kernel.atn.spawn(host, { task: 'Receive audit mail.', context: '' })
      await settle(kernel)
      const worker = kernel.ctx.agents.get(SessionId(child.sessionId))!
      const baseline = worker.session.snapshotEvents().at(-1)!.seq
      const mailId = `control-${fault}`
      let modelStarts = 0, injectionHits = 0
      let releaseNormal!: () => void
      const normalBarrier = new Promise<void>(done => { releaseNormal = done })
      if (fault === 'normal') undo = () => { releaseNormal() }
      let sameStepReceipt = false
      const stopObserve = kernel.ctx.on('atn/network-updated', ({ record }) => {
        if (fault === 'normal' && record.mails[mailId]?.status === 'delivered') sameStepReceipt = worker.status === 'running'
      }, { global: true })
      const remove = kernel.ctx.on('llm/stream', (request, next) => {
        if (request.sessionId === worker.id) modelStarts++
        if (fault === 'normal' && request.sessionId === worker.id) return (async function* () {
          try { yield* next(); await normalBarrier } finally { releaseNormal() }
        })()
        return next()
      }, { global: true, prepend: true })
      if (fault === 'request-build-failure') {
        // buildRequest calls this public projection after appending user/message.
        const original = worker.session.deriveMessages.bind(worker.session)
        worker.session.deriveMessages = () => { injectionHits++; throw new Error('Injected projection failure after input append') }
        undo = () => { worker.session.deriveMessages = original }
      } else if (fault === 'receipt-flush-failure') {
        const original = kernel.ctx.sessions.flush.bind(kernel.ctx.sessions)
        kernel.ctx.sessions.flush = async session => {
          if (session.id === worker.id) { injectionHits++; return false }
          return original(session)
        }
        undo = () => { kernel.ctx.sessions.flush = original }
      }
      if (fault.startsWith('terminal-')) {
        // Real terminal transition, then enqueue a real durable outbox row to
        // exercise deliverMail's guard (the public send API rejects earlier).
        if (fault === 'terminal-failed') await kernel.atn.failNode(network.networkId, child.nodeId, 'Injected recipient failure')
        else {
          await store.update(network.networkId, current => ({ ...current, nodes: { ...current.nodes,
            [child.nodeId]: { ...current.nodes[child.nodeId], lifecycle: 'retired' as const } } }))
        }
        await store.update(network.networkId, current => enqueueMail(current, {
          id: mailId, fromId: network.nodeId, toId: child.nodeId, kind: 'note', taskId: null, proposalId: null,
          body: 'Offline audit control.', now: Date.now(),
        }).record)
        assert.equal(await kernel.atn.deliverMail(network.networkId, mailId), 'undeliverable')
      } else {
        await kernel.atn.send(host, { to: child.nodeId, kind: 'note', body: 'Offline audit control.', messageId: mailId })
        if (fault === 'normal') {
          try {
            assert.equal(await kernel.atn.deliverMail(network.networkId, mailId), 'delivered')
            assert.equal(sameStepReceipt, true, 'normal receipt must commit while the input step is running')
          } finally { releaseNormal() }
        }
        await settle(kernel)
        // Give a genuine retry opportunity while the fault remains active.
        await kernel.atn.tick()
        await settle(kernel)
      }
      const events = worker.session.snapshotEvents().filter(event => event.seq > baseline)
      const inputs = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'atn'
        && event.data.content.some(block => block.type === 'text' && block.text.split('\n')[0].includes(`mail=${mailId}`)))
      const record = await kernel.atn.network(network.networkId)
      const facts = { mail: mailId, input: inputs.length === 1, modelStarted: modelStarts > 0,
        delivered: record.mails[mailId].status === 'delivered', terminalAtDelivery: fault.startsWith('terminal-') }
      assert.equal(inputs.length, facts.input ? 1 : 0)
      if (!fault.startsWith('terminal-')) assert.equal(facts.input, true)
      const classification = classifyMail(gate, facts)
      const expected = fault === 'request-build-failure' ? 'input-without-model'
        : fault === 'receipt-flush-failure' ? 'receipt-missing' : fault === 'normal' ? 'normal-receipt' : 'unreachable'
      assert.equal(classification.category, expected)
      assert.equal(worker.status, 'idle')
      const lastStep = events.findLast(event => event.type === 'step/start')
      if (lastStep) assert.ok(events.some(event => event.type === 'step/end' && event.data.turn === lastStep.data.turn && event.data.step === lastStep.data.step))
      // Independently flush the history to prove the input is durable even
      // when the network acknowledgement was suppressed. Do not retry mail.
      undo(); undo = () => {}
      if (facts.input) assert.equal(await kernel.ctx.sessions.flush(worker.session), true)
      assert.equal((await kernel.atn.network(network.networkId)).mails[mailId].status, record.mails[mailId].status)
      if (fault.includes('failure')) assert.ok(injectionHits > 0)
      let recovery: { finalMailStatus: string; extraModelStarts: number } | null = null
      if (fault === 'receipt-flush-failure') {
        const before = modelStarts
        await kernel.atn.tick(); await settle(kernel)
        recovery = { finalMailStatus: (await kernel.atn.network(network.networkId)).mails[mailId].status, extraModelStarts: modelStarts - before }
        assert.equal(recovery.finalMailStatus, 'delivered')
        assert.equal(recovery.extraModelStarts, 0, 'missing receipt recovery must not duplicate model input')
      }
      remove()
      stopObserve()
      results.push({ fault, facts, classification, verdict: verdict(gate, [classification]), injectionHits,
        modelStarts, inputSourceSeq: inputs[0]?.seq ?? null, finalMailStatus: record.mails[mailId].status,
        idle: true, sameStepReceipt, inputDurablyFlushed: facts.input, recovery, genuineKernel: true })
    } finally {
      undo()
      await kernel.ctx.fiber.dispose()
      await rm(scratch, { recursive: true, force: true })
    }
  }
  assert.equal(new Set(results.map(row => row.verdict)).size, 2)
  return results
}
