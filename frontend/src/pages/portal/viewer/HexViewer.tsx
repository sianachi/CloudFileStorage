import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAsBlob } from '../../../api/files'
import { formatBytes } from '../../../lib/format'
import { ScrollControls } from './ScrollControls'

type Props = {
  path: string
  token: string
}

const HEX_LIMIT_BYTES = 64 * 1024 // 64 KB — keeps the row count bounded
const BYTES_PER_ROW = 16

export function HexViewer({ path, token }: Props) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [truncatedFrom, setTruncatedFrom] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    let cancelled = false

    fetchAsBlob(path, token)
      .then(async (res) => {
        try {
          const originalSize = res.blob.size
          const slice =
            originalSize > HEX_LIMIT_BYTES
              ? res.blob.slice(0, HEX_LIMIT_BYTES)
              : res.blob
          const buf = await slice.arrayBuffer()
          if (cancelled) return
          setBytes(new Uint8Array(buf))
          setTruncatedFrom(originalSize > HEX_LIMIT_BYTES ? originalSize : null)
        } finally {
          res.revoke()
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this file as binary.')
      })

    return () => {
      cancelled = true
    }
  }, [path, token])

  const formatted = useMemo(() => {
    if (!bytes) return ''
    return formatHexDump(bytes)
  }, [bytes])

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-300">
        {error}
      </div>
    )
  }

  if (!bytes) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-400">
        Loading…
      </div>
    )
  }

  return (
    <div className="relative flex flex-1 flex-col">
      {truncatedFrom !== null ? (
        <div className="shrink-0 border-b border-white/10 bg-amber-900/40 px-4 py-2 text-xs text-amber-100">
          Showing the first {formatBytes(HEX_LIMIT_BYTES)} of {formatBytes(truncatedFrom)}.
        </div>
      ) : null}
      <pre
        ref={scrollRef}
        className="flex-1 overflow-auto whitespace-pre p-4 font-mono text-xs leading-relaxed text-neutral-200"
      >
        {formatted}
      </pre>
      <ScrollControls targetRef={scrollRef} />
    </div>
  )
}

function formatHexDump(bytes: Uint8Array): string {
  const lines: string[] = []
  for (let offset = 0; offset < bytes.length; offset += BYTES_PER_ROW) {
    const slice = bytes.subarray(offset, offset + BYTES_PER_ROW)
    const addr = offset.toString(16).padStart(8, '0')
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(BYTES_PER_ROW * 3 - 1, ' ')
    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('')
    lines.push(`${addr}  ${hex}  ${ascii}`)
  }
  return lines.join('\n')
}
