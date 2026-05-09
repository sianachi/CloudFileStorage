import './App.css'
import { Outlet, Route, Routes } from 'react-router-dom'
import { GuestRoute } from './auth/GuestRoute'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { Portal } from './pages/portal/portal'
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

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Landing />} />
        <Route
          path="/app/*"
          element={
            <ProtectedRoute>
              <Portal />
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
