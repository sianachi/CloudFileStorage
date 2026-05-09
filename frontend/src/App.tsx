import './App.css'
import { BrowserRouter, Routes, Route } from 'react-router-dom'

function Home() {
  return (
    <main className="min-h-[50vh] p-8">
      <h1 className="text-2xl font-medium text-neutral-900 dark:text-neutral-100">
        Cloud File Storage
      </h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">Home</p>
    </main>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
