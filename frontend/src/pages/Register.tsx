import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiRequestError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { HeroPageShell } from '../components/HeroPageShell'

function formatRegisterError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 409) {
      return typeof err.message === 'string' ? err.message : 'User already exists'
    }
    return err.message
  }
  if (err instanceof Error) {
    return err.message
  }
  return 'Something went wrong'
}

export function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register(username.trim(), password, email.trim())
      navigate('/app', { replace: true })
    } catch (err) {
      setError(formatRegisterError(err))
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
        Register
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
            htmlFor="register-username"
            className="block text-sm font-medium text-primary-text"
          >
            Username
          </label>
          <input
            id="register-username"
            name="username"
            autoComplete="username"
            required
            minLength={1}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-md border border-secondary bg-background/80 px-3 py-2 text-primary-text shadow-sm outline-none backdrop-blur-sm focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div>
          <label
            htmlFor="register-email"
            className="block text-sm font-medium text-primary-text"
          >
            Email
          </label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            minLength={3}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-secondary bg-background/80 px-3 py-2 text-primary-text shadow-sm outline-none backdrop-blur-sm focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <div>
          <label
            htmlFor="register-password"
            className="block text-sm font-medium text-primary-text"
          >
            Password
          </label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-secondary bg-background/80 px-3 py-2 text-primary-text shadow-sm outline-none backdrop-blur-sm focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-accent-bg px-4 py-2.5 text-sm font-medium text-accent-text shadow-md transition hover:bg-accent-border disabled:opacity-50"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-secondary-text">
        Already have an account?{' '}
        <Link
          to="/login"
          className="font-medium text-primary-text underline underline-offset-2 hover:text-accent"
        >
          Log in
        </Link>
      </p>
    </HeroPageShell>
  )
}
