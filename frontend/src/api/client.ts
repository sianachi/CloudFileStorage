import { apiUrl } from './baseUrl'

export type ApiErrorBody = { detail?: string | unknown }

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
    const detail =
      parsed &&
      typeof parsed === 'object' &&
      'detail' in parsed &&
      typeof (parsed as ApiErrorBody).detail === 'string'
        ? (parsed as ApiErrorBody).detail
        : res.statusText
    throw new ApiRequestError(
      typeof detail === 'string' ? detail : res.statusText,
      res.status,
      parsed,
    )
  }

  return parsed as T
}
