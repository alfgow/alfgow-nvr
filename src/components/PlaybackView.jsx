import { useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'

function formatDateTimeLocal(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return offsetDate.toISOString().slice(0, 16)
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export default function PlaybackView({ cameras }) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const [selectedCameraId, setSelectedCameraId] = useState(cameras[0]?.id)
  const [selectedDateTime, setSelectedDateTime] = useState(formatDateTimeLocal(new Date()))
  const [recording, setRecording] = useState({ loading: true, available: false, segments: [] })
  const [error, setError] = useState('')
  const [clipSelection, setClipSelection] = useState({ start: 0, end: 0 })

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
        const data = await response.json()
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

    const playlistUrl = `${recording.playlistUrl}?t=${Date.now()}`

    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: false, backBufferLength: 120, maxBufferLength: 120 })
      hlsRef.current = hls
      hls.loadSource(playlistUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => seekToSelectedTime())
      return () => hls.destroy()
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
    const duration = Math.max(Math.round(totalDuration), 0)
    if (!recording.available || duration <= 0) {
      setClipSelection({ start: 0, end: 0 })
      return
    }

    const defaultDuration = Math.min(duration, 5 * 60)
    setClipSelection({ start: duration - defaultDuration, end: duration })
  }, [recording.available, recording.startTime, totalDuration])

  function seekToSelectedTime() {
    const video = videoRef.current
    if (!video || !recording.startTime || !selectedDateTime || totalDuration <= 0) return

    const start = new Date(recording.startTime).getTime()
    const target = new Date(selectedDateTime).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(target)) return

    const offsetSeconds = clamp((target - start) / 1000, 0, Math.max(totalDuration - 1, 0))
    const seekableStart = video.seekable.length ? video.seekable.start(0) : 0
    const seekableEnd = video.seekable.length ? video.seekable.end(video.seekable.length - 1) : totalDuration
    video.currentTime = clamp(seekableStart + offsetSeconds, seekableStart, Math.max(seekableStart, seekableEnd - 1))
  }

  function jumpToNow() {
    const value = formatDateTimeLocal(new Date())
    setSelectedDateTime(value)
  }

  function jumpToYesterday() {
    const date = new Date()
    date.setDate(date.getDate() - 1)
    setSelectedDateTime(formatDateTimeLocal(date))
  }

  function getTimelineOffset() {
    if (!recording.startTime || !selectedDateTime) return 0

    const start = new Date(recording.startTime).getTime()
    const target = new Date(selectedDateTime).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(target)) return 0

    return clamp((target - start) / 1000, 0, Math.max(totalDuration, 1))
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
      start: clipStartDate.toISOString(),
      end: clipEndDate.toISOString(),
    }).toString()}`
    : '#'
  const timelineSelectionStyle = {
    '--clip-start': `${(clipStart / timelineMax) * 100}%`,
    '--clip-width': `${((clipEnd - clipStart) / timelineMax) * 100}%`,
    '--timeline-playhead': `${(clamp(timelineOffset, 0, timelineMax) / timelineMax) * 100}%`,
  }

  function getClipDate(offsetSeconds) {
    if (!recording.startTime) return null
    const start = new Date(recording.startTime).getTime()
    if (!Number.isFinite(start)) return null
    return new Date(start + offsetSeconds * 1000)
  }

  function updateClipStart(value) {
    setClipSelection((current) => ({
      ...current,
      start: clamp(Number(value), 0, Math.max(clipEnd - minClipDuration, 0)),
    }))
  }

  function updateClipEnd(value) {
    setClipSelection((current) => ({
      ...current,
      end: clamp(Number(value), clipStart + minClipDuration, timelineMax),
    }))
  }

  function seekFromTimeline(value) {
    if (!recording.startTime) return
    const date = new Date(new Date(recording.startTime).getTime() + Number(value) * 1000)
    setSelectedDateTime(formatDateTimeLocal(date))
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
                onChange={(event) => setSelectedDateTime(event.target.value)}
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

          <div className="timeline-selector" style={timelineSelectionStyle}>
            <div className="timeline-selector-track">
              <span className="timeline-selection-fill" />
              <span className="timeline-playhead-marker" />
            </div>
            <input
              type="range"
              min="0"
              max={timelineMax}
              value={timelineOffset}
              onChange={(event) => seekFromTimeline(event.target.value)}
              className="timeline-seek-range"
              disabled={!recording.available}
              aria-label="Mover reproducción"
            />
            <input
              type="range"
              min="0"
              max={timelineMax}
              value={clipStart}
              onChange={(event) => updateClipStart(event.target.value)}
              className="timeline-handle timeline-handle--start"
              disabled={!recording.available}
              aria-label="Inicio del clip"
            />
            <input
              type="range"
              min="0"
              max={timelineMax}
              value={clipEnd}
              onChange={(event) => updateClipEnd(event.target.value)}
              className="timeline-handle timeline-handle--end"
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
