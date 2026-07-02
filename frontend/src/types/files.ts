export type FileEntry = {
  name: string
  path: string
  size: number
  is_directory: boolean
  last_updated: string
  checksum?: string | null
}

export type ListResponse = {
  path: string
  entries: FileEntry[]
}

export type Quota = {
  bytes_used: number
  bytes_limit: number | null
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
