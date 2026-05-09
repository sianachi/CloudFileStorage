export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--portal-active-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--portal-canvas)]'

export function cn(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ')
}
