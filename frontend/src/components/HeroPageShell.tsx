import type { ReactNode } from 'react'

export const HERO_BACKGROUND_IMAGE = '/background.png'

type Variant = 'panel' | 'spotlight'

export function HeroBackdrop({
  variant = 'panel',
}: { variant?: Variant } = {}) {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${HERO_BACKGROUND_IMAGE})` }}
        aria-hidden
      />
      {variant === 'panel' ? (
        <div
          className="pointer-events-none absolute inset-0 bg-linear-to-b from-background/92 via-background/78 to-background/88"
          aria-hidden
        />
      ) : null}
    </>
  )
}

const panelClasses: Record<Variant, string> = {
  panel:
    'rounded-2xl bg-background px-8 py-10 shadow-xl shadow-accent-border/10 ring-1 ring-accent-border/15 sm:px-12 sm:py-12',
  spotlight: 'relative isolate px-8 py-10 sm:px-12 sm:py-12',
}

type HeroPageShellProps = {
  children: ReactNode
  /** Marketing hero uses wider panel; auth forms stay narrow. */
  maxWidth?: 'md' | '2xl'
  contentAlign?: 'center' | 'left'
  /**
   * `panel` renders the standard frosted card; `spotlight` renders the
   * children directly on the background with a localized radial white
   * fade behind them so text stays readable without a hard card edge.
   */
  variant?: Variant
}

export function HeroPageShell({
  children,
  maxWidth = 'md',
  contentAlign = 'left',
  variant = 'panel',
}: HeroPageShellProps) {
  const maxWidthClass = maxWidth === '2xl' ? 'max-w-2xl' : 'max-w-md'
  const alignClass = contentAlign === 'center' ? 'text-center' : 'text-left'

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden">
      <HeroBackdrop variant={variant} />
      <section className="relative flex flex-1 flex-col justify-center px-8 py-20 sm:py-28">
        <div className={`mx-auto w-full ${maxWidthClass}`}>
          <div className={`${panelClasses[variant]} ${alignClass}`}>
            {variant === 'spotlight' ? (
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-36 bg-[radial-gradient(ellipse_at_center,var(--color-background)_30%,transparent_75%)] sm:-inset-56"
              />
            ) : null}
            <div className={variant === 'spotlight' ? 'relative' : ''}>
              {children}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
