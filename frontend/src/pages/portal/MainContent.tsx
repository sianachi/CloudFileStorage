import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiRequestError } from '../../api/client'
import {
  createFolder,
  deleteEntry,
  downloadFolder,
  listFiles,
  renameEntry,
  uploadFile,
} from '../../api/files'
import { useAuth } from '../../auth/AuthContext'
import { formatBytes } from '../../lib/format'
import {
  fromDirectoryInput,
  readDataTransferTree,
  uploadItems,
  type ConflictDecision,
  type UploadItem,
} from '../../lib/folderUpload'
import { ConflictPrompt } from './ConflictPrompt'
import type { FileEntry, ListResponse } from '../../types/files'
import {
  IconArchive,
  IconDownload,
  IconFile,
  IconFilePlus,
  IconFolderOpen,
  IconFolderPlus,
  IconFolderUpload,
  IconImage,
  IconPdf,
  IconPencil,
  IconTrash,
  IconUpload,
  IconVideo,
} from './icons'
import { joinPath, parentOf, pathSegments, pathToUrl } from './path'
import { cn, focusRing } from './utils'
import { Thumbnail } from './Thumbnail'
import { ViewToolbar } from './ViewToolbar'
import {
  GRID_COLS_BY_SIZE,
  SHOWS_THUMBNAIL,
  TILE_ICON_CLASS,
  useIconSize,
  useViewMode,
  type IconSize,
} from './viewSettings'
import { pickViewer, type ViewerKind } from './viewer/pickViewer'

type Props = {
  currentPath: string
  refreshKey: number
  onMutate: () => void
}

export function MainContent({ currentPath, refreshKey, onMutate }: Props) {
  const { token } = useAuth()
  const navigate = useNavigate()
  const [, setSearchParams] = useSearchParams()
  const [viewMode, setViewMode] = useViewMode()
  const [iconSize, setIconSize] = useIconSize()

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
  const [downloadProgress, setDownloadProgress] = useState<
    { name: string; received: number } | null
  >(null)

  // Active conflict prompt (head of an internal queue). Only one shows at
  // a time, even when 3 upload workers race into 409s simultaneously.
  const [conflict, setConflict] = useState<{
    label: string
    resolve: (d: ConflictDecision) => void
  } | null>(null)
  const conflictQueueRef = useRef<
    Array<{ label: string; resolve: (d: ConflictDecision) => void }>
  >([])

  const enqueueConflict = useCallback(
    (label: string): Promise<ConflictDecision> => {
      return new Promise((resolve) => {
        const entry = { label, resolve }
        conflictQueueRef.current.push(entry)
        // If nothing is showing, surface this one immediately.
        setConflict((current) => current ?? entry)
      })
    },
    [],
  )

  const resolveConflict = useCallback((decision: ConflictDecision) => {
    const head = conflictQueueRef.current.shift()
    head?.resolve(decision)
    const next = conflictQueueRef.current[0] ?? null
    setConflict(next)
  }, [])

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)

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
      } else {
        setSearchParams({ view: entry.path })
      }
    },
    [navigate, setSearchParams],
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

  const onCreateFile = useCallback(async () => {
    if (!token) return
    const name = window.prompt('New file name (include the extension, e.g. notes.md)')?.trim()
    if (!name) return
    if (name.includes('/') || name === '.' || name === '..') {
      window.alert('File names cannot contain slashes.')
      return
    }
    try {
      // An empty File blob produces an empty file on the server. The
      // markdown editor (or any other viewer) opens it ready to edit.
      const empty = new File([], name)
      const created = await uploadFile(currentPath, empty, token)
      onMutate()
      setSearchParams({ view: created.path })
    } catch (err) {
      if (err instanceof ApiRequestError) {
        window.alert(`Could not create file: ${err.message}`)
      }
    }
  }, [currentPath, onMutate, setSearchParams, token])

  const runUpload = useCallback(
    async (items: UploadItem[]) => {
      if (!token || items.length === 0) return
      setUploadProgress({ current: 0, total: items.length })
      const result = await uploadItems(items, currentPath, token, {
        onProgress: (p) => {
          setUploadProgress({ current: p.current, total: p.total })
        },
        onConflict: enqueueConflict,
      })
      setUploadProgress(null)
      onMutate()
      if (result.failures.length > 0) {
        window.alert(`Could not upload: ${result.failures.join(', ')}`)
      }
    },
    [currentPath, enqueueConflict, onMutate, token],
  )

  const onPickFile = () => fileInputRef.current?.click()
  const onPickFolder = () => folderInputRef.current?.click()

  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    e.target.value = ''
    if (!files || files.length === 0) return
    const items: UploadItem[] = Array.from(files).map((file) => ({
      relativeParent: '',
      file,
    }))
    await runUpload(items)
  }

  const onFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    e.target.value = ''
    if (!files || files.length === 0) return
    await runUpload(fromDirectoryInput(files))
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
    // Use the items API so folder drops walk the subtree. Falls back to
    // dataTransfer.files when items isn't available (rare).
    const items = e.dataTransfer.items
    if (items && items.length > 0) {
      const tree = await readDataTransferTree(items)
      await runUpload(tree)
      return
    }
    const files = Array.from(e.dataTransfer.files ?? [])
    await runUpload(files.map((file) => ({ relativeParent: '', file })))
  }

  const onDownloadFolder = useCallback(
    async (entry: FileEntry) => {
      if (!token) return
      setDownloadProgress({ name: entry.name, received: 0 })
      try {
        await downloadFolder(entry.path, token, (received) => {
          setDownloadProgress({ name: entry.name, received })
        })
      } catch (err) {
        if (err instanceof ApiRequestError) {
          window.alert(`Could not download folder: ${err.message}`)
        }
      } finally {
        setDownloadProgress(null)
      }
    },
    [token],
  )

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
          <div className="flex flex-wrap items-center gap-2">
            <ViewToolbar
              mode={viewMode}
              onModeChange={setViewMode}
              size={iconSize}
              onSizeChange={setIconSize}
            />
            <button
              type="button"
              onClick={() => void onCreateFile()}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border border-[var(--portal-border)] px-3 py-1.5 text-sm font-medium text-[var(--portal-heading)]',
                'hover:bg-[var(--portal-chip-hover)]',
                focusRing,
              )}
            >
              <IconFilePlus className="size-4" />
              New file
            </button>
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
              onClick={onPickFolder}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border border-[var(--portal-border)] px-3 py-1.5 text-sm font-medium text-[var(--portal-heading)]',
                'hover:bg-[var(--portal-chip-hover)]',
                focusRing,
              )}
            >
              <IconFolderUpload className="size-4" />
              Upload folder
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

        {downloadProgress ? (
          <p className="rounded-2xl bg-[var(--portal-chip-hover)] px-4 py-2 text-sm text-[var(--portal-heading)]">
            Downloading {downloadProgress.name}.zip — {formatBytes(downloadProgress.received)}
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

        {entries.length > 0 || currentPath !== '/' ? (
          viewMode === 'list' ? (
            <ul role="list" className="mt-2 divide-y divide-[var(--portal-border)]">
              {currentPath !== '/' ? (
                <ParentRow onOpen={() => navigate(pathToUrl(parentOf(currentPath)))} />
              ) : null}
              {entries.map((entry) => (
                <EntryRow
                  key={entry.path}
                  entry={entry}
                  isRenaming={renameTarget === entry.path}
                  onOpen={() => onOpenEntry(entry)}
                  onDelete={() => void onDelete(entry)}
                  onDownloadFolder={() => void onDownloadFolder(entry)}
                  onRenameStart={() => setRenameTarget(entry.path)}
                  onRenameCancel={() => setRenameTarget(null)}
                  onRenameCommit={(newName) => void onRenameSubmit(entry.path, newName)}
                />
              ))}
            </ul>
          ) : (
            <ul role="list" className={cn('mt-2 grid gap-3', GRID_COLS_BY_SIZE[iconSize])}>
              {currentPath !== '/' ? (
                <ParentTile
                  size={iconSize}
                  onOpen={() => navigate(pathToUrl(parentOf(currentPath)))}
                />
              ) : null}
              {entries.map((entry) => (
                <EntryTile
                  key={entry.path}
                  entry={entry}
                  size={iconSize}
                  token={token}
                  onOpen={() => onOpenEntry(entry)}
                />
              ))}
            </ul>
          )
        ) : null}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void onFileInputChange(e)}
      />
      <input
        ref={folderInputRef}
        type="file"
        // webkitdirectory is the de-facto standard for folder pickers; a
        // typed React prop doesn't exist, so we cast.
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        multiple
        className="hidden"
        onChange={(e) => void onFolderInputChange(e)}
      />

      {dragActive ? <DropOverlay /> : null}

      {conflict ? (
        <ConflictPrompt
          label={conflict.label}
          onResolve={resolveConflict}
        />
      ) : null}
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

type IconComponent = (props: { className?: string }) => React.ReactElement

const FILE_KIND_VISUAL: Record<ViewerKind, { Icon: IconComponent; color: string }> = {
  image: { Icon: IconImage, color: 'text-emerald-500' },
  pdf: { Icon: IconPdf, color: 'text-red-500' },
  video: { Icon: IconVideo, color: 'text-violet-500' },
  zip: { Icon: IconArchive, color: 'text-amber-500' },
  markdown: { Icon: IconFile, color: 'text-sky-500' },
  other: { Icon: IconFile, color: 'text-[var(--portal-muted)]' },
}

function visualForEntry(entry: FileEntry): { Icon: IconComponent; color: string } {
  if (entry.is_directory) {
    return { Icon: IconFolderOpen, color: 'text-[var(--portal-active-text)]' }
  }
  return FILE_KIND_VISUAL[pickViewer(entry.name)]
}

function ParentRow({ onOpen }: { onOpen: () => void }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left',
          'hover:bg-[var(--portal-chip-hover)]',
          focusRing,
        )}
      >
        <IconFolderOpen
          className="size-5 shrink-0 text-[var(--portal-muted)]"
          aria-hidden
        />
        <span className="flex-1 truncate text-sm font-medium text-[var(--portal-heading)]">
          ..
        </span>
        <span className="hidden text-xs text-[var(--portal-muted)] sm:inline">
          Parent folder
        </span>
      </button>
    </li>
  )
}

function EntryRow({
  entry,
  isRenaming,
  onOpen,
  onDelete,
  onDownloadFolder,
  onRenameStart,
  onRenameCancel,
  onRenameCommit,
}: {
  entry: FileEntry
  isRenaming: boolean
  onOpen: () => void
  onDelete: () => void
  onDownloadFolder: () => void
  onRenameStart: () => void
  onRenameCancel: () => void
  onRenameCommit: (newName: string) => void
}) {
  const { Icon, color } = visualForEntry(entry)
  return (
    <li className="group flex items-center gap-3 py-2">
      {isRenaming ? (
        <RenameField
          initial={entry.name}
          onCancel={onRenameCancel}
          onCommit={onRenameCommit}
          icon={
            <Icon
              className={cn('size-5 shrink-0', color)}
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
              className={cn('size-5 shrink-0', color)}
              aria-hidden
            />
            <span className="flex-1 truncate text-sm font-medium text-[var(--portal-heading)]">
              {entry.name}
            </span>
            <span className="hidden text-xs text-[var(--portal-muted)] sm:inline">
              {entry.is_directory ? '—' : formatBytes(entry.size)}
            </span>
          </button>
          {entry.is_directory ? (
            <button
              type="button"
              onClick={onDownloadFolder}
              aria-label={`Download ${entry.name} as zip`}
              title="Download as zip"
              className={cn(
                'rounded-full p-2 text-[var(--portal-muted)] opacity-0 group-hover:opacity-100',
                'hover:bg-[var(--portal-chip-hover)] hover:text-[var(--portal-heading)] focus-visible:opacity-100',
                focusRing,
              )}
            >
              <IconDownload className="size-4" />
            </button>
          ) : null}
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

function ParentTile({ size, onOpen }: { size: IconSize; onOpen: () => void }) {
  const iconClass = TILE_ICON_CLASS[size]
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group flex w-full flex-col items-stretch gap-2 rounded-2xl border border-[var(--portal-border)] bg-[var(--portal-surface)] p-2 text-left',
          'hover:border-[var(--portal-active-text)]/40 hover:shadow-sm',
          focusRing,
        )}
      >
        <div className="relative flex aspect-square w-full items-center justify-center rounded-xl bg-[var(--portal-chip-hover)]">
          <IconFolderOpen className={cn(iconClass, 'text-[var(--portal-muted)]')} />
        </div>
        <div className="px-1 pb-1">
          <p className="truncate text-center text-sm font-medium text-[var(--portal-heading)]">..</p>
          <p className="truncate text-center text-xs text-[var(--portal-muted)]">Parent folder</p>
        </div>
      </button>
    </li>
  )
}

function EntryTile({
  entry,
  size,
  token,
  onOpen,
}: {
  entry: FileEntry
  size: IconSize
  token: string | null
  onOpen: () => void
}) {
  const { Icon, color } = visualForEntry(entry)
  const kind = entry.is_directory ? 'folder' : pickViewer(entry.name)
  const showThumb = !entry.is_directory && kind === 'image' && SHOWS_THUMBNAIL[size] && token !== null
  const iconClass = TILE_ICON_CLASS[size]

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={entry.name}
        className={cn(
          'group flex w-full flex-col items-stretch gap-2 rounded-2xl border border-[var(--portal-border)] bg-[var(--portal-surface)] p-2 text-left',
          'hover:border-[var(--portal-active-text)]/40 hover:shadow-sm',
          focusRing,
        )}
      >
        <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-[var(--portal-chip-hover)]">
          <Icon className={cn(iconClass, 'shrink-0', color)} />
          {showThumb && token ? (
            <div className="absolute inset-0">
              <Thumbnail path={entry.path} token={token} alt={entry.name} />
            </div>
          ) : null}
        </div>
        <div className="px-1 pb-1">
          <p className="truncate text-center text-sm font-medium text-[var(--portal-heading)]">
            {entry.name}
          </p>
          <p className="truncate text-center text-xs text-[var(--portal-muted)]">
            {entry.is_directory ? 'Folder' : formatBytes(entry.size)}
          </p>
        </div>
      </button>
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
