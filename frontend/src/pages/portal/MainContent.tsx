import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../../api/client'
import {
  createFolder,
  deleteEntry,
  downloadFile,
  listFiles,
  renameEntry,
  uploadFile,
} from '../../api/files'
import { useAuth } from '../../auth/AuthContext'
import { formatBytes } from '../../lib/format'
import type { FileEntry, ListResponse } from '../../types/files'
import {
  IconFile,
  IconFolderOpen,
  IconFolderPlus,
  IconPencil,
  IconTrash,
  IconUpload,
} from './icons'
import { joinPath, pathSegments, pathToUrl } from './path'
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

  // Rename state lives at the parent so swapping rows in the listing
  // does not unmount the input mid-edit.
  const [renameTarget, setRenameTarget] = useState<string | null>(null)

  // Drag state — dragenter/leave fire on every nested element, so we
  // count instead of using a single boolean to avoid overlay flicker.
  const dragCounter = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<
    { current: number; total: number } | null
  >(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

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

  // Cancel any in-progress rename whenever the user navigates away.
  useEffect(() => {
    setRenameTarget(null)
  }, [currentPath])

  const onOpenEntry = useCallback(
    (entry: FileEntry) => {
      if (entry.is_directory) {
        navigate(pathToUrl(entry.path))
      } else if (token) {
        void downloadFile(entry.path, token).catch(() => {
          /* errors surface via 401 listener or browser */
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

  const onRenameSubmit = useCallback(
    async (path: string, newName: string) => {
      if (!token) {
        setRenameTarget(null)
        return
      }
      try {
        await renameEntry(path, newName, token)
        onMutate()
      } catch (err) {
        if (err instanceof ApiRequestError) {
          window.alert(`Could not rename: ${err.message}`)
        }
      } finally {
        setRenameTarget(null)
      }
    },
    [onMutate, token],
  )

  const onCreateFolder = useCallback(async () => {
    if (!token) return
    const name = window.prompt('New folder name')?.trim()
    if (!name) return
    if (name.includes('/')) {
      window.alert('Folder names cannot contain slashes.')
      return
    }
    try {
      await createFolder(joinPath(currentPath, name), token)
      onMutate()
    } catch (err) {
      if (err instanceof ApiRequestError) {
        window.alert(`Could not create folder: ${err.message}`)
      }
    }
  }, [currentPath, onMutate, token])

  const uploadMany = useCallback(
    async (files: File[]) => {
      if (!token || files.length === 0) return
      setUploadProgress({ current: 0, total: files.length })
      const failures: string[] = []
      for (let i = 0; i < files.length; i++) {
        try {
          await uploadFile(currentPath, files[i], token)
        } catch {
          failures.push(files[i].name)
        }
        setUploadProgress({ current: i + 1, total: files.length })
      }
      setUploadProgress(null)
      onMutate()
      if (failures.length > 0) {
        window.alert(`Could not upload: ${failures.join(', ')}`)
      }
    },
    [currentPath, onMutate, token],
  )

  const onPickFile = () => fileInputRef.current?.click()

  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    await uploadMany(files)
  }

  const onDragEnter = (e: React.DragEvent<HTMLElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounter.current += 1
    setDragActive(true)
  }
  const onDragOver = (e: React.DragEvent<HTMLElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e: React.DragEvent<HTMLElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounter.current = Math.max(0, dragCounter.current - 1)
    if (dragCounter.current === 0) setDragActive(false)
  }
  const onDrop = async (e: React.DragEvent<HTMLElement>) => {
    e.preventDefault()
    dragCounter.current = 0
    setDragActive(false)
    // dataTransfer.files only includes top-level files; folder drops
    // need webkitGetAsEntry, which we deliberately skip for now.
    const files = Array.from(e.dataTransfer.files ?? [])
    await uploadMany(files)
  }

  const segments = pathSegments(currentPath)
  const entries = listing?.entries ?? []
  const isEmpty = !loading && entries.length === 0 && !error

  return (
    <main
      id="portal-main"
      className={cn(
        'relative min-h-0 min-w-0 flex-1 overflow-auto rounded-2xl bg-[var(--portal-surface)] shadow-[var(--portal-shadow-md)]',
        'px-4 py-6 sm:px-8 sm:py-8',
      )}
      tabIndex={-1}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e)}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Breadcrumb segments={segments} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onCreateFolder()}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border border-[var(--portal-border)] px-3 py-1.5 text-sm font-medium text-[var(--portal-heading)]',
                'hover:bg-[var(--portal-chip-hover)]',
                focusRing,
              )}
            >
              <IconFolderPlus className="size-4" />
              New folder
            </button>
            <button
              type="button"
              onClick={onPickFile}
              className={cn(
                'inline-flex items-center gap-2 rounded-full bg-[var(--portal-active)] px-3 py-1.5 text-sm font-medium text-[var(--portal-active-text)]',
                'hover:brightness-95',
                focusRing,
              )}
            >
              <IconUpload className="size-4" />
              Upload
            </button>
          </div>
        </div>

        {uploadProgress ? (
          <p className="rounded-2xl bg-[var(--portal-chip-hover)] px-4 py-2 text-sm text-[var(--portal-heading)]">
            Uploading {uploadProgress.current} of {uploadProgress.total}…
          </p>
        ) : null}

        {error ? (
          <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {loading && !listing ? (
          <p className="mt-12 text-center text-sm text-[var(--portal-muted)]">
            Loading…
          </p>
        ) : null}

        {isEmpty ? <EmptyState onUpload={onPickFile} onNewFolder={() => void onCreateFolder()} /> : null}

        {entries.length > 0 ? (
          <ul role="list" className="mt-2 divide-y divide-[var(--portal-border)]">
            {entries.map((entry) => (
              <EntryRow
                key={entry.path}
                entry={entry}
                isRenaming={renameTarget === entry.path}
                onOpen={() => onOpenEntry(entry)}
                onDelete={() => void onDelete(entry)}
                onRenameStart={() => setRenameTarget(entry.path)}
                onRenameCancel={() => setRenameTarget(null)}
                onRenameCommit={(newName) => void onRenameSubmit(entry.path, newName)}
              />
            ))}
          </ul>
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void onFileInputChange(e)}
      />

      {dragActive ? <DropOverlay /> : null}
    </main>
  )
}

function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-[var(--portal-active-text)] bg-[var(--portal-active)]/40 backdrop-blur-sm">
      <p className="text-base font-medium text-[var(--portal-active-text)]">
        Drop files to upload
      </p>
    </div>
  )
}

function EmptyState({
  onUpload,
  onNewFolder,
}: {
  onUpload: () => void
  onNewFolder: () => void
}) {
  return (
    <div className="mt-16 flex flex-col items-center gap-4 text-center">
      <p className="text-base text-[var(--portal-heading)]">
        This folder is empty.
      </p>
      <p className="text-sm text-[var(--portal-muted)]">
        Drop files here, or use the buttons below.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onUpload}
          className={cn(
            'inline-flex items-center gap-2 rounded-full bg-[var(--portal-active)] px-4 py-2 text-sm font-medium text-[var(--portal-active-text)]',
            'hover:brightness-95',
            focusRing,
          )}
        >
          <IconUpload className="size-4" />
          Upload file
        </button>
        <button
          type="button"
          onClick={onNewFolder}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border border-[var(--portal-border)] px-4 py-2 text-sm font-medium text-[var(--portal-heading)]',
            'hover:bg-[var(--portal-chip-hover)]',
            focusRing,
          )}
        >
          <IconFolderPlus className="size-4" />
          New folder
        </button>
      </div>
    </div>
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
      <span className="font-medium text-[var(--portal-heading)]" aria-current="page">
        {label}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => navigate(pathToUrl(path))}
      className={cn('rounded px-1 hover:underline', focusRing)}
    >
      {label}
    </button>
  )
}

function EntryRow({
  entry,
  isRenaming,
  onOpen,
  onDelete,
  onRenameStart,
  onRenameCancel,
  onRenameCommit,
}: {
  entry: FileEntry
  isRenaming: boolean
  onOpen: () => void
  onDelete: () => void
  onRenameStart: () => void
  onRenameCancel: () => void
  onRenameCommit: (newName: string) => void
}) {
  const Icon = entry.is_directory ? IconFolderOpen : IconFile
  return (
    <li className="group flex items-center gap-3 py-2">
      {isRenaming ? (
        <RenameField
          initial={entry.name}
          onCancel={onRenameCancel}
          onCommit={onRenameCommit}
          icon={
            <Icon
              className={cn(
                'size-5 shrink-0',
                entry.is_directory
                  ? 'text-[var(--portal-active-text)]'
                  : 'text-[var(--portal-muted)]',
              )}
              aria-hidden
            />
          }
        />
      ) : (
        <>
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
            onClick={onRenameStart}
            aria-label={`Rename ${entry.name}`}
            className={cn(
              'rounded-full p-2 text-[var(--portal-muted)] opacity-0 group-hover:opacity-100',
              'hover:bg-[var(--portal-chip-hover)] hover:text-[var(--portal-heading)] focus-visible:opacity-100',
              focusRing,
            )}
          >
            <IconPencil className="size-4" />
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
        </>
      )}
    </li>
  )
}

function RenameField({
  initial,
  icon,
  onCommit,
  onCancel,
}: {
  initial: string
  icon: React.ReactNode
  onCommit: (newName: string) => void
  onCancel: () => void
}) {
  // submittedRef keeps Enter + onBlur from firing the handler twice.
  const submittedRef = useRef(false)

  const finish = (raw: string) => {
    if (submittedRef.current) return
    submittedRef.current = true
    const v = raw.trim()
    if (!v || v === initial) {
      onCancel()
    } else {
      onCommit(v)
    }
  }

  return (
    <div className="flex flex-1 items-center gap-3 rounded-xl bg-[var(--portal-chip-hover)] px-2 py-2">
      {icon}
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        defaultValue={initial}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            finish(e.currentTarget.value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            submittedRef.current = true
            onCancel()
          }
        }}
        onBlur={(e) => finish(e.currentTarget.value)}
        onFocus={(e) => {
          // Select the basename so typing replaces it but the extension
          // stays visible.
          const dot = e.currentTarget.value.lastIndexOf('.')
          if (dot > 0) e.currentTarget.setSelectionRange(0, dot)
          else e.currentTarget.select()
        }}
        className={cn(
          'flex-1 rounded bg-[var(--portal-surface)] px-2 py-1 text-sm text-[var(--portal-heading)]',
          focusRing,
        )}
      />
    </div>
  )
}
