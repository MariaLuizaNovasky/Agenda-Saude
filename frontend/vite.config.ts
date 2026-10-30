import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Em desenvolvimento, as chamadas /api vão para o backend (porta 3000)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
})