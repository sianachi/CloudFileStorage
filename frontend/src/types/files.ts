export type FileEntry = {
  name: string
  path: string
  size: number
  is_directory: boolean
  last_updated: string
}

export type ListResponse = {
  path: string
  entries: FileEntry[]
}

export type Quota = {
  bytes_used: number
  bytes_limit: number | null
}
