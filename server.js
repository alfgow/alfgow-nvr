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
  fs.mkdirSync(path.join(liveRoot, cameraId), { recursive: true })
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

app.get('/api/recordings/:cameraId/download', async (req, res) => {
  const { cameraId } = req.params
  if (!cameraIds.includes(cameraId)) {
    res.status(404).json({ error: 'Camera not found' })
    return
  }

  const startMs = Date.parse(String(req.query.start ?? ''))
  const endMs = Date.parse(String(req.query.end ?? ''))
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    res.status(400).json({ error: 'Invalid clip range' })
    return
  }

  try {
    const cameraRoot = path.resolve(recordingsRoot, cameraId)
    const manifest = await fs.promises.readFile(path.join(cameraRoot, 'index.m3u8'), 'utf8')
    const segments = selectSegmentsForRange(parseHlsSegments(manifest), startMs, endMs)

    if (!segments.length) {
      res.status(404).json({ error: 'No segments found for selected range' })
      return
    }

    const filePaths = segments.map((segment) => getSegmentFilePath(cameraRoot, segment.uri))
    if (filePaths.some((filePath) => !filePath)) {
      res.status(400).json({ error: 'Invalid segment path' })
      return
    }

    const stats = await Promise.all(filePaths.map((filePath) => fs.promises.stat(filePath)))
    const totalBytes = stats.reduce((total, stat) => total + stat.size, 0)
    const filename = buildClipFilename(cameraId, startMs, endMs)

    res.setHeader('Content-Type', 'video/mp2t')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Length', String(totalBytes))
    res.setHeader('Cache-Control', 'no-store')

    await streamSegmentFiles(filePaths, res)
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error)
      return
    }

    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Recording segment not found' })
      return
    }

    res.status(500).json({ error: 'Unable to create clip download' })
  }
})

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
        uri: line.trim(),
        duration: Number.isFinite(duration) ? duration : 0,
        programDateTime,
      })
      duration = null
      programDateTime = null
    }
  }

  return segments.filter((segment) => segment.programDateTime)
}

function selectSegmentsForRange(segments, startMs, endMs) {
  return segments.filter((segment) => {
    const segmentStart = new Date(segment.programDateTime).getTime()
    if (!Number.isFinite(segmentStart)) return false

    const segmentEnd = segmentStart + segment.duration * 1000
    return segmentEnd > startMs && segmentStart < endMs
  })
}

function getSegmentFilePath(cameraRoot, uri) {
  const segmentPath = path.resolve(cameraRoot, uri)
  if (segmentPath !== cameraRoot && !segmentPath.startsWith(`${cameraRoot}${path.sep}`)) {
    return null
  }

  return segmentPath
}

function buildClipFilename(cameraId, startMs, endMs) {
  const start = new Date(startMs).toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const end = new Date(endMs).toISOString().replaceAll(':', '-').replaceAll('.', '-')
  return `${cameraId}-${start}_${end}.ts`
}

async function streamSegmentFiles(filePaths, res) {
  for (const filePath of filePaths) {
    if (res.destroyed) return
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath)
      stream.on('error', reject)
      stream.on('end', resolve)
      stream.pipe(res, { end: false })
    })
  }

  if (!res.destroyed) res.end()
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
