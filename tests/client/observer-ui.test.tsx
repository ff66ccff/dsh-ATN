/** Read-only observer interactions, transport lifetime, and topology presentation. */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NetworkAction, type NetworkActionProps } from '../../src/client/NetworkAction.tsx'
import { zh } from '../../src/client/locales.ts'
import type { AtnObserverSnapshot } from '../../src/observer-types.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'

let dom: JSDOM
let root: Root
let mount: HTMLDivElement
let sessions: SessionListState
const sessionListeners = new Set<() => void>()
const subscribeSessions = (listener: () => void) => { sessionListeners.add(listener); return () => { sessionListeners.delete(listener) } }
const useSessions: NetworkActionProps['useSessions'] = selector => useSyncExternalStore(subscribeSessions, () => selector(sessions))

function setPreset(sessionId: string, preset: string | undefined): void {
  sessions = { ...sessions, byId: { ...sessions.byId, [sessionId]: { projectionValues: { agentPreset: preset } } } } as SessionListState
  for (const listener of sessionListeners) listener()
}

beforeEach(() => {
  sessions = { byId: {} } as SessionListState
  sessionListeners.clear()
  dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost/' })
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })
  mount = document.createElement('div')
  document.body.appendChild(mount)
  root = createRoot(mount)
})
afterEach(async () => { await act(async () => { root.unmount() }); dom.window.close() })

function snapshot(objective = 'Inspect actual network'): AtnObserverSnapshot {
  return {
    observedAt: 1000,
    network: {
      id: 'network-1', status: 'open', entryNodeId: 'root', goalVersion: 2, objective,
      stepsUsed: 3, stepBudget: 40, deadlineAt: 900000,
      nodes: [
        { id: 'root', sessionId: 'session-a', isEntry: true, creatorId: null, lifecycle: 'active', agentStatus: 'idle', peers: ['child'], stepsUsed: 1, openTasks: 4, pendingVotes: 0, currentTool: null },
        { id: 'child', sessionId: 'session-child', isEntry: false, creatorId: 'root', lifecycle: 'active', agentStatus: 'running', peers: ['root'], stepsUsed: 2, openTasks: 6, pendingVotes: 1, currentTool: 'bash' },
      ],
      edges: [{ source: 'root', target: 'child', kind: 'collaboration' }, { source: 'child', target: 'root', kind: 'collaboration' }, { source: 'root', target: 'child', kind: 'birth' }],
      tasks: [{ id: 'task-1', holderId: 'child', requesterId: 'root', description: 'Run focused checks', status: 'failed', summary: 'A recorded failure', createdAt: 500, settledAt: 900 }],
      events: [{ id: 'event-1', kind: 'task-failed', at: 900, nodeId: 'child', targetId: 'root', taskId: 'task-1', summary: '<img src=x> remains text' }],
    },
  }
}

type Pending = { sessionId: string; signal: AbortSignal; resolve: (value: AtnObserverSnapshot) => void; reject: (error: Error) => void }
function reader() {
  const calls: Pending[] = []
  const readSnapshot = (sessionId: string, signal: AbortSignal): Promise<AtnObserverSnapshot> => new Promise((resolve, reject) => { calls.push({ sessionId, signal, resolve, reject }) })
  return { calls, readSnapshot }
}
async function render(readSnapshot: NetworkActionProps['readSnapshot'], sessionId = 'session-a', preset: string | null = 'atn') {
  // Use a reactive session-list seat, as the native header does.
  const props = { sessionId, readSnapshot, useSessions, t: (key: keyof typeof zh) => zh[key] } as NetworkActionProps
  await act(async () => { setPreset(sessionId, preset ?? undefined); root.render(<NetworkAction {...props} />) })
}
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.getAttribute('aria-label') === label || element.textContent === label)
  assert.ok(found, `Missing button: ${label}`)
  return found
}
async function click(element: Element) { await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) }) }
async function finish(pending: Pending, value: AtnObserverSnapshot) { await act(async () => { pending.resolve(value) }) }

test('shows the entry only for the current ATN preset, including metadata arriving later', async () => {
  const source = reader()
  for (const preset of [null, 'standard', 'cordis', 'creator', 'ATN', 'custom-atn']) {
    await render(source.readSnapshot, 'session-a', preset)
    assert.equal(document.querySelector('.atn-trigger'), null)
    assert.equal(document.querySelector('[role="dialog"]'), null)
  }
  // The session subscription alone updates visibility, without a network or prop change.
  await act(async () => { setPreset('session-a', 'atn') })
  assert.ok(button(zh.trigger))
  assert.equal(source.calls.length, 0)
  await click(button(zh.trigger))
  await finish(source.calls[0], { observedAt: 1000, network: null })
  assert.match(document.body.textContent!, /尚未加入 ATN 网络/)
})

test('leaving ATN hides the open panel, aborts polling, and resets it before returning', async () => {
  const source = reader()
  await render(source.readSnapshot)
  await click(button(zh.trigger))
  await act(async () => { setPreset('session-a', 'cordis') })
  assert.equal(document.querySelector('.atn-trigger'), null)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(source.calls[0].signal.aborted, true)
  await finish(source.calls[0], snapshot('Old ATN response'))
  await act(async () => { setPreset('session-a', 'atn') })
  assert.ok(button(zh.trigger))
  assert.equal(document.querySelector('[role="dialog"]'), null)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)) })
  assert.equal(source.calls.length, 1, 'Returning to ATN does not reopen or resume polling')
  await click(button(zh.trigger))
  assert.equal(source.calls.length, 2)
  assert.doesNotMatch(document.body.textContent!, /Old ATN response/)
  assert.match(document.body.textContent!, /正在读取网络/)
})

test('switching from an ATN session to a non-ATN session hides the entry without fetching', async () => {
  const source = reader()
  await render(source.readSnapshot)
  await click(button(zh.trigger))
  await render(source.readSnapshot, 'session-b', 'standard')
  assert.equal(source.calls[0].signal.aborted, true)
  assert.equal(source.calls.length, 1)
  assert.equal(document.querySelector('.atn-trigger'), null)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  await finish(source.calls[0], snapshot('Hidden ATN response'))
  assert.doesNotMatch(document.body.textContent!, /Hidden ATN response/)
})

test('does not fetch until opened, serializes polling, and aborts on close', async () => {
  const source = reader()
  await render(source.readSnapshot)
  assert.equal(source.calls.length, 0)
  await click(button(zh.trigger))
  assert.equal(source.calls.length, 1)
  assert.match(document.body.textContent!, /正在读取网络/)
  await new Promise(resolve => setTimeout(resolve, 1050))
  assert.equal(source.calls.length, 1, 'A pending request never overlaps the next poll')
  await finish(source.calls[0], snapshot())
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)) })
  assert.equal(source.calls.length, 2)
  await click(button(zh.close))
  assert.equal(source.calls[1].signal.aborted, true)
  assert.equal(document.querySelector('[role="dialog"]'), null)
  await finish(source.calls[1], snapshot('Late completion after close'))
  assert.doesNotMatch(document.body.textContent!, /Late completion/)
})

test('switching sessions cancels the old request and ignores its late response', async () => {
  const source = reader()
  await render(source.readSnapshot)
  await click(button(zh.trigger))
  await render(source.readSnapshot, 'session-b')
  assert.equal(source.calls[0].signal.aborted, true)
  assert.equal(source.calls[1].sessionId, 'session-b')
  await finish(source.calls[1], snapshot('Session B objective'))
  await finish(source.calls[0], snapshot('Stale session A objective'))
  assert.match(document.body.textContent!, /Session B objective/)
  assert.doesNotMatch(document.body.textContent!, /Stale session A/)
})

test('unmount aborts the observer request', async () => {
  const source = reader()
  await render(source.readSnapshot)
  await click(button(zh.trigger))
  await act(async () => { root.render(null) })
  assert.equal(source.calls[0].signal.aborted, true)
})

test('shows empty state, a disconnected last snapshot, and a working retry', async () => {
  const source = reader()
  await render(source.readSnapshot)
  await click(button(zh.trigger))
  await act(async () => { source.calls[0].reject(new Error('Observer unavailable')) })
  assert.match(document.body.textContent!, /网络读取失败/)
  await click(button(zh.retry))
  assert.equal(source.calls[0].signal.aborted, true)
  await finish(source.calls[1], { observedAt: 1000, network: null })
  assert.match(document.body.textContent!, /尚未加入 ATN 网络/)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)) })
  await act(async () => { source.calls[2].reject(new Error('Connection lost')) })
  assert.match(document.body.textContent!, /连接中断/)
  assert.match(document.body.textContent!, /尚未加入 ATN 网络/)
  await click(button(zh.retry))
  await finish(source.calls[3], snapshot())
  assert.match(document.body.textContent!, /Inspect actual network/)
  assert.doesNotMatch(document.body.textContent!, /连接中断/)
})

test('renders directed adjacency separately from birth links and node task results', async () => {
  const source = reader()
  await render(source.readSnapshot)
  await click(button(zh.trigger))
  await finish(source.calls[0], snapshot())
  const edges = [...document.querySelectorAll<SVGPathElement>('[data-atn-edge]')]
  assert.equal(edges.length, 2)
  assert.ok(edges.every(edge => edge.getAttribute('marker-end')?.startsWith('url(#')))
  assert.notEqual(edges[0].getAttribute('d'), edges[1].getAttribute('d'))
  const child = document.querySelector<SVGGElement>('g[role="button"][aria-label*="child"]')!
  assert.ok(child)
  await click(child)
  assert.equal(child.getAttribute('aria-pressed'), 'true')
  const details = document.querySelector('aside')!
  assert.match(document.querySelector('.atn-goal')!.textContent!, /全网累计步数 3 · 每节点步数上限 40/)
  assert.match(details.textContent!, /已用步数2 \/ 40/)
  assert.match(details.textContent!, /bash/)
  assert.match(details.textContent!, /A recorded failure/)
  assert.match(details.textContent!, /失败/)
  assert.match(document.querySelector('.atn-metrics')!.textContent!, /10待处理任务/, 'Metrics use all node obligations, not the capped task window')
  await click(document.querySelector('input[type="checkbox"]')!)
  assert.equal(document.querySelectorAll('[data-atn-edge-kind="birth"]').length, 1)
  assert.equal(document.querySelector('img'), null, 'Agent text is never interpreted as markup')
  assert.match(document.body.textContent!, /<img src=x>/)
  assert.equal(document.querySelectorAll('input').length, 1, 'Only a viewing toggle is exposed')
  assert.equal(source.calls.length, 1, 'Selection and view controls issue no network mutations')
})
