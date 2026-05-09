import { Link, useNavigate } from 'react-router-dom'
import { HeroPageShell } from '../components/HeroPageShell'
import { useAuth } from '../auth/AuthContext'

export function Landing() {
  const { status, username, logout } = useAuth()
  const navigate = useNavigate()

  if (status === 'loading') {
    return (
      <HeroPageShell maxWidth="md" contentAlign="center">
        <p className="text-primary-text">Loading…</p>
      </HeroPageShell>
    )
  }

  return (
    <HeroPageShell maxWidth="2xl" contentAlign="center">
      <p className="text-sm font-medium uppercase tracking-wide text-accent">
        Secure cloud storage
      </p>
      <h1 className="mt-4 text-balance text-4xl font-semibold tracking-tight text-primary-text sm:text-5xl">
        Your files, accessible anywhere
      </h1>
      <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-secondary-text">
        Upload, organize, and reach your documents from any device with a single
        account.
      </p>

      {status === 'authenticated' && username ? (
        <p className="mt-6 text-sm text-secondary-text">
          Welcome back,{' '}
          <span className="font-medium text-primary-text">{username}</span>
        </p>
      ) : null}

      <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-5">
        {status === 'authenticated' ? (
          <>
            <Link
              to="/app"
              className="inline-flex min-w-40 items-center justify-center rounded-md bg-accent-bg px-6 py-3 text-sm font-medium text-accent-text shadow-md transition hover:bg-accent-border"
            >
              Open app
            </Link>
            <button
              type="button"
              className="inline-flex min-w-40 items-center justify-center rounded-md border border-secondary bg-background px-6 py-3 text-sm font-medium text-primary-text shadow-sm transition hover:border-accent hover:text-accent"
              onClick={() => {
                void logout().then(() => navigate('/', { replace: true }))
              }}
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link
              to="/register"
              className="inline-flex min-w-40 items-center justify-center rounded-md bg-accent-bg px-6 py-3 text-sm font-medium text-accent-text shadow-md transition hover:bg-accent-border"
            >
              Get started
            </Link>
            <Link
              to="/login"
              className="inline-flex min-w-40 items-center justify-center rounded-md border border-secondary bg-background px-6 py-3 text-sm font-medium text-primary-text shadow-sm transition hover:border-accent hover:text-accent"
            >
              Log in
            </Link>
          </>
        )}
      </div>
    </HeroPageShell>
  )
}
