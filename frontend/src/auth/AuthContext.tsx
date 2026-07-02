import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ApiRequestError,
  apiJson,
  onUnauthorized,
  setTokenRefresher,
} from '../api/client'

const STORAGE_KEY = 'pithos_auth_token'
const REFRESH_KEY = 'pithos_refresh_token'

type LoginResponse = {
  success: boolean
  message: string
  access_token?: string | null
  refresh_token?: string | null
  token_type?: string | null
}

type RegisterResponse = {
  success: boolean
  message: string
  username?: string | null
}

type MeResponse = {
  username: string
}

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

type AuthContextValue = {
  status: AuthStatus
  token: string | null
  username: string | null
  login: (
    username: string,
    password: string,
    remember?: boolean,
  ) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// `remember` chooses persistence scope: localStorage survives browser
// restarts, sessionStorage clears when the last tab closes. We always
// write to one and clear the other so a stale token can't linger.
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function persistOne(key: string, value: string | null, remember: boolean): void {
  try {
    if (value) {
      const target = remember ? localStorage : sessionStorage
      const other = remember ? sessionStorage : localStorage
      target.setItem(key, value)
      other.removeItem(key)
    } else {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
    }
  } catch {
    /* ignore quota / private mode */
  }
}

function persistTokens(
  access: string | null,
  refresh: string | null,
  remember: boolean = true,
): void {
  persistOne(STORAGE_KEY, access, remember)
  persistOne(REFRESH_KEY, refresh, remember)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)

  // Persistence scope chosen at login; refreshed tokens reuse the same scope.
  const rememberRef = useRef(true)
  // Dedupe concurrent refreshes: many in-flight requests can 401 at once, but
  // they should share a single /auth/refresh round-trip.
  const refreshInFlight = useRef<Promise<string | null> | null>(null)

  const clearSession = useCallback(() => {
    persistTokens(null, null)
    setToken(null)
    setUsername(null)
    setStatus('anonymous')
  }, [])

  const refreshUser = useCallback(async (t: string) => {
    const me = await apiJson<MeResponse>('/auth/me', { token: t })
    setUsername(me.username)
    setStatus('authenticated')
  }, [])

  // Exchange the stored refresh token for a new access token. Returns the new
  // access token (also persisted + set in state) or null if refresh failed.
  const doRefresh = useCallback(async (): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current
    const run = (async () => {
      const stored = readStored(REFRESH_KEY)
      if (!stored) return null
      try {
        const res = await apiJson<LoginResponse>('/auth/refresh', {
          method: 'POST',
          body: { refresh_token: stored },
        })
        if (!res.success || !res.access_token) return null
        persistTokens(
          res.access_token,
          res.refresh_token ?? null,
          rememberRef.current,
        )
        setToken(res.access_token)
        return res.access_token
      } catch {
        return null
      }
    })()
    refreshInFlight.current = run
    try {
      return await run
    } finally {
      refreshInFlight.current = null
    }
  }, [])

  // Make the refresher available to the API client for transparent retry.
  useEffect(() => {
    setTokenRefresher(doRefresh)
    return () => setTokenRefresher(null)
  }, [doRefresh])

  useEffect(() => {
    const stored = readStored(STORAGE_KEY)
    const storedRefresh = readStored(REFRESH_KEY)
    if (!stored && !storedRefresh) {
      setStatus('anonymous')
      return
    }
    if (stored) setToken(stored)
    ;(async () => {
      try {
        // If the access token is present, try it. apiJson will transparently
        // refresh-and-retry on 401 via the registered refresher.
        if (stored) {
          await refreshUser(stored)
          return
        }
        // No access token but we have a refresh token (e.g. access expired
        // while the tab was closed) — mint a fresh one, then load the user.
        const refreshed = await doRefresh()
        if (refreshed) {
          await refreshUser(refreshed)
        } else {
          clearSession()
        }
      } catch (e) {
        void e
        clearSession()
      }
    })()
  }, [refreshUser, doRefresh, clearSession])

  const login = useCallback(
    async (user: string, password: string, remember: boolean = true) => {
      const res = await apiJson<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { username: user, password },
      })
      if (!res.success || !res.access_token) {
        throw new ApiRequestError(res.message || 'Login failed', 401, res)
      }
      rememberRef.current = remember
      persistTokens(res.access_token, res.refresh_token ?? null, remember)
      setToken(res.access_token)
      await refreshUser(res.access_token)
    },
    [refreshUser],
  )

  const register = useCallback(
    async (user: string, password: string) => {
      await apiJson<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: { username: user, password },
      })
      await login(user, password, true)
    },
    [login],
  )

  const logout = useCallback(async () => {
    const t = readStored(STORAGE_KEY)
    if (t) {
      try {
        await apiJson<{ success: boolean }>('/auth/logout', {
          method: 'POST',
          token: t,
        })
      } catch {
        /* still clear client session */
      }
    }
    clearSession()
  }, [clearSession])

  // A 401 that survives a refresh attempt means the session is truly stale
  // (refresh token expired or revoked). Drop it so ProtectedRoute bounces the
  // user to /login instead of leaving them on a broken page.
  useEffect(() => {
    return onUnauthorized(() => {
      clearSession()
    })
  }, [clearSession])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      token,
      username,
      login,
      register,
      logout,
    }),
    [status, token, username, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
