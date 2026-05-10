import { ApiRequestError, apiJson, notifyUnauthorized } from './client'
import { apiUrl } from './baseUrl'
import type { FileEntry, ListResponse, Quota, ZipListingResponse } from '../types/files'

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

export async function uploadFile(
  parent: string,
  file: File,
  token: string,
  opts?: { overwrite?: boolean },
): Promise<FileEntry> {
  const form = new FormData()
  form.append('upload', file, file.name)

  // FormData uploads bypass apiJson because we must NOT set Content-Type;
  // the browser fills it in with the multipart boundary.
  const overwriteParam = opts?.overwrite ? '&overwrite=true' : ''
  const res = await fetch(
    apiUrl(`/files?parent=${encodeURIComponent(parent)}${overwriteParam}`),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  )

  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  }
  if (!res.ok) {
    if (res.status === 401) notifyUnauthorized()
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : res.statusText
    throw new ApiRequestError(detail, res.status, parsed)
  }
  return parsed as FileEntry
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
