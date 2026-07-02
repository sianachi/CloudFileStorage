import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  server: {
    proxy: {
      '/auth': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/files': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/folders': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/quota': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/trash': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/shares': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/public': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/healthz': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
