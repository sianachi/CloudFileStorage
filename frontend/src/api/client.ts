import { apiUrl } from './baseUrl'

export type ApiErrorBody = { detail?: string | unknown }

type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

export function notifyUnauthorized(): void {
  for (const l of unauthorizedListeners) {
    try {
      l()
    } catch {
      /* swallow listener errors so one bad subscriber can't block others */
    }
  }
}

type FastApiValidationItem = {
  loc?: unknown
  msg?: unknown
}

export class ApiRequestError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.body = body
  }
}

function formatValidationItem(item: FastApiValidationItem): string | null {
  const msg = typeof item.msg === 'string' ? item.msg : null
  if (!msg) return null
  if (Array.isArray(item.loc) && item.loc.length > 0) {
    const field = item.loc[item.loc.length - 1]
    if (typeof field === 'string' && field !== 'body') {
      return `${field}: ${msg}`
    }
  }
  return msg
}

function extractErrorMessage(parsed: unknown, fallback: string): string {
  if (!parsed || typeof parsed !== 'object' || !('detail' in parsed)) {
    return fallback
  }
  const detail = (parsed as ApiErrorBody).detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => formatValidationItem(item as FastApiValidationItem))
      .filter((m): m is string => m !== null)
    if (messages.length > 0) return messages.join('; ')
  }
  return fallback
}

export async function apiJson<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    token?: string | null
  } = {},
): Promise<T> {
  const { method = 'GET', body, token } = options
  const headers: HeadersInit = {}
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(apiUrl(path), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      parsed = text
    }
  }

  if (!res.ok) {
    if (res.status === 401 && token) {
      // Token-bearing call returned 401 → auth is stale; let listeners
      // (AuthContext) clear the session so the user gets bounced to /login
      // instead of a portal full of silent failures.
      notifyUnauthorized()
    }
    const message = extractErrorMessage(parsed, res.statusText)
    throw new ApiRequestError(message, res.status, parsed)
  }

  return parsed as T
}
