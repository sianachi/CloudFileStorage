import { useEffect, useRef, type ReactNode } from 'react'

type Props = {
  open: boolean
  onClose: () => void
  /** Accessible name for the dialog. Read by screen readers as the modal's title. */
  labelledBy?: string
  /** Optional className applied to the inner panel that holds children. */
  panelClassName?: string
  children: ReactNode
}

export function Modal({ open, onClose, labelledBy, panelClassName, children }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  // Restore focus to whatever was focused before the modal opened.
  const prevFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    prevFocusRef.current = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)

    // Lock the body scroll so background content doesn't move under the
    // backdrop while the modal is open.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      prevFocusRef.current?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={
          panelClassName ??
          'relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 outline-none'
        }
      >
        {children}
      </div>
    </div>
  )
}
