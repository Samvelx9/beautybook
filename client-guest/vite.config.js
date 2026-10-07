import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The API decides whose booking page this is from the host, so in development
// the guest app is opened on <slug>.localhost:5173 (browsers resolve any
// *.localhost to this machine) and /api is proxied with that Host kept.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: ['.localhost'],
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
})
