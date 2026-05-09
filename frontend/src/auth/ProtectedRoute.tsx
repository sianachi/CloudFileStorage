import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-secondary-text">
        Loading…
      </div>
    )
  }

  if (status !== 'authenticated') {
    return (
      <Navigate to="/login" replace state={{ from: location }} />
    )
  }

  return <>{children}</>
}
