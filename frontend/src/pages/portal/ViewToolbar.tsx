import { IconGrid, IconList } from './icons'
import type { IconSize, ViewMode } from './viewSettings'
import { cn, focusRing } from './utils'

type Props = {
  mode: ViewMode
  onModeChange: (next: ViewMode) => void
  size: IconSize
  onSizeChange: (next: IconSize) => void
  /** Theme: light = portal grid background; dark = inside zip viewer modal. */
  theme?: 'light' | 'dark'
}

export function ViewToolbar({
  mode,
  onModeChange,
  size,
  onSizeChange,
  theme = 'light',
}: Props) {
  const dark = theme === 'dark'
  const groupBg = dark ? 'bg-white/5' : 'bg-[var(--portal-chip-hover)]'
  const segIdle = dark ? 'text-neutral-300 hover:text-white' : 'text-[var(--portal-muted)] hover:text-[var(--portal-heading)]'
  const segActive = dark ? 'bg-white text-neutral-900' : 'bg-[var(--portal-surface)] text-[var(--portal-heading)] shadow-sm'

  const segBtn = (active: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
      active ? segActive : segIdle,
      focusRing,
    )

  return (
    <div className="inline-flex items-center gap-2">
      <div className={cn('inline-flex rounded-full p-0.5', groupBg)} role="group" aria-label="View mode">
        <button
          type="button"
          onClick={() => onModeChange('list')}
          aria-pressed={mode === 'list'}
          aria-label="List view"
          className={segBtn(mode === 'list')}
        >
          <IconList className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onModeChange('grid')}
          aria-pressed={mode === 'grid'}
          aria-label="Grid view"
          className={segBtn(mode === 'grid')}
        >
          <IconGrid className="size-3.5" />
        </button>
      </div>

      {mode === 'grid' ? (
        <div className={cn('inline-flex rounded-full p-0.5', groupBg)} role="group" aria-label="Icon size">
          {(['small', 'medium', 'large'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSizeChange(s)}
              aria-pressed={size === s}
              aria-label={`${s[0].toUpperCase() + s.slice(1)} icons`}
              className={segBtn(size === s)}
            >
              {s === 'small' ? 'S' : s === 'medium' ? 'M' : 'L'}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
