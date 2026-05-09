import { useEffect, useRef, useState } from 'react'
import { ApiRequestError } from '../../api/client'
import { createFolder, getQuota, uploadFile } from '../../api/files'
import { useAuth } from '../../auth/AuthContext'
import { formatBytes } from '../../lib/format'
import type { Quota } from '../../types/files'
import {
  IconChevronLeft,
  IconChevronRight,
  IconFolderOpen,
  IconPlusColored,
  IconStorageUsage,
  IconTrash,
} from './icons'
import { joinPath } from './path'
import { cn, focusRing } from './utils'

const NAV_ITEMS = [
  { id: 'files' as const, label: 'My Files', icon: IconFolderOpen },
  { id: 'trash' as const, label: 'Trash', icon: IconTrash },
] as const

type NavId = (typeof NAV_ITEMS)[number]['id']

type Props = {
  mobileNavOpen: boolean
  sidebarExpanded: boolean
  onToggleSidebar: () => void
  onCloseMobileNav: () => void
  currentPath: string
  refreshKey: number
  onMutate: () => void
}

export function Sidebar({
  mobileNavOpen,
  sidebarExpanded,
  onToggleSidebar,
  onCloseMobileNav,
  currentPath,
  refreshKey,
  onMutate,
}: Props) {
  const showsLabels = sidebarExpanded || mobileNavOpen

  return (
    <aside
      id="portal-sidebar"
      className={cn(
        'fixed bottom-0 left-0 top-14 z-50 flex flex-col overflow-hidden bg-[var(--portal-canvas)] transition-[transform,width] duration-200 ease-out md:static md:bottom-auto md:top-auto md:z-auto md:h-auto md:shrink-0 md:translate-x-0',
        mobileNavOpen
          ? 'w-[260px] translate-x-0 shadow-xl'
          : cn(
              '-translate-x-full md:translate-x-0',
              sidebarExpanded ? 'md:w-[260px]' : 'md:w-[72px]',
              'w-[260px]',
            ),
      )}
      aria-label="Main navigation"
    >
      <SidebarContent
        expanded={showsLabels}
        onToggleExpanded={onToggleSidebar}
        onNavigate={onCloseMobileNav}
        currentPath={currentPath}
        refreshKey={refreshKey}
        onMutate={onMutate}
      />
    </aside>
  )
}

function SidebarContent({
  expanded,
  onToggleExpanded,
  onNavigate,
  currentPath,
  refreshKey,
  onMutate,
}: {
  expanded: boolean
  onToggleExpanded: () => void
  onNavigate: () => void
  currentPath: string
  refreshKey: number
  onMutate: () => void
}) {
  const [activeNav, setActiveNav] = useState<NavId>('files')

  return (
    <>
      <div
        className={cn(
          'hidden items-center border-b border-transparent pb-2 pt-2 md:flex',
          expanded ? 'justify-end px-2' : 'justify-center px-1',
        )}
      >
        <button
          type="button"
          className={cn(
            'rounded-full p-2 text-[var(--portal-muted)] hover:bg-[var(--portal-chip-hover)]',
            focusRing,
          )}
          aria-expanded={expanded}
          aria-controls="portal-sidebar"
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={onToggleExpanded}
        >
          {expanded ? (
            <IconChevronLeft className="size-5" aria-hidden />
          ) : (
            <IconChevronRight className="size-5" aria-hidden />
          )}
        </button>
      </div>

      <NewMenu expanded={expanded} currentPath={currentPath} onMutate={onMutate} />

      <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Drive navigation">
        {NAV_ITEMS.map((item) => {
          const active = item.id === activeNav
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveNav(item.id)
                onNavigate()
              }}
              className={cn(
                'flex w-full items-center rounded-full py-2 text-sm font-medium',
                expanded ? 'gap-3 px-3 text-left' : 'justify-center px-2',
                active
                  ? 'bg-[var(--portal-active)] text-[var(--portal-active-text)]'
                  : 'text-[var(--portal-heading)] hover:bg-[var(--portal-chip-hover)]',
                focusRing,
              )}
              aria-current={active ? 'page' : undefined}
              aria-label={expanded ? undefined : item.label}
              title={expanded ? undefined : item.label}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {expanded ? <span className="truncate">{item.label}</span> : null}
            </button>
          )
        })}
      </nav>

      <QuotaPanel expanded={expanded} refreshKey={refreshKey} />
    </>
  )
}

function NewMenu({
  expanded,
  currentPath,
  onMutate,
}: {
  expanded: boolean
  currentPath: string
  onMutate: () => void
}) {
  const { token } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const onPickFile = () => {
    setOpen(false)
    fileInputRef.current?.click()
  }

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !token) return
    setBusy(true)
    try {
      await uploadFile(currentPath, file, token)
      onMutate()
    } catch (err) {
      if (err instanceof ApiRequestError) {
        window.alert(`Upload failed: ${err.message}`)
      } else {
        window.alert('Upload failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  const onCreateFolder = async () => {
    setOpen(false)
    if (!token) return
    const name = window.prompt('New folder name')?.trim()
    if (!name) return
    if (name.includes('/')) {
      window.alert('Folder names cannot contain slashes.')
      return
    }
    setBusy(true)
    try {
      await createFolder(joinPath(currentPath, name), token)
      onMutate()
    } catch (err) {
      if (err instanceof ApiRequestError) {
        window.alert(`Could not create folder: ${err.message}`)
      } else {
        window.alert('Could not create folder.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className={cn(
        'relative flex flex-col gap-2 pb-4 pt-2 md:pt-0',
        expanded ? 'px-3 md:px-2' : 'px-2 md:px-1.5',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={cn(
          'flex items-center rounded-2xl bg-[var(--portal-surface)] text-sm font-medium shadow-[var(--portal-shadow-md)]',
          'hover:brightness-[0.98] disabled:opacity-60',
          expanded ? 'gap-3 px-4 py-3' : 'justify-center p-2',
          focusRing,
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Create new"
      >
        <IconPlusColored className={cn('shrink-0', expanded ? 'size-7' : 'size-6')} />
        {expanded ? <span>{busy ? 'Working…' : 'New'}</span> : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-3 right-3 top-full z-30 mt-1 rounded-xl border border-[var(--portal-border)] bg-[var(--portal-surface)] py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={onPickFile}
            className={cn(
              'block w-full px-4 py-2 text-left text-sm hover:bg-[var(--portal-chip-hover)]',
              focusRing,
            )}
          >
            Upload file
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void onCreateFolder()}
            className={cn(
              'block w-full px-4 py-2 text-left text-sm hover:bg-[var(--portal-chip-hover)]',
              focusRing,
            )}
          >
            New folder
          </button>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => void onFileSelected(e)}
      />
    </div>
  )
}

function QuotaPanel({
  expanded,
  refreshKey,
}: {
  expanded: boolean
  refreshKey: number
}) {
  const { token } = useAuth()
  const [quota, setQuota] = useState<Quota | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    getQuota(token)
      .then((q) => {
        if (!cancelled) setQuota(q)
      })
      .catch(() => {
        /* ignore — sidebar will show "—" until next refresh */
      })
    return () => {
      cancelled = true
    }
  }, [token, refreshKey])

  const display = quota ? `${formatBytes(quota.bytes_used)} used` : '— used'

  return (
    <div
      className={cn(
        'mt-auto border-t border-[var(--portal-border)] py-4',
        expanded ? 'px-4' : 'flex justify-center px-2',
      )}
    >
      {expanded ? (
        <p className="text-xs text-[var(--portal-muted)]">{display}</p>
      ) : (
        <span
          className="inline-flex rounded-full p-2 text-[var(--portal-muted)]"
          title={display}
          aria-label={`Storage: ${display}`}
        >
          <IconStorageUsage className="size-5" aria-hidden />
        </span>
      )}
    </div>
  )
}
