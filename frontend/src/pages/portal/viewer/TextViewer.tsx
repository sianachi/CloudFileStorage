import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAsBlob } from '../../../api/files'
import { formatBytes } from '../../../lib/format'
import { ScrollControls } from './ScrollControls'

type Props = {
  path: string
  token: string
}

const TEXT_LIMIT_BYTES = 1024 * 1024 // 1 MB — keeps the DOM responsive

// Filename extension → highlight.js language. Anything not listed falls
// back to highlight.js auto-detection.
const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', php: 'php',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  scala: 'scala', clj: 'clojure', ex: 'elixir', exs: 'elixir', erl: 'erlang',
  hs: 'haskell', ml: 'ocaml', lua: 'lua', dart: 'dart', r: 'r',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  ps1: 'powershell', psm1: 'powershell',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  json: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'makefile', mk: 'makefile',
  vim: 'vim', diff: 'diff', patch: 'diff',
  proto: 'protobuf',
}

function detectLanguage(path: string): string | null {
  const filename = (path.split('/').pop() || '').toLowerCase()
  if (filename === 'dockerfile') return 'dockerfile'
  if (filename === 'makefile') return 'makefile'
  const dot = filename.lastIndexOf('.')
  if (dot < 0 || dot === filename.length - 1) return null
  const ext = filename.slice(dot + 1)
  return LANG_BY_EXT[ext] ?? null
}

export function TextViewer({ path, token }: Props) {
  const [text, setText] = useState<string | null>(null)
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
            originalSize > TEXT_LIMIT_BYTES
              ? res.blob.slice(0, TEXT_LIMIT_BYTES)
              : res.blob
          const decoded = await slice.text()
          if (cancelled) return
          setText(decoded)
          setTruncatedFrom(originalSize > TEXT_LIMIT_BYTES ? originalSize : null)
        } finally {
          res.revoke()
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load this file as text.')
      })

    return () => {
      cancelled = true
    }
  }, [path, token])

  // Highlight once per (text, path) pair. highlightAuto is slow on huge
  // inputs (~100ms for 1MB) but acceptable since it runs once.
  const highlightedHtml = useMemo(() => {
    if (text === null) return ''
    const lang = detectLanguage(path)
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
    }
    return hljs.highlightAuto(text).value
  }, [text, path])

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-300">
        {error}
      </div>
    )
  }

  if (text === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-400">
        Loading…
      </div>
    )
  }

  // SAFETY: highlight.js HTML-escapes the input file's content before
  // wrapping tokens in <span class="hljs-...">. It never emits attributes
  // sourced from the file, so a `.html` file containing <script> renders
  // as the literal text "<script>", not an executing element. This is the
  // documented contract of hljs.highlight() / hljs.highlightAuto().
  return (
    <div className="relative flex flex-1 flex-col">
      {truncatedFrom !== null ? (
        <div className="shrink-0 border-b border-white/10 bg-amber-900/40 px-4 py-2 text-xs text-amber-100">
          Showing the first {formatBytes(TEXT_LIMIT_BYTES)} of {formatBytes(truncatedFrom)}.
        </div>
      ) : null}
      <pre
        ref={scrollRef}
        className="hljs flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed"
      >
        <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
      <ScrollControls targetRef={scrollRef} />
    </div>
  )
}
