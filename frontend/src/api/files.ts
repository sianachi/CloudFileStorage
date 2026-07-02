import { ApiRequestError, apiJson, notifyUnauthorized } from './client'
import { apiUrl } from './baseUrl'
import type {
  FileEntry,
  ListResponse,
  Quota,
  SearchResponse,
  TrashEntry,
  VersionEntry,
  ZipListingResponse,
} from '../types/files'

export async function listFiles(path: string, token: string): Promise<ListResponse> {
  return apiJson<ListResponse>(
    `/files?path=${encodeURIComponent(path)}`,
    { token },
  )
}

export async function listZipEntries(
  path: string,
  token: string,
): Promise<ZipListingResponse> {
  return apiJson<ZipListingResponse>(
    `/files/zip/listing?path=${encodeURIComponent(path)}`,
    { token },
  )
}

export async function getQuota(token: string): Promise<Quota> {
  return apiJson<Quota>('/quota', { token })
}

export async function createFolder(path: string, token: string): Promise<FileEntry> {
  return apiJson<FileEntry>('/folders', {
    method: 'POST',
    body: { path },
    token,
  })
}

export async function renameEntry(
  path: string,
  newName: string,
  token: string,
): Promise<FileEntry> {
  return apiJson<FileEntry>(`/files?path=${encodeURIComponent(path)}`, {
    method: 'PATCH',
    body: { new_name: newName },
    token,
  })
}

export async function saveFileContent(
  path: string,
  content: string,
  token: string,
): Promise<FileEntry> {
  return apiJson<FileEntry>(`/files/content?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: { content },
    token,
  })
}

export async function deleteEntry(path: string, token: string): Promise<void> {
  await apiJson<{ success: boolean }>(
    `/files?path=${encodeURIComponent(path)}`,
    { method: 'DELETE', token },
  )
}

export async function moveEntry(
  source: string,
  destinationParent: string,
  token: string,
): Promise<FileEntry> {
  return apiJson<FileEntry>('/files/move', {
    method: 'POST',
    body: { source, destination_parent: destinationParent },
    token,
  })
}

export async function searchFiles(query: string, token: string): Promise<SearchResponse> {
  return apiJson<SearchResponse>(
    `/files/search?q=${encodeURIComponent(query)}`,
    { token },
  )
}

export async function setFavorite(
  path: string,
  favorite: boolean,
  token: string,
): Promise<FileEntry> {
  return apiJson<FileEntry>('/files/favorite', {
    method: 'POST',
    body: { path, favorite },
    token,
  })
}

export async function listFavorites(token: string): Promise<ListResponse> {
  return apiJson<ListResponse>('/files/favorites', { token })
}

export async function listRecent(token: string): Promise<ListResponse> {
  return apiJson<ListResponse>('/files/recent', { token })
}

// --- trash ---------------------------------------------------------------

export async function listTrash(token: string): Promise<{ entries: TrashEntry[] }> {
  return apiJson<{ entries: TrashEntry[] }>('/trash', { token })
}

export async function restoreFromTrash(trashPath: string, token: string): Promise<FileEntry> {
  return apiJson<FileEntry>(
    `/trash/restore?path=${encodeURIComponent(trashPath)}`,
    { method: 'POST', token },
  )
}

export async function purgeFromTrash(trashPath: string, token: string): Promise<void> {
  await apiJson<{ success: boolean }>(
    `/trash?path=${encodeURIComponent(trashPath)}`,
    { method: 'DELETE', token },
  )
}

export async function emptyTrash(token: string): Promise<number> {
  const res = await apiJson<{ purged: number }>('/trash/all', {
    method: 'DELETE',
    token,
  })
  return res.purged
}

// --- versions ------------------------------------------------------------

export async function listVersions(
  path: string,
  token: string,
): Promise<{ path: string; versions: VersionEntry[] }> {
  return apiJson<{ path: string; versions: VersionEntry[] }>(
    `/files/versions?path=${encodeURIComponent(path)}`,
    { token },
  )
}

export async function restoreVersion(
  path: string,
  version: number,
  token: string,
): Promise<FileEntry> {
  return apiJson<FileEntry>(
    `/files/versions/restore?path=${encodeURIComponent(path)}&version=${version}`,
    { method: 'POST', token },
  )
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function fetchAndSave(url: string, filename: string, token: string): Promise<void> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized()
    throw new ApiRequestError(res.statusText, res.status, null)
  }
  saveBlob(await res.blob(), filename)
}

export async function downloadVersion(
  path: string,
  version: number,
  token: string,
): Promise<void> {
  const name = path.split('/').pop() || 'file'
  await fetchAndSave(
    apiUrl(`/files/versions/download?path=${encodeURIComponent(path)}&version=${version}`),
    `${name}.v${version}`,
    token,
  )
}

export async function downloadSharedFile(
  shareId: number,
  subpath: string,
  filename: string,
  token: string,
): Promise<void> {
  await fetchAndSave(
    apiUrl(`/shares/with-me/download?id=${shareId}&subpath=${encodeURIComponent(subpath)}`),
    filename,
    token,
  )
}

export type UploadProgress = (loaded: number, total: number) => void

export type UploadOptions = {
  overwrite?: boolean
  onProgress?: UploadProgress
  signal?: AbortSignal
}

// Above this size a single POST is swapped for the resumable chunked protocol
// so a dropped connection can pick up where it left off.
const RESUMABLE_THRESHOLD = 8 * 1024 * 1024
const CHUNK_SIZE = 4 * 1024 * 1024

function parseBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function detailOf(parsed: unknown, fallback: string): string {
  return parsed && typeof parsed === 'object' && 'detail' in parsed
    ? String((parsed as { detail: unknown }).detail)
    : fallback
}

/**
 * Upload a file. Reports progress via `opts.onProgress` and can be cancelled
 * via `opts.signal`. Large files transparently use the resumable protocol.
 */
export async function uploadFile(
  parent: string,
  file: File,
  token: string,
  opts?: UploadOptions,
): Promise<FileEntry> {
  if (file.size > RESUMABLE_THRESHOLD) {
    return uploadFileResumable(parent, file, token, opts)
  }

  // Single-shot upload over XMLHttpRequest — unlike fetch(), it exposes
  // upload progress events.
  const overwriteParam = opts?.overwrite ? '&overwrite=true' : ''
  const url = apiUrl(`/files?parent=${encodeURIComponent(parent)}${overwriteParam}`)
  const form = new FormData()
  form.append('upload', file, file.name)

  return new Promise<FileEntry>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if (opts?.onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress!(e.loaded, e.total)
      }
    }
    xhr.onload = () => {
      const parsed = parseBody(xhr.responseText)
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as FileEntry)
        return
      }
      if (xhr.status === 401) notifyUnauthorized()
      reject(new ApiRequestError(detailOf(parsed, xhr.statusText), xhr.status, parsed))
    }
    xhr.onerror = () => reject(new ApiRequestError('network error', 0, null))
    xhr.onabort = () => reject(new ApiRequestError('upload cancelled', 0, null))
    if (opts?.signal) {
      if (opts.signal.aborted) {
        xhr.abort()
        return
      }
      opts.signal.addEventListener('abort', () => xhr.abort())
    }
    xhr.send(form)
  })
}

type UploadSession = {
  upload_id: string
  received: number
  declared_size: number
}

/**
 * Resumable upload: init a session, PUT chunks (re-syncing from the server's
 * received offset on a conflict, which is what makes an interrupted upload
 * resumable), then complete. Progress is reported per chunk.
 */
export async function uploadFileResumable(
  parent: string,
  file: File,
  token: string,
  opts?: UploadOptions,
): Promise<FileEntry> {
  const session = await apiJson<UploadSession>('/files/upload/init', {
    method: 'POST',
    body: { parent, name: file.name, size: file.size },
    token,
  })
  const uploadId = session.upload_id
  let offset = session.received

  const putChunk = async (at: number): Promise<UploadSession> => {
    const end = Math.min(at + CHUNK_SIZE, file.size)
    const buf = await file.slice(at, end).arrayBuffer()
    const res = await fetch(
      apiUrl(
        `/files/upload/chunk?upload_id=${encodeURIComponent(uploadId)}&offset=${at}`,
      ),
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
        },
        body: buf,
      },
    )
    const parsed = parseBody(await res.text())
    if (!res.ok) {
      if (res.status === 401) notifyUnauthorized()
      throw new ApiRequestError(detailOf(parsed, res.statusText), res.status, parsed)
    }
    return parsed as UploadSession
  }

  opts?.onProgress?.(offset, file.size)
  while (offset < file.size) {
    if (opts?.signal?.aborted) {
      await abortUpload(uploadId, token).catch(() => {})
      throw new ApiRequestError('upload cancelled', 0, null)
    }
    try {
      const result = await putChunk(offset)
      offset = result.received
    } catch (e) {
      // On an offset conflict, re-sync from the server's view and retry.
      if (e instanceof ApiRequestError && e.status === 409) {
        const status = await apiJson<UploadSession>(
          `/files/upload/status?upload_id=${encodeURIComponent(uploadId)}`,
          { token },
        )
        offset = status.received
        continue
      }
      throw e
    }
    opts?.onProgress?.(offset, file.size)
  }

  return apiJson<FileEntry>('/files/upload/complete', {
    method: 'POST',
    body: { upload_id: uploadId, overwrite: opts?.overwrite ?? false },
    token,
  })
}

export async function abortUpload(uploadId: string, token: string): Promise<void> {
  await apiJson<{ success: boolean }>(
    `/files/upload?upload_id=${encodeURIComponent(uploadId)}`,
    { method: 'DELETE', token },
  )
}

/**
 * Fetch a file's bytes with bearer auth and expose them as a same-origin
 * object URL that `<img>` / `<iframe>` / `<video>` can load directly. Caller
 * must invoke `revoke()` when done so the blob can be garbage-collected.
 *
 * Note: object URLs do not honor HTTP Range requests, so this is unsuitable
 * for video seeking on large files — use the signed-URL flow there instead.
 */
export async function fetchAsBlob(
  path: string,
  token: string,
): Promise<{ blob: Blob; objectUrl: string; revoke: () => void }> {
  const res = await fetch(
    apiUrl(`/files/download?path=${encodeURIComponent(path)}&inline=true`),
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized()
    throw new ApiRequestError(res.statusText, res.status, null)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  return {
    blob,
    objectUrl,
    revoke: () => URL.revokeObjectURL(objectUrl),
  }
}

export async function downloadFile(path: string, token: string): Promise<void> {
  const res = await fetch(
    apiUrl(`/files/download?path=${encodeURIComponent(path)}`),
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized()
    throw new ApiRequestError(res.statusText, res.status, null)
  }
  const blob = await res.blob()
  const filename = path.split('/').pop() || 'download'

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function downloadFolder(
  path: string,
  token: string,
  onProgress?: (received: number) => void,
): Promise<void> {
  const res = await fetch(
    apiUrl(`/files/folder/download?path=${encodeURIComponent(path)}`),
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized()
    throw new ApiRequestError(res.statusText, res.status, null)
  }

  // Stream the response so we can report bytes-received as the zip arrives.
  // The full archive still ends up in browser memory before the save
  // dialog — true streamed-to-disk needs a service worker (out of scope).
  const reader = res.body?.getReader()
  let blob: Blob
  if (!reader) {
    // Older browsers / no streams support — fall back to whole-blob.
    blob = await res.blob()
    onProgress?.(blob.size)
  } else {
    const chunks: BlobPart[] = []
    let received = 0
    onProgress?.(0)
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.byteLength
        onProgress?.(received)
      }
    }
    blob = new Blob(chunks, { type: 'application/zip' })
  }

  const folderName = path.split('/').pop() || 'folder'
  const filename = `${folderName}.zip`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
