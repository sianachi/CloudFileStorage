import { useEffect, useState } from 'react'
import { fetchAsBlob } from '../../../api/files'

type Props = {
  path: string
  token: string
}

export function ImageViewer({ path, token }: Props) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let revoke: (() => void) | null = null

    fetchAsBlob(path, token)
      .then((res) => {
        if (cancelled) {
          res.revoke()
          return
        }
        revoke = res.revoke
        setObjectUrl(res.objectUrl)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this image.')
      })

    return () => {
      cancelled = true
      revoke?.()
    }
  }, [path, token])

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-300">
        {error}
      </div>
    )
  }

  if (!objectUrl) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-400">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <img
        src={objectUrl}
        alt={path}
        className="max-h-full max-w-full object-contain"
      />
    </div>
  )
}
