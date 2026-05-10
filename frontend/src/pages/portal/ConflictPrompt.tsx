import { useEffect, useRef } from 'react'
import { Modal } from '../../components/Modal'
import type { ConflictDecision } from '../../lib/folderUpload'

type Props = {
  /** The conflicting file's display label (relative path). */
  label: string
  onResolve: (decision: ConflictDecision) => void
}

export function ConflictPrompt({ label, onResolve }: Props) {
  // Default focus on Skip — the safe choice.
  const skipRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    skipRef.current?.focus()
  }, [])

  return (
    <Modal
      open
      onClose={() => onResolve('skip')}
      labelledBy="conflict-title"
      panelClassName="relative z-10 flex w-full max-w-md flex-col gap-4 rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-black/10 outline-none"
    >
      <div>
        <h2 id="conflict-title" className="text-base font-semibold text-neutral-900">
          A file with that name already exists
        </h2>
        <p className="mt-1 break-all text-sm text-neutral-600">{label}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onResolve('overwrite')}
          className="rounded-full bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Overwrite
        </button>
        <button
          type="button"
          onClick={() => onResolve('overwrite-all')}
          className="rounded-full border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Overwrite all
        </button>
        <button
          ref={skipRef}
          type="button"
          onClick={() => onResolve('skip')}
          className="rounded-full border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => onResolve('skip-all')}
          className="rounded-full border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Skip all
        </button>
      </div>
    </Modal>
  )
}
