import { apiJson, ApiRequestError, notifyUnauthorized } from './client'
import { apiUrl } from './baseUrl'

export type ViewToken = {
  token: string
  /** ISO timestamp; the token stops working after this. */
  expires_at: string
}

/**
 * 👉 Your turn — implement this function.
 *
 * Hit `POST /files/view-token` with the file path in the JSON body and the
 * user's auth token in the Authorization header. The response shape is
 * `ViewToken` (above).
 *
 * Look at how `createFolder` in `./files.ts` calls `apiJson` for a working
 * template — it's almost the exact same shape.
 *
 * The body should be `{ path }`.
 */
export async function requestViewToken(
  path: string,
  authToken: string,
): Promise<ViewToken> {
  void path
  void authToken
  void apiJson

  return apiJson<ViewToken>('/files/view-token', {
    method: 'POST',
    body: { path },
    token: authToken,
  })
}


/**
 * Build the absolute URL that `<video src=...>` will load. The token is the
 * only credential — no Authorization header is needed (and could not be
 * sent by a media tag anyway).
 */
export function viewUrlFromToken(token: string): string {
  return apiUrl(`/files/view?token=${encodeURIComponent(token)}`)
}
