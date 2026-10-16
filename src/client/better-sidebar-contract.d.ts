/** Narrow, type-only projection of dsh-better-sidebar 0.26.1 / 0.27.0's Tab API.
 * Consumer-owned to keep an optional provider out of the development dependency graph.
 * Source: src/client/service.ts:149-167 (TabComponentProps), 168-292 (TabDescriptor); no runtime provider or compatibility shim.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'

export interface TabComponentProps {
    ctx: Context
    store: unknown
    scope: { sessionId: string; cwd?: string }
    tab: { id: string; type: string; title: string; path?: string; line?: number; meta?: unknown }
    visible: boolean
  }
export interface TabDescriptor {
    id: string
    title: string | (() => string)
    description?: string | (() => string)
    order?: number
    single?: boolean
    available?: (ctx: Context, scope: { sessionId: string; cwd?: string }, state: unknown) => boolean
    component: (props: TabComponentProps) => ReactNode
}
export interface BetterSidebarRegistration {
  registerTab(descriptor: TabDescriptor): () => void
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    betterSidebar: BetterSidebarRegistration
  }
}
