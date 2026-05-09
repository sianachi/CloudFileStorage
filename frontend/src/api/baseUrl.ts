/** API origin; empty string = same origin (Vite dev proxy or served behind same host). */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? ''

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (!API_BASE) {
    return p
  }
  return `${API_BASE.replace(/\/$/, '')}${p}`
}
