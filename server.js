import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 5000
const storageRoot = '/mnt/storage-alfgow/alfgow-nvr'
const liveRoot = path.join(storageRoot, 'live')
const recordingsRoot = path.join(storageRoot, 'recordings')
const cameraIds = ['cam1', 'cam2', 'cam3', 'cam4']

for (const cameraId of cameraIds) {
  fs.mkdirSync(path.join(recordingsRoot, cameraId), { recursive: true })
}

app.use(express.static(path.join(__dirname, 'dist')))

app.use('/live', express.static(liveRoot, {
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

app.use('/recordings', express.static(recordingsRoot, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
      res.setHeader('Cache-Control', 'no-cache')
    }

    if (filePath.endsWith('.ts')) {
      res.setHeader('Content-Type', 'video/mp2t')
      res.setHeader('Cache-Control', 'public, max-age=3600')
    }
  }
}))

app.get('/api/recordings/:cameraId', async (req, res) => {
  const { cameraId } = req.params
  if (!cameraIds.includes(cameraId)) {
    res.status(404).json({ available: false, error: 'Camera not found' })
    return
  }

  const manifestPath = path.join(recordingsRoot, cameraId, 'index.m3u8')
  const playlistUrl = `/recordings/${cameraId}/index.m3u8`

  try {
    const manifest = await fs.promises.readFile(manifestPath, 'utf8')
    const segments = parseHlsSegments(manifest)

    res.json({
      available: segments.length > 0,
      cameraId,
      playlistUrl,
      startTime: segments[0]?.programDateTime ?? null,
      endTime: getSegmentEndTime(segments.at(-1)),
      segments,
    })
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.json({
        available: false,
        cameraId,
        playlistUrl,
        startTime: null,
        endTime: null,
        segments: [],
      })
      return
    }

    res.status(500).json({ available: false, error: 'Unable to read recordings' })
  }
})

function parseHlsSegments(manifest) {
  const lines = manifest.split(/\r?\n/)
  const segments = []
  let duration = null
  let programDateTime = null

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      duration = Number.parseFloat(line.replace('#EXTINF:', '').split(',')[0])
      continue
    }

    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      programDateTime = line.replace('#EXT-X-PROGRAM-DATE-TIME:', '').trim()
      continue
    }

    if (line && !line.startsWith('#')) {
      segments.push({
        uri: line,
        duration: Number.isFinite(duration) ? duration : 0,
        programDateTime,
      })
      duration = null
      programDateTime = null
    }
  }

  return segments.filter((segment) => segment.programDateTime)
}

function getSegmentEndTime(segment) {
  if (!segment?.programDateTime) return null

  const start = new Date(segment.programDateTime).getTime()
  if (!Number.isFinite(start)) return null

  return new Date(start + segment.duration * 1000).toISOString()
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Alfgow NVR running on http://0.0.0.0:${PORT}`)
})
