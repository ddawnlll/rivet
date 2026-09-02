import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = process.env.VITE_API_URL || 'http://127.0.0.1:4096'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/event': { target, changeOrigin: true },
      '/session': { target, changeOrigin: true },
      '/provider': { target, changeOrigin: true },
      '/model': { target, changeOrigin: true },
      '/project': { target, changeOrigin: true },
      '/config': { target, changeOrigin: true },
      '/mcp': { target, changeOrigin: true },
      '/vcs': { target, changeOrigin: true },
      '/file': { target, changeOrigin: true },
      '/find': { target, changeOrigin: true },
      '/path': { target, changeOrigin: true },
      '/permission': { target, changeOrigin: true },
      '/pty': { target, ws: true, changeOrigin: true },
      '/health': { target, changeOrigin: true },
      '/global': { target, changeOrigin: true },
      '/app': { target, changeOrigin: true },
      '/api': { target, ws: true, changeOrigin: true },
    },
  },
})

