import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 5000

app.use(express.static(path.join(__dirname, 'dist')))

app.use('/live', express.static('/mnt/storage-alfgow/alfgow-nvr/live', {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.setHeader('Cache-Control', 'no-cache')
    }

    if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t')
      res.setHeader('Cache-Control', 'no-cache')
    }
  }
}))

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Alfgow NVR running on http://0.0.0.0:${PORT}`)
})
