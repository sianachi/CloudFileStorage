import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ApiRequestError, apiJson } from '../api/client'

const STORAGE_KEY = 'cloud_file_storage_auth_token'

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
  login: (username: string, password: string) => Promise<void>
  register: (
    username: string,
    password: string,
    email: string,
  ) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function persistToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token)
    } else {
      localStorage.removeItem(STORAGE_KEY)
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

  const login = useCallback(async (user: string, password: string) => {
    const res = await apiJson<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username: user, password },
    })
    if (!res.success || !res.access_token) {
      throw new ApiRequestError(
        res.message || 'Login failed',
        401,
        res,
      )
    }
    persistToken(res.access_token)
    setToken(res.access_token)
    await refreshUser(res.access_token)
  }, [refreshUser])

  const register = useCallback(
    async (user: string, password: string, email: string) => {
      await apiJson<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: { username: user, password, email },
      })
      await login(user, password)
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
