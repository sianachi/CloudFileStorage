export type FileEntry = {
  name: string
  path: string
  size: number
  is_directory: boolean
  last_updated: string
  checksum?: string | null
  is_favorite?: boolean
}

export type ListResponse = {
  path: string
  entries: FileEntry[]
}

export type Quota = {
  bytes_used: number
  bytes_limit: number | null
}

export type SearchResponse = {
  query: string
  entries: FileEntry[]
}

export type TrashEntry = {
  name: string
  trash_path: string
  original_path: string
  size: number
  is_directory: boolean
  deleted_at: string
}

export type VersionEntry = {
  version_no: number
  size: number
  checksum: string | null
  created_at: string
}

export type ShareInfo = {
  id: number
  kind: 'user' | 'link'
  entry_path: string
  is_directory: boolean
  role: 'read' | 'write'
  target_username: string | null
  public_token: string | null
  created_at: string
  expires_at: string | null
}

export type SharedWithMeEntry = {
  share_id: number
  owner_username: string
  name: string
  entry_path: string
  is_directory: boolean
  role: 'read' | 'write'
  expires_at: string | null
}

export type ZipEntryDto = {
  name: string
  is_dir: boolean
  size: number
  compressed_size: number
  modified: string
}

export type ZipListingResponse = {
  path: string
  entries: ZipEntryDto[]
}
