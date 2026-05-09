import type { ReactNode } from 'react'

export const HERO_BACKGROUND_IMAGE = '/background.png'

export function HeroBackdrop() {
  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${HERO_BACKGROUND_IMAGE})` }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-background/92 via-background/78 to-background/88"
        aria-hidden
      />
    </>
  )
}

const panelClassName =
  'rounded-2xl bg-background/25 px-8 py-10 shadow-xl shadow-accent-border/10 ring-1 ring-accent-border/15 backdrop-blur-md sm:px-12 sm:py-12'

type HeroPageShellProps = {
  children: ReactNode
  /** Marketing hero uses wider panel; auth forms stay narrow. */
  maxWidth?: 'md' | '2xl'
  contentAlign?: 'center' | 'left'
}

export function HeroPageShell({
  children,
  maxWidth = 'md',
  contentAlign = 'left',
}: HeroPageShellProps) {
  const maxWidthClass = maxWidth === '2xl' ? 'max-w-2xl' : 'max-w-md'
  const alignClass = contentAlign === 'center' ? 'text-center' : 'text-left'

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden">
      <HeroBackdrop />
      <section className="relative flex flex-1 flex-col justify-center px-8 py-20 sm:py-28">
        <div className={`mx-auto w-full ${maxWidthClass}`}>
          <div className={`${panelClassName} ${alignClass}`}>{children}</div>
        </div>
      </section>
    </div>
  )
}
