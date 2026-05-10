import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Explorer } from './Explorer'
import { MainContent } from './MainContent'
import { PortalHeader } from './PortalHeader'
import { Sidebar } from './Sidebar'
import { urlToPath } from './path'
import { cn, focusRing } from './utils'
import { ViewerPage } from './viewer/ViewerPage'

export function Portal() {
  const params = useParams<{ '*': string }>()
  const currentPath = urlToPath(params['*'])

  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  /** Collapsed (icon-only) is default on desktop; mobile drawer always uses expanded labels when open. */
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  // Generation counter — bump to invalidate listings/quota in children
  // after a mutation (upload, delete, mkdir).
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = useCallback(() => setRefreshKey((k) => k + 1), [])

  return (
    <div
      className={cn(
        'portal-shell flex min-h-screen flex-col bg-[var(--portal-canvas)] font-sans text-[var(--portal-heading)]',
      )}
    >
      <a
        href="#portal-main"
        className={cn(
          'sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60]',
          'focus:rounded-full focus:bg-[var(--portal-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md',
          focusRing,
        )}
      >
        Skip to main content
      </a>

      <PortalHeader
        mobileNavOpen={mobileNavOpen}
        onToggleMobileNav={() => setMobileNavOpen((o) => !o)}
      />

      <div className="relative flex min-h-0 flex-1 gap-2 p-2 sm:p-3">
        {mobileNavOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            aria-label="Close navigation menu"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}

        <Sidebar
          mobileNavOpen={mobileNavOpen}
          sidebarExpanded={sidebarExpanded}
          onToggleSidebar={() => setSidebarExpanded((v) => !v)}
          onCloseMobileNav={() => setMobileNavOpen(false)}
          currentPath={currentPath}
          refreshKey={refreshKey}
          onMutate={bump}
        />

        <MainContent
          currentPath={currentPath}
          refreshKey={refreshKey}
          onMutate={bump}
        />

        <Explorer
          currentPath={currentPath}
          refreshKey={refreshKey}
        />
      </div>

      <ViewerPage />
    </div>
  )
}
