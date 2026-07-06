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
const recordingWindowMs = 48 * 60 * 60 * 1000
const recordingWindowSeconds = recordingWindowMs / 1000

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
    const segments = selectSegmentsForRange(await readRecordingSegments(cameraId), startMs, endMs)

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

app.get('/api/recordings/:cameraId/playlist.m3u8', async (req, res) => {
  const { cameraId } = req.params
  if (!cameraIds.includes(cameraId)) {
    res.status(404).send('Camera not found')
    return
  }

  try {
    const segments = await readRecordingSegments(cameraId)
    if (!segments.length) {
      res.status(404).send('No recordings found')
      return
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.setHeader('Cache-Control', 'no-cache')
    res.send(buildVodPlaylist(cameraId, segments))
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).send('No recordings found')
      return
    }

    res.status(500).send('Unable to build recording playlist')
  }
})

app.get('/api/recordings/:cameraId', async (req, res) => {
  const { cameraId } = req.params
  if (!cameraIds.includes(cameraId)) {
    res.status(404).json({ available: false, error: 'Camera not found' })
    return
  }

  const playlistUrl = `/api/recordings/${cameraId}/playlist.m3u8`

  try {
    const segments = await readRecordingSegments(cameraId)

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

async function readRecordingSegments(cameraId) {
  const cameraRoot = path.join(recordingsRoot, cameraId)
  const manifestSegments = await readManifestSegments(cameraRoot)
  const manifestDurations = new Map(
    manifestSegments.map((segment) => [segment.uri, segment.duration]).filter(([, duration]) => duration > 0),
  )

  const files = await fs.promises.readdir(cameraRoot, { withFileTypes: true })
  const fileSegments = files
    .filter((entry) => entry.isFile())
    .map((entry) => parseSegmentFile(entry.name))
    .filter(Boolean)
    .sort((first, second) => first.sortKey.localeCompare(second.sortKey))

  if (!fileSegments.length) {
    return limitSegmentsToRetention(
      manifestSegments.sort((first, second) => Date.parse(first.programDateTime) - Date.parse(second.programDateTime)),
    )
  }

  return limitSegmentsToRetention(fileSegments.map((segment, index) => ({
    uri: segment.uri,
    duration: getIndexedSegmentDuration(segment, fileSegments[index + 1], manifestDurations),
    programDateTime: segment.programDateTime,
  })))
}

async function readManifestSegments(cameraRoot) {
  try {
    const manifest = await fs.promises.readFile(path.join(cameraRoot, 'index.m3u8'), 'utf8')
    return parseHlsSegments(manifest)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function parseSegmentFile(filename) {
  const match = filename.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.ts$/)
  if (!match) return null

  const [, year, month, day, hour, minute, second] = match
  return {
    uri: filename,
    programDateTime: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
    sortKey: `${year}${month}${day}${hour}${minute}${second}`,
  }
}

function getIndexedSegmentDuration(segment, nextSegment, manifestDurations) {
  const manifestDuration = manifestDurations.get(segment.uri)
  if (Number.isFinite(manifestDuration) && manifestDuration > 0) return manifestDuration

  if (nextSegment) {
    const diffSeconds = (Date.parse(nextSegment.programDateTime) - Date.parse(segment.programDateTime)) / 1000
    if (Number.isFinite(diffSeconds) && diffSeconds > 0 && diffSeconds <= 300) return diffSeconds
  }

  return 60
}

function limitSegmentsToRetention(segments) {
  if (!segments.length) return []

  const normalizedSegments = segments
    .map((segment) => ({
      ...segment,
      duration: Number.isFinite(Number(segment.duration)) && Number(segment.duration) > 0
        ? Number(segment.duration)
        : 60,
    }))
    .filter((segment) => Number.isFinite(Date.parse(segment.programDateTime)))

  if (!normalizedSegments.length) return []

  const newestEnd = normalizedSegments.reduce((latest, segment) => {
    const segmentStart = Date.parse(segment.programDateTime)
    if (!Number.isFinite(segmentStart)) return latest

    const segmentEnd = segmentStart + segment.duration * 1000
    return Math.max(latest, segmentEnd)
  }, 0)

  if (!Number.isFinite(newestEnd) || newestEnd <= 0) return normalizedSegments

  const cutoff = newestEnd - recordingWindowMs
  const windowSegments = normalizedSegments.filter((segment) => {
    const segmentStart = Date.parse(segment.programDateTime)
    if (!Number.isFinite(segmentStart)) return false

    return segmentStart >= cutoff && segmentStart <= newestEnd
  })

  return limitSegmentsByDuration(windowSegments, recordingWindowSeconds)
}

function limitSegmentsByDuration(segments, maxDurationSeconds) {
  const selected = []
  let duration = 0

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    const segmentDuration = Number(segment.duration) || 0
    if (selected.length && duration + segmentDuration > maxDurationSeconds) break

    selected.push(segment)
    duration += segmentDuration
  }

  return selected.reverse()
}

function buildVodPlaylist(cameraId, segments) {
  const targetDuration = Math.max(1, Math.ceil(Math.max(...segments.map((segment) => segment.duration || 0))))
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${targetDuration}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
  ]

  for (const segment of segments) {
    lines.push(`#EXT-X-PROGRAM-DATE-TIME:${segment.programDateTime}`)
    lines.push(`#EXTINF:${Number(segment.duration || 0).toFixed(3)},`)
    lines.push(`/recordings/${cameraId}/${encodeURI(segment.uri)}`)
  }

  lines.push('#EXT-X-ENDLIST')
  return `${lines.join('\n')}\n`
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

  return formatServerDateTime(new Date(start + segment.duration * 1000))
}

function formatServerDateTime(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  const second = String(date.getSeconds()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Alfgow NVR running on http://0.0.0.0:${PORT}`)
})
