import { useCallback, useEffect, useState } from 'react'

export type ViewMode = 'list' | 'grid'
export type IconSize = 'small' | 'medium' | 'large'

const VIEW_MODE_KEY = 'portal_view_mode'
const ICON_SIZE_KEY = 'portal_icon_size'

const DEFAULT_VIEW_MODE: ViewMode = 'list'
const DEFAULT_ICON_SIZE: IconSize = 'medium'

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw && (allowed as readonly string[]).includes(raw)) return raw as T
  } catch {
    /* private mode / quota — fall through */
  }
  return fallback
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

const VIEW_MODES: readonly ViewMode[] = ['list', 'grid']
const ICON_SIZES: readonly IconSize[] = ['small', 'medium', 'large']

export function useViewMode(): [ViewMode, (next: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() =>
    readStored(VIEW_MODE_KEY, VIEW_MODES, DEFAULT_VIEW_MODE),
  )
  const set = useCallback((next: ViewMode) => {
    writeStored(VIEW_MODE_KEY, next)
    setMode(next)
  }, [])
  // Sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === VIEW_MODE_KEY && e.newValue && (VIEW_MODES as readonly string[]).includes(e.newValue)) {
        setMode(e.newValue as ViewMode)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return [mode, set]
}

export function useIconSize(): [IconSize, (next: IconSize) => void] {
  const [size, setSize] = useState<IconSize>(() =>
    readStored(ICON_SIZE_KEY, ICON_SIZES, DEFAULT_ICON_SIZE),
  )
  const set = useCallback((next: IconSize) => {
    writeStored(ICON_SIZE_KEY, next)
    setSize(next)
  }, [])
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ICON_SIZE_KEY && e.newValue && (ICON_SIZES as readonly string[]).includes(e.newValue)) {
        setSize(e.newValue as IconSize)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return [size, set]
}

/** Tailwind class strings for grid columns at each icon size. */
export const GRID_COLS_BY_SIZE: Record<IconSize, string> = {
  small: 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8',
  medium: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6',
  large: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4',
}

/** Tailwind size class for the icon glyph inside a grid tile. */
export const TILE_ICON_CLASS: Record<IconSize, string> = {
  small: 'size-6',
  medium: 'size-10',
  large: 'size-16',
}

/** Whether thumbnails (full-bleed previews) should render at this size. */
export const SHOWS_THUMBNAIL: Record<IconSize, boolean> = {
  small: false,
  medium: true,
  large: true,
}
