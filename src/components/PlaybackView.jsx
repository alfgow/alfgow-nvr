import { useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'

function formatDateTimeLocal(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return offsetDate.toISOString().slice(0, 16)
}

function formatDateTimeQuery(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return offsetDate.toISOString().slice(0, 19)
}

function formatRangeDate(value) {
  if (!value) return 'Sin datos'

  return new Date(value).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(value) {
  const totalSeconds = Math.max(Math.round(value), 0)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours) return `${hours} h ${minutes ? `${minutes} min` : ''}`.trim()
  if (minutes) return `${minutes} min${seconds ? ` ${seconds} s` : ''}`
  return `${seconds} s`
}

const playbackWindowSeconds = 48 * 60 * 60
const defaultClipDurationSeconds = 5 * 60

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizeSegment(segment = {}) {
  const duration = Number(segment.duration)

  return {
    ...segment,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 60,
  }
}

function getSegmentStartMs(segment) {
  return Date.parse(segment?.programDateTime)
}

function getSegmentEndMs(segment) {
  const start = getSegmentStartMs(segment)
  if (!Number.isFinite(start)) return Number.NaN

  return start + normalizeSegment(segment).duration * 1000
}

function limitSegmentsByDuration(segments, maxDurationSeconds) {
  const selected = []
  let duration = 0

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (selected.length && duration + segment.duration > maxDurationSeconds) break

    selected.push(segment)
    duration += segment.duration
  }

  return selected.reverse()
}

function limitRecordingDataToPlaybackWindow(data) {
  const segments = Array.isArray(data.segments)
    ? data.segments
      .map(normalizeSegment)
      .filter((segment) => Number.isFinite(getSegmentStartMs(segment)))
      .sort((first, second) => getSegmentStartMs(first) - getSegmentStartMs(second))
    : []

  if (!segments.length) {
    return {
      ...data,
      available: false,
      startTime: null,
      endTime: null,
      segments: [],
    }
  }

  const newestEnd = segments.reduce((latest, segment) => Math.max(latest, getSegmentEndMs(segment)), 0)
  const cutoff = newestEnd - playbackWindowSeconds * 1000
  const windowSegments = segments.filter((segment) => {
    const segmentStart = getSegmentStartMs(segment)
    return segmentStart >= cutoff && segmentStart <= newestEnd
  })
  const retainedSegments = limitSegmentsByDuration(windowSegments, playbackWindowSeconds)
  const lastSegment = retainedSegments.at(-1)

  return {
    ...data,
    available: retainedSegments.length > 0,
    startTime: retainedSegments[0]?.programDateTime ?? null,
    endTime: lastSegment ? formatDateTimeQuery(new Date(getSegmentEndMs(lastSegment))) : null,
    segments: retainedSegments,
  }
}

export default function PlaybackView({ cameras }) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const timelineSelectorRef = useRef(null)
  const [selectedCameraId, setSelectedCameraId] = useState(cameras[0]?.id)
  const [selectedDateTime, setSelectedDateTime] = useState(formatDateTimeLocal(new Date()))
  const [recording, setRecording] = useState({ loading: true, available: false, segments: [] })
  const [error, setError] = useState('')
  const [clipSelection, setClipSelection] = useState({ start: 0, end: 0 })
  const clipSelectionRef = useRef(clipSelection)

  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === selectedCameraId) ?? cameras[0],
    [cameras, selectedCameraId],
  )

  const totalDuration = useMemo(
    () => recording.segments?.reduce((total, segment) => total + segment.duration, 0) ?? 0,
    [recording.segments],
  )
  const timelineOffset = getTimelineOffset()

  useEffect(() => {
    clipSelectionRef.current = clipSelection
  }, [clipSelection])

  useEffect(() => {
    let cancelled = false

    async function loadRecording() {
      setRecording({ loading: true, available: false, segments: [] })
      setError('')

      try {
        const response = await fetch(`/api/recordings/${selectedCameraId}`)
        if (!response.ok) throw new Error('No se pudo consultar la grabación')
        if (!response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('No se pudo consultar la grabación')
        }
        const data = limitRecordingDataToPlaybackWindow(await response.json())
        if (!cancelled) setRecording({ loading: false, ...data })
      } catch (requestError) {
        if (!cancelled) {
          setRecording({ loading: false, available: false, segments: [] })
          setError(requestError.message)
        }
      }
    }

    loadRecording()
    return () => {
      cancelled = true
    }
  }, [selectedCameraId])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !recording.available || !recording.playlistUrl) {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      return
    }

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    const playlistSeparator = recording.playlistUrl.includes('?') ? '&' : '?'
    const playlistUrl = `${recording.playlistUrl}${playlistSeparator}window=48h&t=${Date.now()}`

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: false, backBufferLength: 120, maxBufferLength: 120 })
      hlsRef.current = hls
      hls.loadSource(playlistUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => seekToSelectedTime())
      video.addEventListener('loadedmetadata', seekToSelectedTime)
      return () => {
        video.removeEventListener('loadedmetadata', seekToSelectedTime)
        hls.destroy()
        if (hlsRef.current === hls) hlsRef.current = null
      }
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = playlistUrl
      video.addEventListener('loadedmetadata', seekToSelectedTime, { once: true })
      return () => video.removeEventListener('loadedmetadata', seekToSelectedTime)
    }
  }, [recording.available, recording.playlistUrl])

  useEffect(() => {
    seekToSelectedTime()
  }, [selectedDateTime, recording.startTime, totalDuration])

  useEffect(() => {
    if (!recording.available || !recording.startTime || !recording.endTime) return

    const clampedDateTime = clampPlaybackDateTime(selectedDateTime)
    if (clampedDateTime !== selectedDateTime) {
      setSelectedDateTime(clampedDateTime)
    }
  }, [recording.available, recording.startTime, recording.endTime, selectedDateTime])

  useEffect(() => {
    const duration = Math.max(Math.round(totalDuration), 0)
    if (!recording.available || duration <= 0) {
      applyClipSelection({ start: 0, end: 0 })
      return
    }

    const defaultDuration = Math.min(duration, defaultClipDurationSeconds)
    const selectedOffset = getOffsetSeconds(selectedDateTime)

    if (Number.isFinite(selectedOffset) && selectedOffset >= 0 && selectedOffset <= duration) {
      const start = clamp(selectedOffset, 0, Math.max(duration - defaultDuration, 0))
      applyClipSelection({ start, end: start + defaultDuration })
      return
    }

    applyClipSelection({ start: duration - defaultDuration, end: duration })
  }, [recording.available, recording.startTime, totalDuration])

  function seekToSelectedTime() {
    if (!recording.available || !selectedDateTime || totalDuration <= 0) return

    const offsetSeconds = getOffsetSeconds(selectedDateTime)
    if (Number.isFinite(offsetSeconds)) seekVideoToOffset(offsetSeconds)
  }

  function jumpToNow() {
    const value = formatDateTimeLocal(new Date())
    setPlaybackDateTime(value)
  }

  function jumpToYesterday() {
    const date = new Date()
    date.setDate(date.getDate() - 1)
    setPlaybackDateTime(formatDateTimeLocal(date))
  }

  function getTimelineOffset() {
    const offset = getOffsetSeconds(selectedDateTime)
    if (!Number.isFinite(offset)) return 0

    return clamp(offset, 0, Math.max(totalDuration, 1))
  }

  const segmentCount = recording.segments?.length ?? 0
  const selectedDisplayTime = selectedDateTime ? selectedDateTime.replace('T', ' ') : 'Sin fecha'
  const timelineMax = Math.max(Math.round(totalDuration), 1)
  const minClipDuration = recording.available ? Math.min(60, timelineMax) : 0
  const maxClipStart = Math.max(timelineMax - minClipDuration, 0)
  const clipStart = recording.available
    ? clamp(Math.round(clipSelection.start), 0, maxClipStart)
    : 0
  const clipEnd = recording.available
    ? clamp(Math.max(Math.round(clipSelection.end), clipStart + minClipDuration), minClipDuration, timelineMax)
    : 0
  const clipDuration = Math.max(clipEnd - clipStart, 0)
  const clipStartDate = getClipDate(clipStart)
  const clipEndDate = getClipDate(clipEnd)
  const canDownloadClip = Boolean(recording.available && clipStartDate && clipEndDate && clipEnd > clipStart)
  const clipDownloadUrl = canDownloadClip
    ? `/api/recordings/${selectedCameraId}/download?${new URLSearchParams({
      start: formatDateTimeQuery(clipStartDate),
      end: formatDateTimeQuery(clipEndDate),
    }).toString()}`
    : '#'
  const timelineSelectionStyle = {
    '--clip-start': `${(clipStart / timelineMax) * 100}%`,
    '--clip-width': `${((clipEnd - clipStart) / timelineMax) * 100}%`,
    '--timeline-playhead': `${(clamp(timelineOffset, 0, timelineMax) / timelineMax) * 100}%`,
  }

  function getClipDate(offsetSeconds) {
    return getDateForMediaOffset(offsetSeconds)
  }

  function getOffsetSeconds(value) {
    if (!recording.segments?.length || !value) return Number.NaN

    const target = new Date(value).getTime()
    if (!Number.isFinite(target)) return Number.NaN

    let elapsed = 0

    for (const segment of recording.segments) {
      const start = getSegmentStartMs(segment)
      const duration = Number(segment.duration) || 0
      if (!Number.isFinite(start) || duration <= 0) continue

      const end = start + duration * 1000
      if (target <= start) return elapsed
      if (target < end) return elapsed + (target - start) / 1000

      elapsed += duration
    }

    return clamp(elapsed, 0, Math.max(totalDuration, 0))
  }

  function getDateForMediaOffset(offsetSeconds) {
    if (!recording.segments?.length) return null

    const targetOffset = clamp(Number(offsetSeconds) || 0, 0, Math.max(totalDuration, 0))
    let elapsed = 0

    for (const segment of recording.segments) {
      const start = getSegmentStartMs(segment)
      const duration = Number(segment.duration) || 0
      if (!Number.isFinite(start) || duration <= 0) continue

      const nextElapsed = elapsed + duration
      if (targetOffset <= nextElapsed) {
        return new Date(start + clamp(targetOffset - elapsed, 0, duration) * 1000)
      }

      elapsed = nextElapsed
    }

    return recording.endTime ? new Date(recording.endTime) : null
  }

  function clampPlaybackDateTime(value) {
    if (!recording.startTime || !recording.endTime || !value) return value

    const target = Date.parse(value)
    const start = Date.parse(recording.startTime)
    const end = Date.parse(recording.endTime)
    if (!Number.isFinite(target) || !Number.isFinite(start) || !Number.isFinite(end)) return value

    return formatDateTimeLocal(new Date(clamp(target, start, end)))
  }

  function setPlaybackDateTime(value) {
    const nextValue = clampPlaybackDateTime(value)
    const offset = getOffsetSeconds(nextValue)

    setSelectedDateTime(nextValue)
    syncClipSelectionToDateTime(nextValue)
    if (Number.isFinite(offset)) seekVideoToOffset(offset)
  }

  function syncClipSelectionToDateTime(value) {
    if (!recording.available || timelineMax <= 0) return

    const targetOffset = getOffsetSeconds(value)
    if (!Number.isFinite(targetOffset)) return

    const current = getCurrentClipSelection()
    const currentDuration = current.end - current.start
    const duration = currentDuration > 0 ? currentDuration : Math.min(timelineMax, defaultClipDurationSeconds)
    const start = clamp(targetOffset, 0, Math.max(timelineMax - duration, 0))
    applyClipSelection({ start, end: start + duration })
  }

  function updateClipStart(value) {
    const current = getCurrentClipSelection()
    const start = clamp(Math.round(Number(value) || 0), 0, Math.max(current.end - minClipDuration, 0))
    applyClipSelection({ start, end: current.end })
    seekToOffset(start)
  }

  function updateClipEnd(value) {
    const current = getCurrentClipSelection()
    const end = clamp(Math.round(Number(value) || 0), current.start + minClipDuration, timelineMax)
    applyClipSelection({ start: current.start, end })
  }

  function seekToOffset(value) {
    const offset = clamp(Math.round(Number(value) || 0), 0, Math.max(timelineMax, 0))
    const date = getClipDate(offset)
    if (date) setSelectedDateTime(formatDateTimeLocal(date))
    seekVideoToOffset(offset)
  }

  function seekVideoToOffset(value) {
    const video = videoRef.current
    if (!video || totalDuration <= 0) return

    const mediaDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : totalDuration
    video.currentTime = clamp(Number(value) || 0, 0, Math.max(mediaDuration - 1, 0))
  }

  function applyClipSelection(selection) {
    const nextSelection = {
      start: Number(selection.start) || 0,
      end: Number(selection.end) || 0,
    }

    clipSelectionRef.current = nextSelection
    setClipSelection(nextSelection)
  }

  function getCurrentClipSelection() {
    if (!recording.available || timelineMax <= 0) return { start: 0, end: 0 }

    const current = clipSelectionRef.current
    let start = clamp(Math.round(Number(current.start) || 0), 0, timelineMax)
    let end = clamp(Math.round(Number(current.end) || 0), minClipDuration, timelineMax)

    if (end - start < minClipDuration) {
      if (start + minClipDuration <= timelineMax) {
        end = start + minClipDuration
      } else {
        start = Math.max(end - minClipDuration, 0)
      }
    }

    return { start, end }
  }

  function getTimelinePointerOffset(event) {
    const timeline = timelineSelectorRef.current
    if (!timeline) return 0

    const rect = timeline.getBoundingClientRect()
    if (!rect.width) return 0

    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    return Math.round(ratio * timelineMax)
  }

  function moveClipSelectionFromPointer(event, mode) {
    const offset = getTimelinePointerOffset(event)

    if (mode === 'start') {
      updateClipStart(offset)
      return
    }

    if (mode === 'end') {
      updateClipEnd(offset)
      return
    }

    const current = getCurrentClipSelection()
    const currentDuration = current.end - current.start
    const duration = currentDuration > 0 ? currentDuration : Math.min(timelineMax, defaultClipDurationSeconds)
    const start = clamp(offset, 0, Math.max(timelineMax - duration, 0))
    applyClipSelection({ start, end: start + duration })
    seekToOffset(start)
  }

  function startTimelineDrag(event, mode) {
    if (!recording.available) return

    event.preventDefault()
    event.stopPropagation()
    const dragTarget = event.currentTarget
    try {
      dragTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Some browsers reject capture if the pointer is already gone.
    }
    document.body.classList.add('is-dragging-timeline')
    moveClipSelectionFromPointer(event, mode)

    function handlePointerMove(pointerEvent) {
      pointerEvent.preventDefault()
      moveClipSelectionFromPointer(pointerEvent, mode)
    }

    function handlePointerUp(pointerEvent) {
      try {
        dragTarget.releasePointerCapture?.(pointerEvent.pointerId)
      } catch {
        // Cleanup should continue even if pointer capture was not active.
      }
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', handlePointerUp)
      document.removeEventListener('pointercancel', handlePointerUp)
      document.body.classList.remove('is-dragging-timeline')
    }

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    document.addEventListener('pointercancel', handlePointerUp)
  }

  return (
    <section className="playback-layout">
      <aside className="playback-panel">
        <div className="playback-panel-header">
          <span className="playback-kicker">Historial 48h</span>
          <p className="panel-title">Reproducción</p>
          <p className="panel-subtitle">Grabaciones locales por cámara</p>
        </div>

        <div className="playback-controls">
          <div className="control-group">
            <div className="control-group-header">
              <label className="control-label">Cámara</label>
              <span>{cameras.length}</span>
            </div>
            <div className="camera-picker">
              {cameras.map((camera) => (
                <button
                  key={camera.id}
                  type="button"
                  onClick={() => setSelectedCameraId(camera.id)}
                  className={`picker-button ${selectedCamera?.id === camera.id ? 'is-active' : ''}`}
                  aria-pressed={selectedCamera?.id === camera.id}
                >
                  <span>{camera.name}</span>
                  <small>{camera.status}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="availability-card">
            <span>Disponible</span>
            <strong>{formatRangeDate(recording.startTime)} — {formatRangeDate(recording.endTime)}</strong>
            <small>{segmentCount ? `${segmentCount} segmentos indexados` : 'Sin segmentos indexados'}</small>
          </div>
        </div>
      </aside>

      <div className="playback-main">
        <div className="playback-toolbar">
          <div className="playback-heading">
            <span className="playback-badge">PLAYBACK</span>
            <div>
              <h1>{selectedCamera?.name}</h1>
              <p>{selectedDisplayTime}</p>
            </div>
          </div>

          <div className="playback-time-controls">
            <label className="datetime-field" htmlFor="playback-time">
              <span>Fecha y hora</span>
              <input
                id="playback-time"
                type="datetime-local"
                value={selectedDateTime}
                onChange={(event) => setPlaybackDateTime(event.target.value)}
                min={recording.startTime ? formatDateTimeLocal(new Date(recording.startTime)) : undefined}
                max={recording.endTime ? formatDateTimeLocal(new Date(recording.endTime)) : undefined}
                className="datetime-input"
              />
            </label>
            <div className="quick-actions">
              <button type="button" onClick={jumpToNow}>Ahora</button>
              <button type="button" onClick={jumpToYesterday}>Hace 24h</button>
            </div>
          </div>
        </div>

        <div className="playback-player-card">
          <div className="playback-video-shell">
            {recording.available ? (
              <>
                <video
                  ref={videoRef}
                  controls
                  playsInline
                  className="playback-video"
                />
                <div className="playback-video-overlay">
                  <span>{selectedCamera?.name}</span>
                  <time>{selectedDisplayTime}</time>
                </div>
              </>
            ) : (
              <div className="empty-playback">
                <div className="empty-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M10 8l6 4-6 4V8z" />
                  </svg>
                </div>
                <p>{recording.loading ? 'Buscando grabaciones…' : 'Todavía no hay grabaciones para esta cámara'}</p>
                <span>{error || 'Las grabaciones aparecerán cuando los contenedores recorder estén activos.'}</span>
              </div>
            )}
          </div>
        </div>

        <div className="timeline-card">
          <div className="timeline-header">
            <div>
              <p className="panel-title">Línea de tiempo</p>
              <p className="panel-subtitle">
                {segmentCount ? `${segmentCount} segmentos indexados` : 'Sin segmentos indexados'}
              </p>
            </div>
            <span>{formatRangeDate(recording.startTime)} — {formatRangeDate(recording.endTime)}</span>
          </div>

          <div className="clip-selection-summary">
            <div>
              <span>Selección</span>
              <strong>
                {clipStartDate && clipEndDate
                  ? `${formatRangeDate(clipStartDate)} — ${formatRangeDate(clipEndDate)}`
                  : 'Sin rango seleccionado'}
              </strong>
            </div>
            <a
              className={`clip-download ${canDownloadClip ? '' : 'is-disabled'}`}
              href={clipDownloadUrl}
              onClick={(event) => {
                if (!canDownloadClip) event.preventDefault()
              }}
            >
              Descargar {formatDuration(clipDuration)}
            </a>
          </div>

          <div
            className="timeline-selector"
            ref={timelineSelectorRef}
            style={timelineSelectionStyle}
            onPointerDown={(event) => startTimelineDrag(event, 'range')}
          >
            <div className="timeline-selector-track">
              <span className="timeline-selection-fill" />
              <span className="timeline-playhead-marker" />
            </div>
            <button
              type="button"
              className="timeline-handle timeline-handle--start"
              onPointerDown={(event) => startTimelineDrag(event, 'start')}
              disabled={!recording.available}
              aria-label="Inicio del clip"
            />
            <button
              type="button"
              className="timeline-handle timeline-handle--end"
              onPointerDown={(event) => startTimelineDrag(event, 'end')}
              disabled={!recording.available}
              aria-label="Fin del clip"
            />
          </div>

          <div className="clip-selection-meta">
            <span>Inicio <strong>{clipStartDate ? formatRangeDate(clipStartDate) : 'Sin datos'}</strong></span>
            <span>{formatDuration(clipDuration)} seleccionados</span>
            <span>Fin <strong>{clipEndDate ? formatRangeDate(clipEndDate) : 'Sin datos'}</strong></span>
          </div>
        </div>
      </div>
    </section>
  )
}
