import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listFiles } from '../../api/files'
import { useAuth } from '../../auth/AuthContext'
import type { FileEntry } from '../../types/files'
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconFile,
  IconFolderSmall,
} from './icons'
import { pathSegments, pathToUrl } from './path'
import { cn, focusRing } from './utils'

const ROOT_PATH = '/'

function ancestorsOf(path: string): string[] {
  if (path === '/') return [ROOT_PATH]
  return [ROOT_PATH, ...pathSegments(path).map((s) => s.path)]
}

export function Explorer({
  currentPath,
  refreshKey,
}: {
  currentPath: string
  refreshKey: number
}) {
  const { token } = useAuth()
  const navigate = useNavigate()

  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(ancestorsOf(currentPath)),
  )
  const [childrenByPath, setChildrenByPath] = useState<Map<string, FileEntry[]>>(
    () => new Map(),
  )
  const [loading, setLoading] = useState<Set<string>>(() => new Set())

  // Make sure every ancestor of the current path is expanded so the
  // active row is visible without the user having to click through.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const a of ancestorsOf(currentPath)) next.add(a)
      return next
    })
  }, [currentPath])

  const fetchChildren = useCallback(
    async (path: string) => {
      if (!token) return
      setLoading((prev) => new Set(prev).add(path))
      try {
        const res = await listFiles(path, token)
        setChildrenByPath((prev) => {
          const next = new Map(prev)
          next.set(path, res.entries)
          return next
        })
      } catch {
        /* swallow — explorer will just show "no items" until next refresh */
      } finally {
        setLoading((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
      }
    },
    [token],
  )

  // Reset cached listings on every mutation, then refetch whatever's expanded.
  useEffect(() => {
    if (!token) return
    setChildrenByPath(new Map())
    for (const p of expanded) {
      void fetchChildren(p)
    }
    // We deliberately don't include `expanded` here — that would refetch
    // every time the user toggles a row open, which we already handle below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, token])

  // Whenever a folder becomes expanded and we don't have its children yet,
  // load them.
  useEffect(() => {
    if (!token) return
    for (const p of expanded) {
      if (!childrenByPath.has(p) && !loading.has(p)) {
        void fetchChildren(p)
      }
    }
  }, [expanded, childrenByPath, fetchChildren, loading, token])

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const onSelect = useCallback(
    (entry: FileEntry) => {
      if (entry.is_directory) {
        navigate(pathToUrl(entry.path))
      }
    },
    [navigate],
  )

  return (
    <aside
      id="portal-explorer"
      className={cn(
        'hidden shrink-0 flex-col overflow-hidden rounded-2xl bg-[var(--portal-surface)] shadow-[var(--portal-shadow-md)] transition-[width] duration-200 ease-out lg:flex',
        open ? 'w-[280px]' : 'w-[44px]',
      )}
      aria-label="File explorer"
    >
      <div
        className={cn(
          'flex shrink-0 items-center border-b border-[var(--portal-border)] px-2 py-2',
          open ? 'justify-between' : 'justify-center',
        )}
      >
        {open ? (
          <span className="px-2 text-xs font-semibold uppercase tracking-wider text-[var(--portal-muted)]">
            Explorer
          </span>
        ) : null}
        <button
          type="button"
          className={cn(
            'rounded-full p-1.5 text-[var(--portal-muted)] hover:bg-[var(--portal-chip-hover)]',
            focusRing,
          )}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="portal-explorer"
          aria-label={open ? 'Collapse file explorer' : 'Expand file explorer'}
        >
          {open ? (
            <IconChevronRight className="size-4" />
          ) : (
            <IconChevronLeft className="size-4" />
          )}
        </button>
      </div>

      {open ? (
        <ul role="tree" className="flex-1 overflow-y-auto py-1">
          <ExplorerRoot
            expanded={expanded}
            childrenByPath={childrenByPath}
            currentPath={currentPath}
            onToggle={toggle}
            onSelect={onSelect}
          />
        </ul>
      ) : null}
    </aside>
  )
}

function ExplorerRoot({
  expanded,
  childrenByPath,
  currentPath,
  onToggle,
  onSelect,
}: {
  expanded: Set<string>
  childrenByPath: Map<string, FileEntry[]>
  currentPath: string
  onToggle: (path: string) => void
  onSelect: (entry: FileEntry) => void
}) {
  const isRootActive = currentPath === '/'
  const isOpen = expanded.has(ROOT_PATH)
  const rootEntries = childrenByPath.get(ROOT_PATH) ?? []

  return (
    <li role="treeitem" aria-expanded={isOpen}>
      <button
        type="button"
        onClick={() => onToggle(ROOT_PATH)}
        className={cn(
          'flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm',
          isRootActive
            ? 'bg-[var(--portal-active)] text-[var(--portal-active-text)]'
            : 'text-[var(--portal-heading)] hover:bg-[var(--portal-chip-hover)]',
          focusRing,
        )}
        style={{ paddingLeft: '8px' }}
      >
        <IconChevronDown
          className={cn(
            'size-3.5 shrink-0 text-[var(--portal-muted)] transition-transform',
            isOpen ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden
        />
        <IconFolderSmall
          className="size-4 shrink-0 text-[var(--portal-muted)]"
          aria-hidden
        />
        <span className="truncate">My Files</span>
      </button>
      {isOpen ? (
        <ul role="group">
          {rootEntries.map((child) => (
            <ExplorerNode
              key={child.path}
              entry={child}
              depth={1}
              expanded={expanded}
              childrenByPath={childrenByPath}
              currentPath={currentPath}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function ExplorerNode({
  entry,
  depth,
  expanded,
  childrenByPath,
  currentPath,
  onToggle,
  onSelect,
}: {
  entry: FileEntry
  depth: number
  expanded: Set<string>
  childrenByPath: Map<string, FileEntry[]>
  currentPath: string
  onToggle: (path: string) => void
  onSelect: (entry: FileEntry) => void
}) {
  const isFolder = entry.is_directory
  const isOpen = isFolder && expanded.has(entry.path)
  const isActive = isFolder && entry.path === currentPath
  const children = isFolder ? childrenByPath.get(entry.path) ?? [] : []

  return (
    <li role="treeitem" aria-expanded={isFolder ? isOpen : undefined}>
      <button
        type="button"
        onClick={() => {
          if (isFolder) {
            onToggle(entry.path)
            onSelect(entry)
          }
        }}
        className={cn(
          'flex w-full items-center gap-1.5 py-1 pr-2 text-left text-sm',
          isActive
            ? 'bg-[var(--portal-active)] text-[var(--portal-active-text)]'
            : 'text-[var(--portal-heading)] hover:bg-[var(--portal-chip-hover)]',
          focusRing,
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <IconChevronDown
          className={cn(
            'size-3.5 shrink-0 text-[var(--portal-muted)] transition-transform',
            isFolder ? '' : 'invisible',
            isOpen ? 'rotate-0' : '-rotate-90',
          )}
          aria-hidden
        />
        {isFolder ? (
          <IconFolderSmall
            className="size-4 shrink-0 text-[var(--portal-muted)]"
            aria-hidden
          />
        ) : (
          <IconFile className="size-4 shrink-0 text-[var(--portal-muted)]" aria-hidden />
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {isOpen ? (
        <ul role="group">
          {children.map((child) => (
            <ExplorerNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              childrenByPath={childrenByPath}
              currentPath={currentPath}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
