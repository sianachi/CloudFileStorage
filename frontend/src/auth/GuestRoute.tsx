import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { HeroPageShell } from '../components/HeroPageShell'
import { useAuth } from './AuthContext'

export function GuestRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <HeroPageShell maxWidth="md" contentAlign="center">
        <p className="text-primary-text">Loading…</p>
      </HeroPageShell>
    )
  }

  if (status === 'authenticated') {
    return <Navigate to="/app" replace />
  }

  return <>{children}</>
}
