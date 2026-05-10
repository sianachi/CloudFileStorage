import { lazy, Suspense, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Modal } from '../../../components/Modal'
import { downloadFile } from '../../../api/files'
import { useAuth } from '../../../auth/AuthContext'
import { pickViewer } from './pickViewer'
import { ImageViewer } from './ImageViewer'
import { PdfViewer } from './PdfViewer'
import { VideoViewer } from './VideoViewer'
import { ZipViewer } from './ZipViewer'
import { TextViewer } from './TextViewer'
import { HexViewer } from './HexViewer'

// MDXEditor pulls in Lexical + CodeMirror (~700 KB). Code-split so it only
// loads when the user actually opens a markdown file.
const MarkdownEditor = lazy(() =>
  import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })),
)

function basenameOf(path: string): string {
  return path.split('/').pop() || path
}

type Override = 'text' | 'hex' | null

function readOverride(raw: string | null): Override {
  return raw === 'text' || raw === 'hex' ? raw : null
}

/**
 * Mounted alongside the Portal. Visible only when the URL carries a
 * `?view=<path>` query param. Closing removes the param without changing
 * the folder route, so the user lands back on the same listing.
 *
 * `?as=text|hex` is an optional override the user picks from the "no
 * preview" fallback when none of the auto-detected viewers can render
 * the file. The override survives reload and is shareable.
 */
export function ViewerPage() {
  const [params, setParams] = useSearchParams()
  const { token } = useAuth()

  const path = params.get('view')
  const override = readOverride(params.get('as'))

  const close = useCallback(() => {
    const next = new URLSearchParams(params)
    next.delete('view')
    next.delete('as')
    setParams(next)
  }, [params, setParams])

  const setOverride = useCallback(
    (next: Override) => {
      const np = new URLSearchParams(params)
      if (next === null) np.delete('as')
      else np.set('as', next)
      setParams(np)
    },
    [params, setParams],
  )

  const onDownload = useCallback(() => {
    if (!token || !path) return
    void downloadFile(path, token).catch(() => {
      /* errors surface via 401 listener or browser */
    })
  }, [path, token])

  if (!path) return null
  if (!token) return null

  const name = basenameOf(path)
  const detected = pickViewer(name)
  const effective = override ?? detected

  return (
    <Modal open onClose={close} labelledBy="viewer-title">
      <Header title={name} onDownload={onDownload} onClose={close} />
      <div className="flex min-h-[60vh] flex-1 flex-col bg-neutral-900">
        {effective === 'image' ? <ImageViewer key={path} path={path} token={token} /> : null}
        {effective === 'pdf' ? <PdfViewer key={path} path={path} token={token} /> : null}
        {effective === 'video' ? <VideoViewer key={path} path={path} token={token} /> : null}
        {effective === 'zip' ? <ZipViewer key={path} path={path} token={token} /> : null}
        {effective === 'text' ? <TextViewer key={path} path={path} token={token} /> : null}
        {effective === 'hex' ? <HexViewer key={path} path={path} token={token} /> : null}
        {effective === 'markdown' ? (
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-400">
                Loading editor…
              </div>
            }
          >
            <MarkdownEditor key={path} path={path} token={token} />
          </Suspense>
        ) : null}
        {effective === 'other' ? (
          <UnknownFallback
            onDownload={onDownload}
            onOpenAsText={() => setOverride('text')}
            onOpenAsHex={() => setOverride('hex')}
          />
        ) : null}
      </div>
    </Modal>
  )
}

function UnknownFallback({
  onDownload,
  onOpenAsText,
  onOpenAsHex,
}: {
  onDownload: () => void
  onOpenAsText: () => void
  onOpenAsHex: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center text-neutral-200">
      <p className="text-sm">No preview available for this file type.</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onDownload}
          className="rounded-full bg-white px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900"
        >
          Download instead
        </button>
        <button
          type="button"
          onClick={onOpenAsText}
          className="rounded-full border border-white/30 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900"
        >
          Open as text
        </button>
        <button
          type="button"
          onClick={onOpenAsHex}
          className="rounded-full border border-white/30 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-900"
        >
          Open as hex
        </button>
      </div>
    </div>
  )
}

function Header({
  title,
  onDownload,
  onClose,
}: {
  title: string
  onDownload: () => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
      <h2
        id="viewer-title"
        className="flex-1 truncate text-sm font-medium text-neutral-900"
      >
        {title}
      </h2>
      <button
        type="button"
        onClick={onDownload}
        className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
      >
        Download
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close viewer"
        className="rounded-full p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-12 12" />
        </svg>
      </button>
    </div>
  )
}
