import React, { type ReactNode } from 'react'

export function Modal({
  open,
  title,
  className,
  children,
}: {
  open: boolean
  onClose?: () => void
  title: string
  className?: string
  children?: ReactNode
  headless?: boolean
}) {
  if (!open) return null
  return (
    <div className="atn-modal-overlay">
      <div className={`atn-modal-window ${className ?? ''}`} role="dialog" aria-label={title}>
        {children}
      </div>
    </div>
  )
}
