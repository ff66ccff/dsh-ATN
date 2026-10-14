/** Native Harness header registration for the read-only ATN observer. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from 'dsh-better-sidebar'
import { NetworkAction, type NetworkActionInjected } from './NetworkAction.tsx'
import { NS, en, zh, type AtnKey } from './locales.ts'
import { styles } from './styles.ts'
import { createSnapshotReader, transportInject } from './transport.ts'
import { SidebarObserver } from './SidebarObserver.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'atn-network': AtnKey }
}

/** Services needed by native UI registration and the observer transport. */
export const inject = ['slots', 'locale', ...transportInject]

/**
 * Install the native toolbar action and release style and locale contributions on unload.
 * @param ctx - Browser-side Cordis context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'atn observer: dictionaries')
  ctx.effect(() => {
    const sheet = document.createElement('style')
    sheet.dataset.plugin = 'dsh-atn'
    sheet.textContent = styles
    document.head.appendChild(sheet)
    return () => { sheet.remove() }
  }, 'atn observer: styles')
  const readSnapshot = createSnapshotReader(ctx)
  ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'atn-network', order: 10, locale: NS,
    inject: (): NetworkActionInjected => ({ readSnapshot }),
  }, NetworkAction)), 'atn observer: header action')
  // A pending child scope cannot prevent the parent header, styles or locale from activating.
  ctx.inject(['betterSidebar', 'sessions'], inner => {
    const sidebar = inner.betterSidebar
    const sessions = inner.sessions.list
    const locale = inner.locale
    const t = locale.bind(NS)
    inner.effect(() => sidebar.registerTab({
      id: 'atn-network', title: () => t('title'), description: () => t('description'), order: 50, single: true,
      available: (_ctx, scope) => Object.entries(sessions.getSnapshot().byId).some(([id, summary]) =>
        id === scope.sessionId && summary.projectionValues?.agentPreset === 'atn'),
      component: ({ scope, visible }) => <SidebarObserver sessionId={scope.sessionId} visible={visible}
        sessions={sessions} locale={locale} t={t} readSnapshot={readSnapshot} />,
    }), 'atn observer: optional sidebar tab')
  })
}
