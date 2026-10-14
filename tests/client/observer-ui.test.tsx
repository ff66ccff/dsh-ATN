/** Read-only observer interactions, transport lifetime, and topology presentation. */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { JSDOM } from 'jsdom'
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Context } from '@deepseek-ai/cordis'
import * as ClientPlugin from '../../src/client/index.tsx'
import { NetworkAction, type NetworkActionProps } from '../../src/client/NetworkAction.tsx'
import { zh } from '../../src/client/locales.ts'
import type { AtnObserverSnapshot } from '../../src/observer-types.ts'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { NetworkView } from '../../src/client/NetworkView.tsx'
import { SidebarObserver } from '../../src/client/SidebarObserver.tsx'
import type { TabDescriptor } from 'dsh-better-sidebar'

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
      stepsUsed: 3, stepBudget: 40, maxCollaborationPeers: 2, deadlineAt: 900000,
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
  const collaboration = document.querySelector(`section[aria-label="${zh.collaboration}"]`)!
  assert.equal(collaboration.querySelectorAll('li').length, 2)
  assert.deepEqual([...collaboration.querySelectorAll('li')].map(row => row.textContent), ['root → child', 'child → root'])
  const child = button('child')
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
  const lineage = document.querySelector(`section[aria-label="${zh.birth}"]`)!
  assert.equal(lineage.querySelectorAll('li').length, 1)
  assert.equal(lineage.querySelector('li')!.textContent, 'root → child')
  assert.equal(document.querySelector('img'), null, 'Agent text is never interpreted as markup')
  assert.match(document.body.textContent!, /<img src=x>/)
  assert.equal(document.querySelectorAll('input').length, 0, 'Only read-only selection controls are exposed')
  assert.equal(source.calls.length, 1, 'Selection and view controls issue no network mutations')
})

test('SIDEBAR-ABSENT: apply registers a usable structured header fallback without the optional service', async () => {
  const ctx = new Context()
  let headers = 0
  ctx.provide('slots', { inject: (_name: string, install: () => () => void) => ctx.effect(install),
    register: () => { headers++; return () => { headers-- } } })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: keyof typeof zh) => zh[key] })
  ctx.provide('connection', { rpc: { call: async () => ({ ok: true, value: snapshot() }) } })
  try {
    await ctx.plugin(ClientPlugin)
    assert.equal(headers, 1)
    await render(async () => snapshot())
    await click(button(zh.trigger))
    assert.ok(document.querySelector('table'), 'fallback displays the node table')
    assert.match(document.body.textContent!, /Inspect actual network/)
  } finally { await ctx.fiber.dispose() }
  assert.equal(headers, 0)
})

test('SIDEBAR-PRESENT: registers one namespaced tab and releases it on plugin unload', async () => {
  const ctx = new Context()
  const registrations: { id: string }[] = []
  let disposed = 0
  ctx.provide('slots', { inject: (_name: string, install: () => () => void) => ctx.effect(install), register: () => () => {} })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: keyof typeof zh) => zh[key] })
  ctx.provide('sessions', { list: { getSnapshot: () => sessions, subscribe: subscribeSessions } })
  ctx.provide('connection', { rpc: { call: async () => ({ ok: true, value: snapshot() }) } })
  ctx.provide('betterSidebar', { registerTab: (descriptor: { id: string }) => {
    registrations.push(descriptor); return () => { disposed++ }
  } })
  try {
    await ctx.plugin(ClientPlugin)
    assert.deepEqual(registrations.map(row => row.id), ['atn-network'])
  } finally { await ctx.fiber.dispose() }
  assert.equal(disposed, 1)
})

test('SIDEBAR-PENDING: a required missing module blocks its apply, but late optional child registration does not block the header', async () => {
  const ctx = new Context()
  let applied = false
  const required = ctx.plugin({ inject: ['missingSidebar'], apply: () => { applied = true } })
  await required
  assert.equal(applied, false)
  let headers = 0, tabs = 0, releases = 0
  ctx.provide('slots', { inject: (_name: string, install: () => () => void) => ctx.effect(install), register: () => {
    headers++; return () => { headers-- }
  } })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: keyof typeof zh) => zh[key] })
  ctx.provide('sessions', { list: { getSnapshot: () => sessions, subscribe: subscribeSessions } })
  ctx.provide('connection', { rpc: { call: async () => ({ ok: true, value: snapshot() }) } })
  try {
    const plugin = await ctx.plugin(ClientPlugin)
    assert.equal(headers, 1)
    const provider = await ctx.plugin((inner: Context) => {
      inner.provide('betterSidebar', { registerTab: () => { tabs++; return () => { releases++ } } })
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(tabs, 1)
    await provider.dispose()
    assert.equal(releases, 1)
    assert.equal(headers, 1, 'losing the provider preserves the usable fallback')
    await plugin.dispose()
    assert.equal(headers, 0)
  } finally { await ctx.fiber.dispose() }
})

test('SIDEBAR-VISIBLE: inactive tabs pause, active tabs serialize requests, and preset changes abort and reset', async () => {
  const source = reader()
  const localeSnapshot = {}
  const sessionSource = { getSnapshot: () => sessions, subscribe: subscribeSessions }
  const localeSource = { getSnapshot: () => localeSnapshot, subscribe: () => () => {} }
  const props = { readSnapshot: source.readSnapshot, sessions: sessionSource, locale: localeSource,
    t: (key: keyof typeof zh) => zh[key] }
  const draw = async (sessionId: string, visible: boolean) => {
    await act(async () => root.render(<SidebarObserver {...props} sessionId={sessionId} visible={visible} />))
  }
  await act(async () => setPreset('session-a', 'atn'))
  await draw('session-a', false)
  assert.equal(source.calls.length, 0)
  await draw('session-a', true)
  assert.equal(source.calls.length, 1)
  await new Promise(resolve => setTimeout(resolve, 1050))
  assert.equal(source.calls.length, 1)
  await finish(source.calls[0], snapshot('Visible sidebar data'))
  assert.match(document.body.textContent!, /Visible sidebar data/)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)) })
  await draw('session-a', false)
  assert.equal(source.calls[1].signal.aborted, true)
  await finish(source.calls[1], snapshot('Hidden late response'))
  assert.doesNotMatch(document.body.textContent!, /Hidden late response/)
  await draw('session-a', true)
  assert.equal(source.calls.length, 3)
  await act(async () => setPreset('session-a', 'standard'))
  assert.equal(source.calls[2].signal.aborted, true)
  assert.equal(document.querySelector('table'), null)
  await finish(source.calls[2], snapshot('Previous ATN response'))
  await act(async () => setPreset('session-a', 'atn'))
  assert.equal(source.calls.length, 4)
  assert.doesNotMatch(document.body.textContent!, /Previous ATN response|Visible sidebar data/)
  await act(async () => setPreset('session-b', 'atn'))
  await draw('session-b', true)
  assert.equal(source.calls[3].signal.aborted, true)
  assert.equal(source.calls[4].sessionId, 'session-b')
})

test('VIEW-PROPS: displays quotas, bounded submission history, abandoned attempts and locale-owned groups from props', async () => {
  const value = snapshot()
  value.network!.nodes[1].lifecycle = 'retired'
  await act(async () => root.render(<NetworkView sessionId="session-a" snapshot={value} error={null} selectedId="child"
    selectNode={() => {}} retry={() => {}} t={key => zh[key]} />))
  const row = [...document.querySelectorAll('tbody tr')].find(row => row.textContent?.includes('child'))!
  assert.match(row.textContent!, /已退出/)
  assert.ok([...row.querySelectorAll('td')].some(cell => cell.textContent === '38'))
  assert.ok([...row.querySelectorAll('td')].some(cell => cell.textContent === '1'))
  assert.match(row.textContent!, /0 \/ 1/)
  assert.match(document.querySelector(`section[aria-label="${zh.orphans}"]`)!.textContent!, /Run focused checks/)
  assert.equal(document.querySelector('svg'), null)
  await act(async () => root.render(<NetworkView sessionId="session-a" snapshot={value} error={null} selectedId={null}
    selectNode={() => {}} retry={() => {}} t={key => `[${key}]`} />))
  assert.ok(document.querySelector('section[aria-label="[collaboration]"]'))
  assert.ok(document.querySelector('section[aria-label="[birth]"]'))
  assert.match(document.body.textContent!, /\[remaining\]|\[peerQuota\]|\[fulfilment\]/)
  assert.doesNotMatch(document.body.textContent!, /剩余步数|协作邻接|创建关系/)
})

test('SIDEBAR-MENU: descriptor gates non-ATN sessions and uses right sidebar rather than bottom-only', async () => {
  const ctx = new Context()
  let tab: TabDescriptor | undefined
  const localeSnapshot = {}
  ctx.provide('slots', { inject: (_name: string, install: () => () => void) => ctx.effect(install), register: () => () => {} })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: keyof typeof zh) => zh[key],
    getSnapshot: () => localeSnapshot, subscribe: () => () => {} })
  ctx.provide('sessions', { list: { getSnapshot: () => sessions, subscribe: subscribeSessions } })
  ctx.provide('connection', { rpc: { call: async () => ({ ok: true, value: snapshot() }) } })
  ctx.provide('betterSidebar', { registerTab: (descriptor: TabDescriptor) => { tab = descriptor; return () => {} } })
  try {
    await ctx.plugin(ClientPlugin)
    assert.ok(tab)
    await act(async () => setPreset('session-a', 'standard'))
    assert.equal(tab.available!(ctx, { sessionId: 'session-a' }, {}), false)
    await act(async () => setPreset('session-a', 'atn'))
    assert.equal(tab.available!(ctx, { sessionId: 'session-a' }, {}), true)
    assert.equal('bottomOnly' in tab, false)
    await act(async () => root.render(tab!.component({ ctx, scope: { sessionId: 'session-a' },
      store: {}, tab: { id: 'tab1', type: 'atn-network', title: zh.title }, visible: true })))
    assert.match(document.body.textContent!, /Inspect actual network/)
  } finally { await act(async () => root.render(null)); await ctx.fiber.dispose() }
})
