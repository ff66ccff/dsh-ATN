/** Component tests isolate the shared dialog from the desktop renderer. */
import type { ReactNode } from 'react'

export function Modal({ open, title, children }: { open: boolean; title: string; children?: ReactNode }) {
  return open ? <div role="dialog" aria-label={title}>{children}</div> : null
}
