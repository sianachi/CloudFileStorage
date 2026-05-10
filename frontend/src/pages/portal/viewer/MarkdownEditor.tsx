import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CreateLink,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  codeMirrorPlugin,
  headingsPlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { useEffect, useRef, useState } from 'react'
import { fetchAsBlob, saveFileContent } from '../../../api/files'
import { ApiRequestError } from '../../../api/client'

type Props = {
  path: string
  token: string
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function MarkdownEditor({ path, token }: Props) {
  const [initial, setInitial] = useState<string | null>(null)
  const [current, setCurrent] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  // Capture the latest content in a ref so the toolbar's onClick (which is
  // re-created by MDXEditor on every render) can read the freshest value
  // without re-binding the toolbar on every keystroke.
  const currentRef = useRef('')
  useEffect(() => {
    currentRef.current = current
  }, [current])

  useEffect(() => {
    let cancelled = false
    fetchAsBlob(path, token)
      .then(async (res) => {
        try {
          const text = await res.blob.text()
          if (cancelled) return
          setInitial(text)
          setCurrent(text)
        } finally {
          res.revoke()
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load this markdown file.')
      })
    return () => {
      cancelled = true
    }
  }, [path, token])

  const dirty = initial !== null && current !== initial

  const handleSave = async () => {
    if (!dirty || saveState === 'saving') return
    setSaveState('saving')
    setSaveError(null)
    try {
      await saveFileContent(path, currentRef.current, token)
      setInitial(currentRef.current)
      setSaveState('saved')
      // Auto-clear the "Saved" badge after a moment so the toolbar isn't
      // permanently green.
      window.setTimeout(() => {
        setSaveState((s) => (s === 'saved' ? 'idle' : s))
      }, 1500)
    } catch (err) {
      const msg =
        err instanceof ApiRequestError ? err.message : 'Could not save changes.'
      setSaveError(msg)
      setSaveState('error')
    }
  }

  // Warn before leaving if there are unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-300">
        {loadError}
      </div>
    )
  }

  if (initial === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-neutral-400">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col bg-white text-neutral-900">
      <MDXEditor
        markdown={initial}
        onChange={setCurrent}
        contentEditableClassName="prose-sm max-w-none p-4 min-h-[40vh] focus:outline-none"
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          tablePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: 'ts' }),
          codeMirrorPlugin({
            codeBlockLanguages: {
              ts: 'TypeScript',
              tsx: 'TypeScript',
              js: 'JavaScript',
              jsx: 'JavaScript',
              py: 'Python',
              go: 'Go',
              rs: 'Rust',
              json: 'JSON',
              yaml: 'YAML',
              bash: 'Bash',
              sql: 'SQL',
              css: 'CSS',
              html: 'HTML',
              md: 'Markdown',
              text: 'Plain text',
            },
          }),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarContents: () => (
              <>
                <UndoRedo />
                <Separator />
                <BoldItalicUnderlineToggles />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <ListsToggle />
                <Separator />
                <CreateLink />
                <InsertCodeBlock />
                <InsertTable />
                <InsertThematicBreak />
                <Separator />
                <SaveStatusButton
                  dirty={dirty}
                  state={saveState}
                  error={saveError}
                  onSave={handleSave}
                />
              </>
            ),
          }),
        ]}
      />
    </div>
  )
}

function SaveStatusButton({
  dirty,
  state,
  error,
  onSave,
}: {
  dirty: boolean
  state: SaveState
  error: string | null
  onSave: () => void
}) {
  const disabled = !dirty || state === 'saving'
  const label =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
        ? 'Saved'
        : state === 'error'
          ? 'Retry save'
          : dirty
            ? 'Save'
            : 'Saved'
  const tone =
    state === 'error'
      ? 'bg-red-600 text-white hover:bg-red-700'
      : state === 'saved'
        ? 'bg-emerald-600 text-white'
        : 'bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-300 disabled:text-neutral-600'
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={disabled}
      title={error ?? undefined}
      className={`ml-auto rounded-full px-3 py-1 text-xs font-medium transition-colors ${tone} disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  )
}
