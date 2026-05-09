import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { IconMenu } from './icons'
import { cn, focusRing } from './utils'

type Props = {
  mobileNavOpen: boolean
  onToggleMobileNav: () => void
}

export function PortalHeader({ mobileNavOpen, onToggleMobileNav }: Props) {
  const { username, logout } = useAuth()
  const navigate = useNavigate()

  const initial = useMemo(() => {
    const u = username?.trim()
    if (!u) return '?'
    return u.slice(0, 1).toUpperCase()
  }, [username])

  const handleLogout = () => {
    void logout().then(() => navigate('/', { replace: true }))
  }

  return (
    <header
      className="sticky top-0 z-50 flex shrink-0 items-center gap-3 border-b border-[var(--portal-border)] bg-[var(--portal-surface)] px-3 py-2.5 sm:gap-4 sm:px-4"
      role="banner"
    >
      <div className="flex flex-1 items-center">
        <button
          type="button"
          className={cn(
            'rounded-full p-2 text-[var(--portal-muted)] md:hidden',
            'hover:bg-[var(--portal-chip-hover)]',
            focusRing,
          )}
          aria-expanded={mobileNavOpen}
          aria-controls="portal-sidebar"
          onClick={onToggleMobileNav}
          aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
        >
          <IconMenu className="size-6" />
        </button>
      </div>

      <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
        <div
          className="mx-1 hidden h-8 w-px bg-[var(--portal-border)] sm:block"
          aria-hidden
        />

        <button
          type="button"
          onClick={handleLogout}
          className={cn(
            'hidden rounded-full border border-[var(--portal-border)] px-3 py-1.5 text-sm font-medium text-[var(--portal-heading)] sm:inline-flex',
            'hover:bg-[var(--portal-chip-hover)]',
            focusRing,
          )}
        >
          Log out
        </button>

        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--portal-active)] text-sm font-semibold text-[var(--portal-active-text)]"
          title={username ?? 'Account'}
          aria-label={username ? `Signed in as ${username}` : 'Account'}
        >
          {initial}
        </span>
      </div>
    </header>
  )
}
