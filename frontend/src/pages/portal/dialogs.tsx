import { useCallback, useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'
import { ApiRequestError } from '../../api/client'
import {
  downloadSharedFile,
  downloadVersion,
  emptyTrash,
  listRecent,
  listFavorites,
  listTrash,
  listVersions,
  purgeFromTrash,
  restoreFromTrash,
  restoreVersion,
} from '../../api/files'
import {
  createShare,
  listMyShares,
  publicShareUrl,
  revokeShare,
  sharedWithMe,
} from '../../api/shares'
import type {
  FileEntry,
  ShareInfo,
  SharedWithMeEntry,
  TrashEntry,
  VersionEntry,
} from '../../types/files'
import { formatBytes } from '../../lib/format'
import { cn, focusRing } from './utils'

const PANEL =
  'relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-[var(--portal-surface)] text-[var(--portal-heading)] shadow-2xl ring-1 ring-black/10 outline-none'

const btn =
  'inline-flex items-center gap-1.5 rounded-full border border-[var(--portal-border)] px-3 py-1.5 text-sm font-medium hover:bg-[var(--portal-chip-hover)]'
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-full bg-[var(--portal-active)] px-3 py-1.5 text-sm font-medium text-[var(--portal-active-text)] hover:brightness-95'

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--portal-border)] px-5 py-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <button type="button" onClick={onClose} className={cn('rounded-full p-1.5 hover:bg-[var(--portal-chip-hover)]', focusRing)} aria-label="Close">
        ✕
      </button>
    </div>
  )
}

function useDate() {
  return useCallback((iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
  }, [])
}

// --- Share dialog --------------------------------------------------------

export function ShareDialog({
  open,
  onClose,
  entry,
  token,
}: {
  open: boolean
  onClose: () => void
  entry: FileEntry | null
  token: string
}) {
  const [kind, setKind] = useState<'user' | 'public'>('user')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<'read' | 'write'>('read')
  const [shares, setShares] = useState<ShareInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!entry) return
    const all = await listMyShares(token)
    setShares(all.filter((s) => s.entry_path === entry.path))
  }, [entry, token])

  useEffect(() => {
    if (open && entry) void refresh()
  }, [open, entry, refresh])

  if (!entry) return null

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      await createShare(
        {
          path: entry.path,
          public: kind === 'public',
          targetUsername: kind === 'user' ? username.trim() : undefined,
          role,
        },
        token,
      )
      setUsername('')
      await refresh()
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not create share')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} panelClassName={PANEL}>
      <Header title={`Share “${entry.name}”`} onClose={onClose} />
      <div className="flex-1 overflow-auto px-5 py-4">
        <div className="flex gap-2">
          <button type="button" onClick={() => setKind('user')} className={kind === 'user' ? btnPrimary : btn}>
            With a user
          </button>
          <button type="button" onClick={() => setKind('public')} className={kind === 'public' ? btnPrimary : btn}>
            Public link
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {kind === 'user' ? (
            <label className="block text-sm">
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--portal-border)] bg-[var(--portal-surface)] px-3 py-2"
                placeholder="who to share with"
              />
            </label>
          ) : (
            <p className="text-sm text-[var(--portal-muted)]">
              Anyone with the link can download this {entry.is_directory ? 'folder' : 'file'} (read-only).
            </p>
          )}
          <label className="block text-sm">
            Access
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'read' | 'write')}
              disabled={kind === 'public'}
              className="mt-1 w-full rounded-lg border border-[var(--portal-border)] bg-[var(--portal-surface)] px-3 py-2 disabled:opacity-50"
            >
              <option value="read">Read only</option>
              <option value="write">Can edit</option>
            </select>
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="button" onClick={() => void submit()} disabled={busy} className={cn(btnPrimary, 'disabled:opacity-50')}>
            Create share
          </button>
        </div>

        <ExistingShares shares={shares} token={token} onChange={refresh} />
      </div>
    </Modal>
  )
}

function ExistingShares({
  shares,
  token,
  onChange,
}: {
  shares: ShareInfo[]
  token: string
  onChange: () => Promise<void>
}) {
  const fmt = useDate()
  if (shares.length === 0) return null
  const copy = (s: ShareInfo) => {
    if (s.public_token) void navigator.clipboard?.writeText(publicShareUrl(s.public_token))
  }
  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">Existing shares</h3>
      <ul className="mt-2 space-y-2">
        {shares.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--portal-chip-hover)] px-3 py-2 text-sm">
            <span className="min-w-0 truncate">
              {s.kind === 'link' ? '🔗 Public link' : `👤 ${s.target_username}`} · {s.role}
              {s.expires_at ? ` · expires ${fmt(s.expires_at)}` : ''}
            </span>
            <span className="flex shrink-0 gap-1">
              {s.kind === 'link' ? (
                <button type="button" onClick={() => copy(s)} className={btn}>
                  Copy link
                </button>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  await revokeShare(s.id, token)
                  await onChange()
                }}
                className={cn(btn, 'hover:text-red-600')}
              >
                Revoke
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- Versions dialog -----------------------------------------------------

export function VersionsDialog({
  open,
  onClose,
  entry,
  token,
  onRestored,
}: {
  open: boolean
  onClose: () => void
  entry: FileEntry | null
  token: string
  onRestored: () => void
}) {
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [loading, setLoading] = useState(false)
  const fmt = useDate()

  const refresh = useCallback(async () => {
    if (!entry) return
    setLoading(true)
    try {
      const res = await listVersions(entry.path, token)
      setVersions(res.versions)
    } finally {
      setLoading(false)
    }
  }, [entry, token])

  useEffect(() => {
    if (open && entry) void refresh()
  }, [open, entry, refresh])

  if (!entry) return null

  return (
    <Modal open={open} onClose={onClose} panelClassName={PANEL}>
      <Header title={`Version history — ${entry.name}`} onClose={onClose} />
      <div className="flex-1 overflow-auto px-5 py-4">
        {loading ? <p className="text-sm text-[var(--portal-muted)]">Loading…</p> : null}
        {!loading && versions.length === 0 ? (
          <p className="text-sm text-[var(--portal-muted)]">No prior versions yet. Versions are saved each time the file is overwritten.</p>
        ) : null}
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.version_no} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--portal-chip-hover)] px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                v{v.version_no} · {formatBytes(v.size)} · {fmt(v.created_at)}
              </span>
              <span className="flex shrink-0 gap-1">
                <button type="button" className={btn} onClick={() => void downloadVersion(entry.path, v.version_no, token)}>
                  Download
                </button>
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={async () => {
                    await restoreVersion(entry.path, v.version_no, token)
                    onRestored()
                    await refresh()
                  }}
                >
                  Restore
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}

// --- Trash dialog --------------------------------------------------------

export function TrashDialog({
  open,
  onClose,
  token,
  onChange,
}: {
  open: boolean
  onClose: () => void
  token: string
  onChange: () => void
}) {
  const [entries, setEntries] = useState<TrashEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fmt = useDate()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setEntries((await listTrash(token)).entries)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const restore = async (e: TrashEntry) => {
    setError(null)
    try {
      await restoreFromTrash(e.trash_path, token)
      await refresh()
      onChange()
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not restore')
    }
  }

  return (
    <Modal open={open} onClose={onClose} panelClassName={PANEL}>
      <Header title="Trash" onClose={onClose} />
      <div className="flex-1 overflow-auto px-5 py-4">
        {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
        {loading ? <p className="text-sm text-[var(--portal-muted)]">Loading…</p> : null}
        {!loading && entries.length === 0 ? (
          <p className="text-sm text-[var(--portal-muted)]">Trash is empty.</p>
        ) : null}
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.trash_path} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--portal-chip-hover)] px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {e.is_directory ? '📁' : '📄'} {e.name}
                <span className="block truncate text-xs text-[var(--portal-muted)]">from {e.original_path} · {fmt(e.deleted_at)}</span>
              </span>
              <span className="flex shrink-0 gap-1">
                <button type="button" className={btnPrimary} onClick={() => void restore(e)}>
                  Restore
                </button>
                <button
                  type="button"
                  className={cn(btn, 'hover:text-red-600')}
                  onClick={async () => {
                    if (!window.confirm(`Permanently delete “${e.name}”?`)) return
                    await purgeFromTrash(e.trash_path, token)
                    await refresh()
                  }}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {entries.length > 0 ? (
        <div className="border-t border-[var(--portal-border)] px-5 py-3 text-right">
          <button
            type="button"
            className={cn(btn, 'hover:text-red-600')}
            onClick={async () => {
              if (!window.confirm('Permanently delete everything in trash?')) return
              await emptyTrash(token)
              await refresh()
            }}
          >
            Empty trash
          </button>
        </div>
      ) : null}
    </Modal>
  )
}

// --- Favorites / Recent list dialog --------------------------------------

export function SpecialListDialog({
  open,
  onClose,
  mode,
  token,
  onOpenEntry,
}: {
  open: boolean
  onClose: () => void
  mode: 'favorites' | 'recent' | null
  token: string
  onOpenEntry: (entry: FileEntry) => void
}) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !mode) return
    setLoading(true)
    const loader = mode === 'favorites' ? listFavorites(token) : listRecent(token)
    loader
      .then((res) => setEntries(res.entries))
      .finally(() => setLoading(false))
  }, [open, mode, token])

  const title = mode === 'favorites' ? 'Favorites' : 'Recent files'

  return (
    <Modal open={open} onClose={onClose} panelClassName={PANEL}>
      <Header title={title} onClose={onClose} />
      <div className="flex-1 overflow-auto px-5 py-4">
        {loading ? <p className="text-sm text-[var(--portal-muted)]">Loading…</p> : null}
        {!loading && entries.length === 0 ? (
          <p className="text-sm text-[var(--portal-muted)]">Nothing here yet.</p>
        ) : null}
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.path}>
              <button
                type="button"
                onClick={() => {
                  onOpenEntry(e)
                  onClose()
                }}
                className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--portal-chip-hover)]', focusRing)}
              >
                <span>{e.is_directory ? '📁' : '📄'}</span>
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                <span className="shrink-0 text-xs text-[var(--portal-muted)]">{e.is_directory ? '' : formatBytes(e.size)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}

// --- Shared with me dialog ----------------------------------------------

export function SharedWithMeDialog({
  open,
  onClose,
  token,
}: {
  open: boolean
  onClose: () => void
  token: string
}) {
  const [entries, setEntries] = useState<SharedWithMeEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    sharedWithMe(token)
      .then(setEntries)
      .finally(() => setLoading(false))
  }, [open, token])

  return (
    <Modal open={open} onClose={onClose} panelClassName={PANEL}>
      <Header title="Shared with me" onClose={onClose} />
      <div className="flex-1 overflow-auto px-5 py-4">
        {loading ? <p className="text-sm text-[var(--portal-muted)]">Loading…</p> : null}
        {!loading && entries.length === 0 ? (
          <p className="text-sm text-[var(--portal-muted)]">Nothing has been shared with you.</p>
        ) : null}
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.share_id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--portal-chip-hover)] px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {e.is_directory ? '📁' : '📄'} {e.name}
                <span className="block truncate text-xs text-[var(--portal-muted)]">from {e.owner_username} · {e.role}</span>
              </span>
              {!e.is_directory ? (
                <button
                  type="button"
                  className={btn}
                  onClick={() => void downloadSharedFile(e.share_id, '/', e.name, token)}
                >
                  Download
                </button>
              ) : (
                <span className="shrink-0 text-xs text-[var(--portal-muted)]">folder</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  )
}
