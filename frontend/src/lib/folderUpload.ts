import { ApiRequestError } from '../api/client'
import { createFolder, uploadFile } from '../api/files'
import { joinPath } from '../pages/portal/path'

/** A single file to upload, with its parent path relative to the upload root. */
export type UploadItem = {
  /** Path of the parent folder, relative to the upload root. "" = root. */
  relativeParent: string
  file: File
}

export type ConflictDecision = 'overwrite' | 'overwrite-all' | 'skip' | 'skip-all'
export type ConflictHandler = (label: string) => Promise<ConflictDecision>
export type UploadProgress = { current: number; total: number; failures: string[] }

const DEFAULT_CONCURRENCY = 3

/* ----------------------------- Tree walkers ----------------------------- */

/**
 * Read all entries from a directory reader. The browser may return the
 * children in batches, so we keep calling readEntries until it returns
 * an empty array.
 */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const tick = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all)
          } else {
            all.push(...batch)
            tick()
          }
        },
        reject,
      )
    }
    tick()
  })
}

function fileFromEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

async function walkDirectoryEntry(
  dir: FileSystemDirectoryEntry,
  parentPath: string,
): Promise<UploadItem[]> {
  const here = parentPath ? `${parentPath}/${dir.name}` : dir.name
  const entries = await readAllEntries(dir.createReader())
  const tasks = entries.map(async (e): Promise<UploadItem[]> => {
    if (e.isFile) {
      const file = await fileFromEntry(e as FileSystemFileEntry)
      return [{ relativeParent: here, file }]
    }
    if (e.isDirectory) {
      return walkDirectoryEntry(e as FileSystemDirectoryEntry, here)
    }
    return []
  })
  return (await Promise.all(tasks)).flat()
}

/**
 * Convert a drop's DataTransferItemList into a flat list of UploadItems.
 * Top-level files end up with `relativeParent === ""`. Folders preserve
 * their full subtree.
 */
export async function readDataTransferTree(
  items: DataTransferItemList,
): Promise<UploadItem[]> {
  const tasks: Promise<UploadItem[]>[] = []
  for (const item of Array.from(items)) {
    // webkitGetAsEntry is the de-facto standard, despite the prefix.
    const entry = item.webkitGetAsEntry?.()
    if (!entry) continue
    if (entry.isFile) {
      tasks.push(
        fileFromEntry(entry as FileSystemFileEntry).then((file) => [
          { relativeParent: '', file },
        ]),
      )
    } else if (entry.isDirectory) {
      tasks.push(walkDirectoryEntry(entry as FileSystemDirectoryEntry, ''))
    }
  }
  const results = await Promise.all(tasks)
  return results.flat()
}

/**
 * Convert a FileList from a `<input type="file" webkitdirectory>` into
 * UploadItems. Each File has `webkitRelativePath` like
 * "rootName/sub/file.txt"; we split off the trailing filename.
 */
export function fromDirectoryInput(files: FileList): UploadItem[] {
  const out: UploadItem[] = []
  for (const file of Array.from(files)) {
    const rel = file.webkitRelativePath || file.name
    const lastSlash = rel.lastIndexOf('/')
    const relativeParent = lastSlash >= 0 ? rel.slice(0, lastSlash) : ''
    out.push({ relativeParent, file })
  }
  return out
}

/* --------------------------- Upload orchestration --------------------------- */

function labelFor(item: UploadItem): string {
  return item.relativeParent
    ? `${item.relativeParent}/${item.file.name}`
    : item.file.name
}

type UploadOptions = {
  onProgress: (progress: UploadProgress) => void
  /** Called when the backend reports a 409. Resolve with the user's decision. */
  onConflict: ConflictHandler
  /** Override the default 3-at-a-time worker count (mostly for tests). */
  concurrency?: number
}

/**
 * Upload a list of UploadItems into `currentPath` on the backend, creating
 * intermediate folders as needed. Reports progress; calls onConflict for
 * each existing-file collision (with batch latching for "all" choices);
 * runs file uploads in a small worker pool.
 */
export async function uploadItems(
  items: UploadItem[],
  currentPath: string,
  token: string,
  opts: UploadOptions,
): Promise<UploadProgress> {
  const { onProgress, onConflict } = opts
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY)

  // 1. Pre-create every directory that any file lives in. Sort by depth so
  // parents come before children. This is sequential (and fast) so workers
  // never race to create the same parent.
  const dirSet = new Set<string>()
  for (const it of items) {
    if (!it.relativeParent) continue
    const parts = it.relativeParent.split('/')
    let acc = ''
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p
      dirSet.add(acc)
    }
  }
  const dirs = Array.from(dirSet).sort((a, b) => a.split('/').length - b.split('/').length)
  for (const dir of dirs) {
    const fullPath = joinPath(currentPath, dir)
    try {
      await createFolder(fullPath, token)
    } catch (e) {
      // 409 = already exists; treat as merge. Other errors are surfaced
      // implicitly when subsequent file uploads fail with a clearer message.
      if (!(e instanceof ApiRequestError) || e.status !== 409) {
        // intentionally swallow
      }
    }
  }

  // 2. Worker pool. Shared mutable state below is single-threaded JS so
  // a plain counter is safe.
  const failures: string[] = []
  let completed = 0
  let nextIndex = 0
  // Latched batch decisions ("all" choices) — once set, applied without
  // another prompt for the rest of this upload.
  let batchDecision: 'overwrite' | 'skip' | null = null

  onProgress({ current: 0, total: items.length, failures: [] })

  const resolveConflict = async (label: string): Promise<'overwrite' | 'skip'> => {
    if (batchDecision !== null) return batchDecision
    const choice = await onConflict(label)
    if (choice === 'overwrite-all') {
      batchDecision = 'overwrite'
      return 'overwrite'
    }
    if (choice === 'skip-all') {
      batchDecision = 'skip'
      return 'skip'
    }
    return choice
  }

  const handleOne = async (item: UploadItem): Promise<void> => {
    const parent = item.relativeParent
      ? joinPath(currentPath, item.relativeParent)
      : currentPath
    try {
      await uploadFile(parent, item.file, token)
      return
    } catch (e) {
      if (!(e instanceof ApiRequestError) || e.status !== 409) {
        failures.push(labelFor(item))
        return
      }
    }
    // 409 path: ask the user (or use the latched batch decision).
    const decision = await resolveConflict(labelFor(item))
    if (decision === 'skip') return
    try {
      await uploadFile(parent, item.file, token, { overwrite: true })
    } catch {
      failures.push(labelFor(item))
    }
  }

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIndex
      nextIndex += 1
      if (i >= items.length) return
      await handleOne(items[i])
      completed += 1
      onProgress({ current: completed, total: items.length, failures: [...failures] })
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))

  return { current: completed, total: items.length, failures }
}
