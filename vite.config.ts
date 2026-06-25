// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const pfxPath = path.resolve(process.cwd(), 'cert.pfx')
const httpsConfig = fs.existsSync(pfxPath) 
  ? { pfx: fs.readFileSync(pfxPath), passphrase: 'SitaPassword123' }
  : undefined

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Penting agar file bisa dibaca di hosting statis (Netlify/Vercel)
  server: {
    https: httpsConfig,
    host: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false
  }
})

