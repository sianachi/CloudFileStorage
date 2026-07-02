import { apiJson } from './client'
import { apiUrl } from './baseUrl'
import type {
  FileEntry,
  ListResponse,
  ShareInfo,
  SharedWithMeEntry,
} from '../types/files'

export type CreateShareInput = {
  path: string
  targetUsername?: string
  public?: boolean
  role?: 'read' | 'write'
  expiresInHours?: number
}

export async function createShare(
  input: CreateShareInput,
  token: string,
): Promise<ShareInfo> {
  return apiJson<ShareInfo>('/shares', {
    method: 'POST',
    body: {
      path: input.path,
      target_username: input.targetUsername ?? null,
      public: input.public ?? false,
      role: input.role ?? 'read',
      expires_in_hours: input.expiresInHours ?? null,
    },
    token,
  })
}

export async function listMyShares(token: string): Promise<ShareInfo[]> {
  const res = await apiJson<{ shares: ShareInfo[] }>('/shares/mine', { token })
  return res.shares
}

export async function revokeShare(id: number, token: string): Promise<void> {
  await apiJson<{ success: boolean }>(`/shares?id=${id}`, {
    method: 'DELETE',
    token,
  })
}

export async function sharedWithMe(token: string): Promise<SharedWithMeEntry[]> {
  const res = await apiJson<{ entries: SharedWithMeEntry[] }>('/shares/with-me', {
    token,
  })
  return res.entries
}

export async function listSharedEntry(
  shareId: number,
  subpath: string,
  token: string,
): Promise<ListResponse> {
  return apiJson<ListResponse>(
    `/shares/with-me/list?id=${shareId}&subpath=${encodeURIComponent(subpath)}`,
    { token },
  )
}

export function sharedDownloadUrl(shareId: number, subpath: string): string {
  return apiUrl(
    `/shares/with-me/download?id=${shareId}&subpath=${encodeURIComponent(subpath)}`,
  )
}

export function publicShareUrl(token: string): string {
  // Absolute link a user can copy and share externally.
  const base = apiUrl(`/public/${encodeURIComponent(token)}/download`)
  if (base.startsWith('http')) return base
  return `${window.location.origin}${base}`
}

export async function saveSharedContent(
  shareId: number,
  subpath: string,
  content: string,
  token: string,
): Promise<FileEntry> {
  return apiJson<FileEntry>(
    `/shares/with-me/content?id=${shareId}&subpath=${encodeURIComponent(subpath)}`,
    { method: 'PUT', body: { content }, token },
  )
}
