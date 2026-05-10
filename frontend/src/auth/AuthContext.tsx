import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ApiRequestError, apiJson, onUnauthorized } from '../api/client'

const STORAGE_KEY = 'pithos_auth_token'

type LoginResponse = {
  success: boolean
  message: string
  access_token?: string | null
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
  register: (
    username: string,
    password: string,
    email: string,
  ) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

// `remember` chooses persistence scope: localStorage survives browser
// restarts, sessionStorage clears when the last tab closes. We always
// write to one and clear the other so a stale token can't linger.
function readStoredToken(): string | null {
  try {
    return (
      localStorage.getItem(STORAGE_KEY) ??
      sessionStorage.getItem(STORAGE_KEY)
    )
  } catch {
    return null
  }
}

function persistToken(token: string | null, remember: boolean = true): void {
  try {
    if (token) {
      const target = remember ? localStorage : sessionStorage
      const other = remember ? sessionStorage : localStorage
      target.setItem(STORAGE_KEY, token)
      other.removeItem(STORAGE_KEY)
    } else {
      localStorage.removeItem(STORAGE_KEY)
      sessionStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    /* ignore quota / private mode */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [token, setToken] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)

  const refreshUser = useCallback(async (t: string) => {
    const me = await apiJson<MeResponse>('/auth/me', { token: t })
    setUsername(me.username)
    setStatus('authenticated')
  }, [])

  useEffect(() => {
    const stored = readStoredToken()
    if (!stored) {
      setStatus('anonymous')
      return
    }
    setToken(stored)
    ;(async () => {
      try {
        await refreshUser(stored)
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) {
          persistToken(null)
          setToken(null)
          setUsername(null)
          setStatus('anonymous')
        } else {
          persistToken(null)
          setToken(null)
          setUsername(null)
          setStatus('anonymous')
        }
      }
    })()
  }, [refreshUser])

  const login = useCallback(
    async (user: string, password: string, remember: boolean = true) => {
      const res = await apiJson<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { username: user, password },
      })
      if (!res.success || !res.access_token) {
        throw new ApiRequestError(res.message || 'Login failed', 401, res)
      }
      persistToken(res.access_token, remember)
      setToken(res.access_token)
      await refreshUser(res.access_token)
    },
    [refreshUser],
  )

  const register = useCallback(
    async (user: string, password: string, email: string) => {
      await apiJson<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: { username: user, password, email },
      })
      await login(user, password, true)
    },
    [login],
  )

  const logout = useCallback(async () => {
    const t = readStoredToken()
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
    persistToken(null)
    setToken(null)
    setUsername(null)
    setStatus('anonymous')
  }, [])

  // Any token-bearing API call that returns 401 means our session is stale
  // (token expired or revoked). Drop the session locally so ProtectedRoute
  // bounces the user to /login instead of leaving them on a broken page.
  useEffect(() => {
    return onUnauthorized(() => {
      persistToken(null)
      setToken(null)
      setUsername(null)
      setStatus('anonymous')
    })
  }, [])

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
