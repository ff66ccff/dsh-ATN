/** Component tests isolate the shared dialog from the desktop renderer. */
import type { ReactNode } from 'react'

/** Registry tests never render the provider's unrelated file icons. */
export function FileTypeIcon(): ReactNode { return null }

export function Modal({ open, title, children }: { open: boolean; title: string; children?: ReactNode }) {
  return open ? <div role="dialog" aria-label={title}>{children}</div> : null
}
