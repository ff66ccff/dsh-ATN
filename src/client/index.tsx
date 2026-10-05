/** Native Harness header registration for the read-only ATN observer. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NetworkAction, type NetworkActionInjected } from './NetworkAction.tsx'
import { NS, en, zh, type AtnKey } from './locales.ts'
import { styles } from './styles.ts'
import { createSnapshotReader, transportInject } from './transport.ts'

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
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'atn-network', order: 10, locale: NS,
    inject: (): NetworkActionInjected => ({ readSnapshot }),
  }, NetworkAction))
}
