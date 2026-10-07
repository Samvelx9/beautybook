import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The platform's own app — welcome page, sign-up and every master's admin
// panel — served at the root of app.<PLATFORM_DOMAIN> (and the bare domain).
// /api is same-origin: nginx forwards it in production, this proxy in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target: 'http://localhost:4000' } },
  },
})
