import { useEffect, useState } from 'react'
import { requestViewToken, viewUrlFromToken } from '../../../api/viewTokens'

type Props = {
  path: string
  token: string
}

/**
 * Video uses a short-lived signed URL instead of a blob URL. Why:
 * `<video src={blobUrl}>` cannot issue HTTP Range requests, so the entire
 * file has to download before playback can start and seeking is glitchy.
 *
 * The signed URL goes straight at GET /files/view?token=..., which Starlette
 * serves via FileResponse — and FileResponse honors Range / 206 Partial
 * Content automatically. Native seeking, progressive playback, no hacks.
 */
export function VideoViewer({ path, token }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    requestViewToken(path, token)
      .then((vt) => {
        if (cancelled) return
        setSrc(viewUrlFromToken(vt.token))
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this video.')
      })

    return () => {
      cancelled = true
    }
  }, [path, token])

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-300">
        {error}
      </div>
    )
  }

  if (!src) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-400">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <video
        src={src}
        controls
        autoPlay
        muted
        playsInline
        className="max-h-full max-w-full object-contain"
      />
    </div>
  )
}
