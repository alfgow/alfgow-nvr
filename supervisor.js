import fs from 'fs/promises'
import path from 'path'

const storageRoot = process.env.SUPERVISOR_STORAGE_ROOT ?? '/mnt/storage-alfgow/alfgow-nvr'
const baseUrl = new URL(process.env.SUPERVISOR_BASE_URL ?? 'http://alfgow-nvr:5000')
const statePath = process.env.SUPERVISOR_STATE_PATH ?? path.join(storageRoot, '.supervisor-state.json')

const checkIntervalSeconds = readInt(process.env.SUPERVISOR_CHECK_INTERVAL_SECONDS, 30)
const startupGraceSeconds = readInt(process.env.SUPERVISOR_STARTUP_GRACE_SECONDS, 90)
const liveStaleSeconds = readInt(process.env.SUPERVISOR_LIVE_STALE_SECONDS, 20)
const failureThreshold = readInt(process.env.SUPERVISOR_FAILURE_THRESHOLD, 2)
const fetchTimeoutSeconds = readInt(process.env.SUPERVISOR_FETCH_TIMEOUT_SECONDS, 8)

const cameras = [
  { id: 'cam1', name: 'Entrada Principal' },
  { id: 'cam2', name: 'Estacionamiento' },
  { id: 'cam3', name: 'Habitación 2' },
  { id: 'cam4', name: 'Sala' },
]

const state = await loadState()
pruneRecordingState(state)
const processStartedAt = Date.now()
let running = false
let stopping = false
let timer = null

console.log(`Supervisor started for ${baseUrl.toString()} with storage ${storageRoot}`)

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
  console.log('Telegram alerts are disabled because TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing')
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

scheduleNextRun(0)

async function shutdown() {
  stopping = true
  if (timer) clearTimeout(timer)
  console.log('Supervisor shutting down')
  process.exit(0)
}

function scheduleNextRun(delayMs) {
  if (stopping) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void runCycle()
  }, delayMs)
}

async function runCycle() {
  if (running || stopping) {
    scheduleNextRun(checkIntervalSeconds * 1000)
    return
  }

  running = true
  const issues = []

  try {
    issues.push(...(await probeApi()))
    issues.push(...(await probeHttpLive()))

    for (const camera of cameras) {
      issues.push(...(await probePlaylist(camera, path.join(storageRoot, 'live', camera.id, 'index.m3u8'), liveStaleSeconds)))
    }

    const { alerts, recoveries } = applyIssues(issues)
    await persistState()

    if (alerts.length || recoveries.length) {
      const message = formatTelegramMessage(alerts, recoveries)
      if (alerts.length) {
        console.log(`Supervisor alerts: ${alerts.map((issue) => issue.key).join(', ')}`)
      }
      if (recoveries.length) {
        console.log(`Supervisor recoveries: ${recoveries.map((issue) => issue.key).join(', ')}`)
      }
      await sendTelegram(message)
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Supervisor cycle failed`, error)
  } finally {
    running = false
    if (!stopping) scheduleNextRun(checkIntervalSeconds * 1000)
  }
}

async function probeApi() {
  const url = new URL('/api/recordings/cam1', baseUrl)
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(fetchTimeoutSeconds * 1000),
      headers: { accept: 'application/json' },
    })

    if (!response.ok) {
      return [buildIssue('api', 'NVR API responded with HTTP error', `GET ${url.pathname} returned ${response.status}`)]
    }

    await response.text()
    return []
  } catch (error) {
    return [buildIssue('api', 'NVR API unreachable', `${url.toString()} failed: ${describeError(error)}`)]
  }
}

async function probeHttpLive() {
  const url = new URL('/live/cam1/index.m3u8', baseUrl)
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(fetchTimeoutSeconds * 1000),
      headers: { accept: 'application/vnd.apple.mpegurl' },
    })

    if (!response.ok) {
      return [buildIssue('http-live', 'Live playlist endpoint returned HTTP error', `GET ${url.pathname} returned ${response.status}`)]
    }

    const text = await response.text()
    if (!text.includes('#EXTM3U')) {
      return [buildIssue('http-live', 'Live playlist endpoint returned invalid content', `${url.pathname} does not look like an HLS playlist`)]
    }

    return []
  } catch (error) {
    return [buildIssue('http-live', 'Live playlist endpoint unreachable', `${url.toString()} failed: ${describeError(error)}`)]
  }
}

async function probePlaylist(camera, manifestPath, staleSeconds) {
  const keyPrefix = `live:${camera.id}`

  try {
    const manifest = await fs.readFile(manifestPath, 'utf8')
    const manifestStat = await fs.stat(manifestPath)
    const parsed = parseManifest(manifest)

    if (!Number.isFinite(parsed.targetDuration) || parsed.targetDuration <= 0) {
      return [buildIssue(`${keyPrefix}:targetduration`, 'La cámara no está generando un HLS válido', 'El playlist en vivo tiene una duración inválida')]
    }

    if (!parsed.segments.length) {
      return [buildIssue(`${keyPrefix}:empty`, 'La cámara no está enviando video', 'El playlist en vivo no tiene segmentos')]
    }

    const lastSegment = parsed.segments.at(-1)
    const manifestAgeSeconds = ageSeconds(manifestStat.mtimeMs)
    let segmentAgeSeconds = null

    if (lastSegment?.uri) {
      const segmentPath = path.resolve(path.dirname(manifestPath), lastSegment.uri)
      const segmentStat = await fs.stat(segmentPath)
      segmentAgeSeconds = ageSeconds(segmentStat.mtimeMs)
    }

    const isStale = manifestAgeSeconds > staleSeconds || (segmentAgeSeconds != null && segmentAgeSeconds > staleSeconds)
    if (isStale) {
      return [
        buildIssue(
          `${keyPrefix}:stale`,
          'La cámara dejó de actualizar el video',
          `Sin cambios hace ${formatSeconds(manifestAgeSeconds)}${segmentAgeSeconds == null ? '' : `; segmento hace ${formatSeconds(segmentAgeSeconds)}`}`,
        ),
      ]
    }

    return []
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [buildIssue(`${keyPrefix}:missing`, 'No aparece el video en vivo', 'El playlist en vivo no existe')]
    }

    return [buildIssue(`${keyPrefix}:error`, 'No se pudo revisar el video en vivo', describeError(error))]
  }
}

function parseManifest(manifest) {
  const lines = manifest.split(/\r?\n/)
  const segments = []
  let targetDuration = null

  for (const line of lines) {
    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Number.parseFloat(line.replace('#EXT-X-TARGETDURATION:', '').trim())
      continue
    }

    if (line && !line.startsWith('#')) {
      segments.push({ uri: line.trim() })
    }
  }

  return { targetDuration, segments }
}

function buildIssue(key, title, detail) {
  return {
    key,
    title,
    detail,
  }
}

function applyIssues(issues) {
  const incoming = new Map()
  for (const issue of issues) {
    if (!issue?.key) continue
    incoming.set(issue.key, issue)
  }

  const alerts = []
  const recoveries = []

  for (const [key, issue] of incoming.entries()) {
    const current = state.issues[key] ?? {
      consecutiveFailures: 0,
      alerted: false,
      lastStatus: 'healthy',
      lastSeenAt: null,
      lastAlertAt: null,
      lastRecoveryAt: null,
      lastDetail: null,
      title: issue.title,
    }

    current.title = issue.title
    current.lastDetail = issue.detail
    current.lastSeenAt = new Date().toISOString()

    if (Date.now() - processStartedAt < startupGraceSeconds * 1000) {
      current.consecutiveFailures = Math.max(current.consecutiveFailures, 1)
      current.lastStatus = 'unhealthy'
      state.issues[key] = current
      continue
    }

    current.consecutiveFailures += 1
    current.lastStatus = 'unhealthy'

    if (!current.alerted && current.consecutiveFailures >= failureThreshold) {
      current.alerted = true
      current.lastAlertAt = new Date().toISOString()
      alerts.push({
        key,
        title: issue.title,
        detail: issue.detail,
      })
    }

    state.issues[key] = current
  }

  for (const [key, current] of Object.entries(state.issues)) {
    if (incoming.has(key)) continue
    if (current.lastStatus === 'healthy') continue

    current.consecutiveFailures = 0
    current.lastStatus = 'healthy'
    current.lastDetail = null
    current.lastRecoveryAt = new Date().toISOString()

    if (current.alerted) {
      current.alerted = false
      recoveries.push({
        key,
        title: current.title ?? key,
      })
    }
  }

  return { alerts, recoveries }
}

async function loadState() {
  try {
    const raw = await fs.readFile(statePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid state')
    if (!parsed.issues || typeof parsed.issues !== 'object') parsed.issues = {}
    return parsed
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(`Could not read supervisor state at ${statePath}; starting fresh`, error)
    }

    return { issues: {} }
  }
}

function pruneRecordingState(currentState) {
  if (!currentState?.issues) return
  for (const key of Object.keys(currentState.issues)) {
    if (key.startsWith('recording:')) {
      delete currentState.issues[key]
    }
  }
}

async function persistState() {
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  const tempPath = `${statePath}.tmp`
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8')
  await fs.rename(tempPath, statePath)
}

function formatTelegramMessage(alerts, recoveries) {
  const timestamp = formatTelegramTimestamp(new Date())
  const lines = []

  if (alerts.length) {
    lines.push('<b>🚨 Alerta NVR</b>')
    lines.push(`🕒 ${timestamp}`)
    lines.push('⚠️ Se detectó un problema en el video en vivo:')
    lines.push(...groupIssuesByCamera(alerts).map(formatAlertGroup))
  }

  if (recoveries.length) {
    if (lines.length) lines.push('')
    lines.push('<b>✅ NVR recuperado</b>')
    lines.push(`🕒 ${timestamp}`)
    lines.push('🟢 El video en vivo volvió a la normalidad:')
    lines.push(...groupIssuesByCamera(recoveries).map(formatRecoveryGroup))
  }

  return lines.join('\n')
}

async function sendTelegram(message) {
  if (!message) return

  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const endpoint = `https://api.telegram.org/bot${token}/sendMessage`
  const body = new URLSearchParams({
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: 'true',
  })

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(fetchTimeoutSeconds * 1000),
    })

    if (!response.ok) {
      const responseText = await response.text()
      console.error(`Telegram sendMessage failed with HTTP ${response.status}: ${responseText}`)
    } else {
      console.log('Telegram notification sent')
    }
  } catch (error) {
    console.error('Telegram notification failed', error)
  }
}

function readInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function ageSeconds(mtimeMs) {
  return (Date.now() - mtimeMs) / 1000
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) return 'unknown'
  const seconds = Math.round(value)
  if (seconds < 60) return `${seconds} s`

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds ? `${minutes} min ${remainingSeconds} s` : `${minutes} min`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes ? `${hours} h ${remainingMinutes} min` : `${hours} h`
}

function describeError(error) {
  if (!error) return 'unknown error'
  return error?.cause?.message || error?.message || String(error)
}

function formatTelegramTimestamp(date) {
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function formatAlertLine(issue) {
  const { cameraId } = parseIssueKey(issue.key)
  const cameraName = cameraLabel(cameraId)
  return `• ${escapeHtml(cameraName)}: ${escapeHtml(issue.title)}`
}

function formatRecoveryLine(issue) {
  const { cameraId } = parseIssueKey(issue.key)
  const cameraName = cameraLabel(cameraId)
  return `• ${escapeHtml(cameraName)}: volvió a la normalidad`
}

function groupIssuesByCamera(issues) {
  const grouped = new Map()
  for (const issue of issues) {
    const { cameraId } = parseIssueKey(issue.key)
    const groupKey = cameraId ?? 'system'
    const existing = grouped.get(groupKey) ?? []
    existing.push(issue)
    grouped.set(groupKey, existing)
  }

  return [...grouped.entries()].map(([cameraId, items]) => ({
    cameraId: cameraId === 'system' ? null : cameraId,
    items,
  }))
}

function formatAlertGroup(group) {
  const cameraName = cameraLabel(group.cameraId)
  const count = group.items.length
  const issue = group.items[0]
  const suffix = count > 1 ? ` (+${count - 1} más)` : ''
  return `• 📡 ${escapeHtml(cameraName)}: ${escapeHtml(issue.title)}${suffix}`
}

function formatRecoveryGroup(group) {
  const cameraName = cameraLabel(group.cameraId)
  return `• ✅ ${escapeHtml(cameraName)}: recuperado`
}

function parseIssueKey(key) {
  const [kind = 'system', cameraId = null] = String(key).split(':')
  return { kind, cameraId }
}

function cameraLabel(cameraId) {
  const camera = cameras.find((entry) => entry.id === cameraId)
  if (camera) return camera.name
  if (!cameraId) return 'General'
  return cameraId
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
