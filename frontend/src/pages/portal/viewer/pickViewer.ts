export type ViewerKind = 'image' | 'pdf' | 'video' | 'zip' | 'markdown' | 'other'

const EXT_TO_KIND: Record<string, ViewerKind> = {
  // image
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  // pdf
  pdf: 'pdf',
  // video
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  m4v: 'video',
  // zip
  zip: 'zip',
  // markdown
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
}

export function pickViewer(name: string): ViewerKind {
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return 'other'
  const ext = name.slice(dot + 1).toLowerCase()
  return EXT_TO_KIND[ext] ?? 'other'
}
