import { useEffect, useState } from 'react'
import { requestViewToken, viewUrlFromToken } from '../../api/viewTokens'

type Props = {
  path: string
  token: string
  alt?: string
  className?: string
}

/**
 * Image thumbnail loader. Mints a short-lived signed URL so the `<img>` tag
 * can load without an Authorization header. Returns nothing while loading
 * or on error — callers should render a fallback (icon) underneath.
 *
 * Note: this serves the FULL image bytes, just scaled by the browser. Fine
 * for grids of tens of files; for hundreds, the right fix is a server-side
 * thumbnail-resize endpoint.
 */
export function Thumbnail({ path, token, alt, className }: Props) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    requestViewToken(path, token)
      .then((vt) => {
        if (!cancelled) setSrc(viewUrlFromToken(vt.token))
      })
      .catch(() => {
        /* leave src null → caller's icon shows */
      })
    return () => {
      cancelled = true
    }
  }, [path, token])

  if (!src) return null

  return (
    <img
      src={src}
      alt={alt ?? ''}
      loading="lazy"
      className={className ?? 'h-full w-full object-cover'}
    />
  )
}
