/** Convert a /app/* splat into a normalized backend path ("/" or "/foo/bar"). */
export function urlToPath(splat: string | undefined): string {
  if (!splat) return '/'
  const segments = splat
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => decodeURIComponent(s))
  if (segments.length === 0) return '/'
  return '/' + segments.join('/')
}

/** Convert a backend path into a /app/... URL with each segment encoded. */
export function pathToUrl(path: string): string {
  if (path === '/' || !path) return '/app'
  const segments = path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s))
  return '/app/' + segments.join('/')
}

/** Yield each prefix of a path for breadcrumbs: "/" → [], "/a/b" → ["/a", "/a/b"]. */
export function pathSegments(path: string): { name: string; path: string }[] {
  if (!path || path === '/') return []
  const parts = path.split('/').filter((s) => s.length > 0)
  const out: { name: string; path: string }[] = []
  let acc = ''
  for (const p of parts) {
    acc += '/' + p
    out.push({ name: p, path: acc })
  }
  return out
}

export function joinPath(parent: string, name: string): string {
  if (parent === '/' || parent === '') return '/' + name
  return `${parent}/${name}`
}
