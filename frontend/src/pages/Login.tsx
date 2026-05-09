import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { HeroPageShell } from '../components/HeroPageShell'
import { PasswordField } from '../components/PasswordField'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from
      ?.pathname ?? '/app'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username.trim(), password, remember)
      navigate(from, { replace: true })
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setError('Invalid credentials')
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Something went wrong')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <HeroPageShell>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">
          Secure cloud storage
        </p>
        <Link
          to="/"
          className="shrink-0 text-sm text-secondary-text underline-offset-4 hover:text-accent hover:underline"
        >
          Home
        </Link>
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-primary-text">
        Log in
      </h1>

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
        {error ? (
          <p
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        <div>
          <label
            htmlFor="login-username"
            className="block text-sm font-medium text-primary-text"
          >
            Username
          </label>
          <input
            id="login-username"
            name="username"
            autoComplete="username"
            required
            minLength={1}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-md border border-secondary bg-background/80 px-3 py-2 text-primary-text shadow-sm outline-none backdrop-blur-sm focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <PasswordField
          id="login-password"
          label="Password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
          minLength={1}
        />
        <label className="flex items-center gap-2 text-sm text-primary-text">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-secondary text-accent-bg focus:ring-2 focus:ring-accent/20"
          />
          Remember me on this device
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent-bg px-4 py-2.5 text-sm font-medium text-accent-text shadow-md transition hover:bg-accent-border disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-secondary-text">
        Don&apos;t have an account?{' '}
        <Link
          to="/register"
          className="font-medium text-primary-text underline underline-offset-2 hover:text-accent"
        >
          Register
        </Link>
      </p>
    </HeroPageShell>
  )
}
