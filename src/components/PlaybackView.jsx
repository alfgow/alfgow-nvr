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

  return (
    <section className="playback-layout">
      <aside className="playback-panel">
        <div className="playback-panel-header">
          <p className="panel-title">Reproducción</p>
          <p className="panel-subtitle">Grabaciones locales de las últimas 48h</p>
        </div>

        <div className="playback-controls">
          <div>
            <label className="control-label">CÁMARA</label>
            <div className="camera-picker">
              {cameras.map((camera) => (
                <button
                  key={camera.id}
                  type="button"
                  onClick={() => setSelectedCameraId(camera.id)}
                  className={`picker-button ${selectedCamera?.id === camera.id ? 'is-active' : ''}`}
                >
                  {camera.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="control-label" htmlFor="playback-time">FECHA Y HORA</label>
            <input
              id="playback-time"
              type="datetime-local"
              value={selectedDateTime}
              onChange={(event) => setSelectedDateTime(event.target.value)}
              min={recording.startTime ? formatDateTimeLocal(new Date(recording.startTime)) : undefined}
              max={recording.endTime ? formatDateTimeLocal(new Date(recording.endTime)) : undefined}
              className="datetime-input"
            />
            <div className="quick-actions">
              <button type="button" onClick={jumpToNow}>Ahora</button>
              <button type="button" onClick={jumpToYesterday}>Hace 24h</button>
            </div>
          </div>

          <div className="availability-card">
            <span>Disponible</span>
            <strong>{formatRangeDate(recording.startTime)} — {formatRangeDate(recording.endTime)}</strong>
          </div>
        </div>
      </aside>

      <div className="playback-main">
        <div className="playback-player-card">
          <div className="playback-card-header">
            <div>
              <p className="panel-title">{selectedCamera?.name}</p>
              <p className="panel-subtitle">{selectedDateTime.replace('T', ' ')}</p>
            </div>
            <span className="playback-badge">PLAYBACK</span>
          </div>

          <div className="playback-video-shell">
            {recording.available ? (
              <video
                ref={videoRef}
                controls
                playsInline
                className="playback-video"
              />
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
          <div>
            <p className="panel-title">Línea de tiempo</p>
            <p className="panel-subtitle">
              {recording.segments?.length ? `${recording.segments.length} segmentos indexados` : 'Sin segmentos indexados'}
            </p>
          </div>
          <input
            type="range"
            min="0"
            max={Math.max(Math.round(totalDuration), 1)}
            value={timelineOffset}
            onChange={(event) => {
              if (!recording.startTime) return
              const date = new Date(new Date(recording.startTime).getTime() + Number(event.target.value) * 1000)
              setSelectedDateTime(formatDateTimeLocal(date))
            }}
            className="timeline-range"
            disabled={!recording.available}
          />
        </div>
      </div>
    </section>
  )
}
