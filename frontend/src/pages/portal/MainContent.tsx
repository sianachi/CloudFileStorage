import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../../api/client'
import { deleteEntry, downloadFile, listFiles } from '../../api/files'
import { useAuth } from '../../auth/AuthContext'
import { formatBytes } from '../../lib/format'
import type { FileEntry, ListResponse } from '../../types/files'
import { IconFile, IconFolderOpen, IconTrash } from './icons'
import { pathSegments, pathToUrl } from './path'
import { cn, focusRing } from './utils'

type Props = {
  currentPath: string
  refreshKey: number
  onMutate: () => void
}

export function MainContent({ currentPath, refreshKey, onMutate }: Props) {
  const { token } = useAuth()
  const navigate = useNavigate()

  const [listing, setListing] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    setError(null)
    listFiles(currentPath, token)
      .then((res) => {
        if (cancelled) return
        setListing(res)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof ApiRequestError && e.status === 404) {
          setError('This folder no longer exists.')
        } else if (e instanceof ApiRequestError) {
          setError(e.message)
        } else {
          setError('Could not load this folder.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentPath, refreshKey, token])

  const onOpenEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.is_directory) {
        navigate(pathToUrl(entry.path))
      } else if (token) {
        void downloadFile(entry.path, token).catch(() => {
          /* download errors surface via 401 listener or browser */
        })
      }
    },
    [navigate, token],
  )

  const onDelete = useCallback(
    async (entry: FileEntry) => {
      if (!token) return
      const confirmed = window.confirm(
        entry.is_directory
          ? `Delete folder "${entry.name}" and everything inside it?`
          : `Delete "${entry.name}"?`,
      )
      if (!confirmed) return
      try {
        await deleteEntry(entry.path, token)
        onMutate()
      } catch (e) {
        if (e instanceof ApiRequestError) {
          window.alert(e.message)
        }
      }
    },
    [onMutate, token],
  )

  const segments = pathSegments(currentPath)
  const entries = listing?.entries ?? []
  const isEmpty = !loading && entries.length === 0 && !error

  return (
    <main
      id="portal-main"
      className={cn(
        'min-h-0 min-w-0 flex-1 overflow-auto rounded-2xl bg-[var(--portal-surface)] shadow-[var(--portal-shadow-md)]',
        'px-4 py-6 sm:px-8 sm:py-8',
      )}
      tabIndex={-1}
    >
      <div className="mx-auto max-w-5xl">
        <Breadcrumb segments={segments} />

        {error ? (
          <p className="mt-8 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {loading && !listing ? (
          <p className="mt-12 text-center text-sm text-[var(--portal-muted)]">
            Loading…
          </p>
        ) : null}

        {isEmpty ? (
          <div className="mt-16 flex flex-col items-center gap-2 text-center">
            <p className="text-base text-[var(--portal-heading)]">
              This folder is empty.
            </p>
            <p className="text-sm text-[var(--portal-muted)]">
              Use the <span className="font-medium">New</span> button to upload
              a file or create a folder.
            </p>
          </div>
        ) : null}

        {entries.length > 0 ? (
          <ul role="list" className="mt-6 divide-y divide-[var(--portal-border)]">
            {entries.map((entry) => (
              <EntryRow
                key={entry.path}
                entry={entry}
                onOpen={() => onOpenEntry(entry)}
                onDelete={() => void onDelete(entry)}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </main>
  )
}

function Breadcrumb({ segments }: { segments: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Folder path" className="text-sm text-[var(--portal-muted)]">
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <BreadcrumbLink path="/" label="My Files" isLast={segments.length === 0} />
        </li>
        {segments.map((seg, idx) => (
          <li key={seg.path} className="flex items-center gap-1">
            <span aria-hidden>/</span>
            <BreadcrumbLink
              path={seg.path}
              label={seg.name}
              isLast={idx === segments.length - 1}
            />
          </li>
        ))}
      </ol>
    </nav>
  )
}

function BreadcrumbLink({
  path,
  label,
  isLast,
}: {
  path: string
  label: string
  isLast: boolean
}) {
  const navigate = useNavigate()
  if (isLast) {
    return (
      <span
        className="font-medium text-[var(--portal-heading)]"
        aria-current="page"
      >
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => navigate(pathToUrl(path))}
      className={cn(
        'rounded px-1 hover:underline',
        focusRing,
      )}
    >
      {label}
    </button>
  )
}

function EntryRow({
  entry,
  onOpen,
  onDelete,
}: {
  entry: FileEntry
  onOpen: () => void
  onDelete: () => void
}) {
  const Icon = entry.is_directory ? IconFolderOpen : IconFile
  return (
    <li className="group flex items-center gap-3 py-2">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left',
          'hover:bg-[var(--portal-chip-hover)]',
          focusRing,
        )}
      >
        <Icon
          className={cn(
            'size-5 shrink-0',
            entry.is_directory
              ? 'text-[var(--portal-active-text)]'
              : 'text-[var(--portal-muted)]',
          )}
          aria-hidden
        />
        <span className="flex-1 truncate text-sm font-medium text-[var(--portal-heading)]">
          {entry.name}
        </span>
        <span className="hidden text-xs text-[var(--portal-muted)] sm:inline">
          {entry.is_directory ? '—' : formatBytes(entry.size)}
        </span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${entry.name}`}
        className={cn(
          'rounded-full p-2 text-[var(--portal-muted)] opacity-0 group-hover:opacity-100',
          'hover:bg-[var(--portal-chip-hover)] hover:text-red-600 focus-visible:opacity-100',
          focusRing,
        )}
      >
        <IconTrash className="size-4" />
      </button>
    </li>
  )
}
