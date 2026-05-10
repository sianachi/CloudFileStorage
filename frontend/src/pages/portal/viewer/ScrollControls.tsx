import type { RefObject } from 'react'
import { IconArrowDown, IconArrowUp } from '../icons'

type Props = {
  /** Scrollable element (the one with overflow-auto) to drive. */
  targetRef: RefObject<HTMLElement | null>
}

/**
 * Two floating buttons (top / bottom) that scroll the supplied element to
 * the start or end. Pinned bottom-right, dark theme to suit the viewer
 * body. Smooth scroll for a calmer feel.
 */
export function ScrollControls({ targetRef }: Props) {
  const scrollToTop = () => {
    targetRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const scrollToBottom = () => {
    const el = targetRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const btn =
    'rounded-full bg-white/10 p-2 text-white shadow-lg backdrop-blur-sm hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40'

  return (
    <div className="pointer-events-none absolute bottom-4 right-4 flex flex-col gap-2">
      <button
        type="button"
        onClick={scrollToTop}
        aria-label="Scroll to top"
        className={`pointer-events-auto ${btn}`}
      >
        <IconArrowUp className="size-4" />
      </button>
      <button
        type="button"
        onClick={scrollToBottom}
        aria-label="Scroll to bottom"
        className={`pointer-events-auto ${btn}`}
      >
        <IconArrowDown className="size-4" />
      </button>
    </div>
  )
}
