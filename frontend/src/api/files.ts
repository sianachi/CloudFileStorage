import { ApiRequestError, apiJson, notifyUnauthorized } from './client'
import { apiUrl } from './baseUrl'
import type { FileEntry, ListResponse, Quota } from '../types/files'

export async function listFiles(path: string, token: string): Promise<ListResponse> {
  return apiJson<ListResponse>(
    `/files?path=${encodeURIComponent(path)}`,
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
): Promise<FileEntry> {
  const form = new FormData()
  form.append('upload', file, file.name)

  // FormData uploads bypass apiJson because we must NOT set Content-Type;
  // the browser fills it in with the multipart boundary.
  const res = await fetch(
    apiUrl(`/files?parent=${encodeURIComponent(parent)}`),
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
