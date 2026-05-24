import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          hls: ['hls.js'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  base: '/',
  server: {
    proxy: {
      '/live': 'http://localhost:5000',
    },
  },
})
