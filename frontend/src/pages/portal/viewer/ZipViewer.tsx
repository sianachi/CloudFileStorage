import { useEffect, useMemo, useState } from 'react'
import { listZipEntries } from '../../../api/files'
import type { ZipEntryDto } from '../../../types/files'
import {
  IconArchive,
  IconChevronRight,
  IconFile,
  IconFolderSmall,
  IconImage,
  IconPdf,
  IconVideo,
} from '../icons'
import {
  GRID_COLS_BY_SIZE,
  TILE_ICON_CLASS,
  useIconSize,
  useViewMode,
  type IconSize,
} from '../viewSettings'
import { ViewToolbar } from '../ViewToolbar'
import { pickViewer, type ViewerKind } from './pickViewer'

type Props = {
  path: string
  token: string
}

type ZipDir = {
  folders: Set<string>
  files: ZipEntryDto[]
}

type ZipTree = Map<string, ZipDir>

function basenameOf(name: string): string {
  return name.split('/').filter(Boolean).pop() || name
}

/**
 * Convert the flat entry list from the backend into a path → contents map
 * so we can render one directory at a time. Handles both explicit dir
 * entries (trailing /) and implicit dirs (folders that only exist because
 * a deeper file path passes through them).
 */
function buildTree(entries: ZipEntryDto[]): ZipTree {
  const tree: ZipTree = new Map()
  const ensure = (p: string): ZipDir => {
    let node = tree.get(p)
    if (!node) {
      node = { folders: new Set<string>(), files: [] }
      tree.set(p, node)
    }
    return node
  }
  ensure('')

  for (const entry of entries) {
    const trimmed = entry.name.replace(/\/+$/, '')
    if (!trimmed) continue
    const parts = trimmed.split('/')

    const lastIsFolder = entry.is_dir
    const folderSegmentCount = lastIsFolder ? parts.length : parts.length - 1
    for (let i = 0; i < folderSegmentCount; i++) {
      const parent = parts.slice(0, i).join('/')
      ensure(parent).folders.add(parts[i])
    }

    if (lastIsFolder) {
      ensure(parts.join('/'))
    } else {
      const parentPath = parts.slice(0, -1).join('/')
      ensure(parentPath).files.push(entry)
    }
  }

  return tree
}

const KIND_TO_VISUAL: Record<ViewerKind, { Icon: typeof IconFile; color: string }> = {
  image: { Icon: IconImage, color: 'text-emerald-400' },
  pdf: { Icon: IconPdf, color: 'text-red-400' },
  video: { Icon: IconVideo, color: 'text-violet-400' },
  zip: { Icon: IconArchive, color: 'text-amber-400' },
  markdown: { Icon: IconFile, color: 'text-sky-400' },
  other: { Icon: IconFile, color: 'text-neutral-400' },
}

export function ZipViewer({ path, token }: Props) {
  const [entries, setEntries] = useState<ZipEntryDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentDir, setCurrentDir] = useState<string>('')
  const [viewMode, setViewMode] = useViewMode()
  const [iconSize, setIconSize] = useIconSize()

  void token // current zip view doesn't fetch per-entry; reserved for v2 inline previews

  useEffect(() => {
    let cancelled = false

    listZipEntries(path, token)
      .then((res) => {
        if (cancelled) return
        setEntries(res.entries)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this zip.')
      })

    return () => {
      cancelled = true
    }
  }, [path, token])

  const tree = useMemo(() => (entries ? buildTree(entries) : null), [entries])

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-300">
        {error}
      </div>
    )
  }

  if (!tree) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-400">
        Loading…
      </div>
    )
  }

  const node = tree.get(currentDir) ?? { folders: new Set<string>(), files: [] }
  const sortedFolders = Array.from(node.folders).sort((a, b) =>
    a.localeCompare(b),
  )
  const sortedFiles = [...node.files].sort((a, b) =>
    basenameOf(a.name).localeCompare(basenameOf(b.name)),
  )
  const breadcrumbSegments = currentDir ? currentDir.split('/').filter(Boolean) : []
  const isEmpty = sortedFolders.length === 0 && sortedFiles.length === 0
  const goUp = () => {
    const idx = currentDir.lastIndexOf('/')
    setCurrentDir(idx <= 0 ? '' : currentDir.slice(0, idx))
  }

  return (
    <div className="flex flex-1 flex-col">
      <Breadcrumb
        archiveName={basenameOf(path)}
        segments={breadcrumbSegments}
        onNavigate={setCurrentDir}
        toolbar={
          <ViewToolbar
            mode={viewMode}
            onModeChange={setViewMode}
            size={iconSize}
            onSizeChange={setIconSize}
            theme="dark"
          />
        }
      />

      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-400">
          {currentDir ? 'This folder is empty.' : 'This archive is empty.'}
        </div>
      ) : viewMode === 'list' ? (
        <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-4 text-sm text-neutral-200">
          {currentDir ? (
            <li>
              <button
                type="button"
                onClick={goUp}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                <IconFolderSmall className="size-4 shrink-0 text-sky-400" />
                <span className="flex-1 truncate">..</span>
                <span className="hidden text-xs text-neutral-500 sm:inline">
                  Parent folder
                </span>
              </button>
            </li>
          ) : null}
          {sortedFolders.map((folderName) => {
            const targetPath = currentDir
              ? `${currentDir}/${folderName}`
              : folderName
            return (
              <li key={`d:${targetPath}`}>
                <button
                  type="button"
                  onClick={() => setCurrentDir(targetPath)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <IconFolderSmall className="size-4 shrink-0 text-sky-400" />
                  <span className="truncate">{folderName}</span>
                </button>
              </li>
            )
          })}
          {sortedFiles.map((file) => {
            const fileName = basenameOf(file.name)
            const { Icon, color } = KIND_TO_VISUAL[pickViewer(fileName)]
            return (
              <li
                key={`f:${file.name}`}
                className="flex items-center gap-2 rounded px-2 py-1"
              >
                <Icon className={`size-4 shrink-0 ${color}`} />
                <span className="flex-1 truncate">{fileName}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <ul className={`grid flex-1 gap-3 overflow-y-auto p-4 ${GRID_COLS_BY_SIZE[iconSize]}`}>
          {currentDir ? <ParentTile size={iconSize} onOpen={goUp} /> : null}
          {sortedFolders.map((folderName) => {
            const targetPath = currentDir
              ? `${currentDir}/${folderName}`
              : folderName
            return (
              <FolderTile
                key={`d:${targetPath}`}
                name={folderName}
                size={iconSize}
                onOpen={() => setCurrentDir(targetPath)}
              />
            )
          })}
          {sortedFiles.map((file) => (
            <FileTile key={`f:${file.name}`} file={file} size={iconSize} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Breadcrumb({
  archiveName,
  segments,
  onNavigate,
  toolbar,
}: {
  archiveName: string
  segments: string[]
  onNavigate: (target: string) => void
  toolbar?: React.ReactNode
}) {
  return (
    <nav
      aria-label="Archive path"
      className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-neutral-950 px-4 py-2 text-xs text-neutral-300"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button
          type="button"
          onClick={() => onNavigate('')}
          className="rounded px-2 py-1 font-medium hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          {archiveName}
        </button>
        {segments.map((seg, i) => {
          const target = segments.slice(0, i + 1).join('/')
          const isLast = i === segments.length - 1
          return (
            <span key={target} className="flex items-center gap-1">
              <IconChevronRight className="size-3 text-neutral-500" />
              {isLast ? (
                <span className="px-2 py-1 font-medium text-neutral-100" aria-current="page">
                  {seg}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(target)}
                  className="rounded px-2 py-1 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  {seg}
                </button>
              )}
            </span>
          )
        })}
      </div>
      {toolbar ? <div className="shrink-0">{toolbar}</div> : null}
    </nav>
  )
}

function ParentTile({ size, onOpen }: { size: IconSize; onOpen: () => void }) {
  const iconClass = TILE_ICON_CLASS[size]
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full flex-col items-stretch gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 text-left hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-white/5">
          <IconFolderSmall className={`${iconClass} text-sky-400`} />
        </div>
        <div className="px-1 pb-1">
          <p className="truncate text-center text-sm font-medium text-neutral-100">..</p>
          <p className="truncate text-center text-xs text-neutral-400">Parent folder</p>
        </div>
      </button>
    </li>
  )
}

function FolderTile({
  name,
  size,
  onOpen,
}: {
  name: string
  size: IconSize
  onOpen: () => void
}) {
  const iconClass = TILE_ICON_CLASS[size]
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={name}
        className="group flex w-full flex-col items-stretch gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 text-left hover:border-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-white/5">
          <IconFolderSmall className={`${iconClass} text-sky-400`} />
        </div>
        <p className="truncate px-1 pb-1 text-center text-sm font-medium text-neutral-100">
          {name}
        </p>
      </button>
    </li>
  )
}

function FileTile({ file, size }: { file: ZipEntryDto; size: IconSize }) {
  const fileName = basenameOf(file.name)
  const { Icon, color } = KIND_TO_VISUAL[pickViewer(fileName)]
  const iconClass = TILE_ICON_CLASS[size]
  return (
    <li>
      <div
        title={file.name}
        className="flex w-full flex-col items-stretch gap-2 rounded-2xl border border-white/10 bg-white/5 p-2 text-left"
      >
        <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-white/5">
          <Icon className={`${iconClass} ${color}`} />
        </div>
        <p className="truncate px-1 pb-1 text-center text-sm font-medium text-neutral-100">
          {fileName}
        </p>
      </div>
    </li>
  )
}
