import './App.css'
import { Link, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { GuestRoute } from './auth/GuestRoute'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { Register } from './pages/Register'

function Layout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  )
}

function AppHome() {
  const { username, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <main className="mx-auto min-h-full w-full max-w-4xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-secondary pb-6">
        <div>
          <h1 className="text-2xl font-medium text-primary-text">
            Cloud File Storage
          </h1>
          <p className="mt-1 text-secondary-text">
            Signed in as{' '}
            <span className="font-medium text-primary-text">
              {username ?? '—'}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/"
            className="text-sm text-secondary-text underline-offset-4 hover:text-accent hover:underline"
          >
            Home
          </Link>
          <button
            type="button"
            className="rounded-md border border-secondary bg-background px-4 py-2 text-sm font-medium text-primary-text transition hover:border-accent hover:text-accent"
            onClick={() => {
              void logout().then(() => navigate('/', { replace: true }))
            }}
          >
            Log out
          </button>
        </div>
      </div>
      <p className="mt-8 text-secondary-text">Your workspace is ready.</p>
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <AppHome />
            </ProtectedRoute>
          }
        />
        <Route
          path="/login"
          element={
            <GuestRoute>
              <Login />
            </GuestRoute>
          }
        />
        <Route
          path="/register"
          element={
            <GuestRoute>
              <Register />
            </GuestRoute>
          }
        />
      </Route>
    </Routes>
  )
}

export default App
