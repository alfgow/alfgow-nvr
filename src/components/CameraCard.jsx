import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { hlsOptions, keepNearLiveEdge } from '../config/hls'

export default function CameraCard({ camera, onSelect }) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [error, setError] = useState(false)
  const [recordingsOpen, setRecordingsOpen] = useState(false)
  const [recordings, setRecordings] = useState({ loading: false, available: false, segments: [] })
  const [recordingsError, setRecordingsError] = useState('')

  function formatRecordingTime(value) {
    if (!value) return 'Sin fecha'

    return new Date(value).toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video || camera.status !== 'ONLINE') return

    setLoading(true)
    setError(false)

    if (Hls.isSupported()) {
      const hls = new Hls(hlsOptions)
      hlsRef.current = hls
      hls.loadSource(camera.stream)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLoading(false)
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.FRAG_LOADED, () => keepNearLiveEdge(video, hls))
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError(true)
      })
      return () => {
        hls.destroy()
        hlsRef.current = null
      }
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = camera.stream
      const onLoad = () => {
        setLoading(false)
        video.play().catch(() => {})
      }
      video.addEventListener('loadedmetadata', onLoad)
      return () => video.removeEventListener('loadedmetadata', onLoad)
    }
  }, [camera.stream, camera.status])

  useEffect(() => {
    if (!recordingsOpen || camera.status !== 'ONLINE') return

    const controller = new AbortController()
    let cancelled = false

    async function loadRecordings() {
      setRecordings((current) => ({ ...current, loading: true }))
      setRecordingsError('')

      try {
        const response = await fetch(`/api/recordings/${camera.id}`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error('No se pudieron cargar las grabaciones')
        }

        const data = await response.json()
        if (!cancelled) {
          setRecordings({
            loading: false,
            available: data.available,
            segments: data.segments ?? [],
          })
        }
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') return

        if (!cancelled) {
          setRecordings({ loading: false, available: false, segments: [] })
          setRecordingsError(fetchError.message)
        }
      }
    }

    loadRecordings()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [camera.id, camera.status, recordingsOpen])

  const latestSegments = recordings.segments.slice(-8).reverse()
  const manifestUrl = `/recordings/${camera.id}/index.m3u8`

  return (
    <div
      className="card-glow"
      style={{
        background: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 14,
        overflow: 'hidden',
        transition: 'box-shadow 0.2s ease',
        cursor: 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Card header */}
      <div
        style={{
          borderBottom: '1px solid var(--color-border)',
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)', margin: 0 }}>
            {camera.name}
          </p>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: camera.status === 'ONLINE' ? 'var(--color-status)' : 'var(--color-text-muted)',
            background: camera.status === 'ONLINE' ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)',
            border: `1px solid ${camera.status === 'ONLINE' ? 'rgba(34,197,94,0.25)' : 'rgba(100,116,139,0.2)'}`,
            borderRadius: 6,
            padding: '2px 8px',
          }}
        >
          {camera.status}
        </span>
      </div>

      {/* Video area */}
      <div
        onDoubleClick={onSelect}
        style={{
          position: 'relative',
          aspectRatio: '16/9',
          background: '#000',
          overflow: 'hidden',
          cursor: 'pointer',
        }}
      >
        {camera.status === 'ONLINE' ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />

            {/* Loading spinner */}
            {loading && !error && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: '#000',
                }}
              >
                <div className="loader" />
              </div>
            )}

            {/* Error state */}
            {error && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  background: '#000',
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span style={{ fontSize: 12, color: '#64748b' }}>Sin señal</span>
              </div>
            )}

            {/* REC indicator (top-left) */}
            {!loading && !error && (
              <div
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  background: 'rgba(0,0,0,0.55)',
                  borderRadius: 6,
                  padding: '3px 8px',
                }}
              >
                <span
                  className="rec-pulse"
                  style={{
                    display: 'inline-block',
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--color-rec)',
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#fff' }}>
                  REC
                </span>
              </div>
            )}

            {/* Recording button */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                setRecordingsOpen((current) => !current)
              }}
              style={{
                position: 'absolute',
                top: 10,
                right: 56,
                background: recordingsOpen ? 'rgba(59,130,246,0.16)' : 'rgba(0,0,0,0.55)',
                border: `1px solid ${recordingsOpen ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.12)'}`,
                borderRadius: 7,
                padding: '5px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: hovered ? 1 : 0.75,
                transition: 'opacity 0.18s ease, background 0.18s ease, border-color 0.18s ease',
                color: recordingsOpen ? 'var(--color-accent-glow)' : '#fff',
              }}
              title={recordingsOpen ? 'Ocultar grabaciones' : 'Ver grabaciones'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5h16" />
                <path d="M6 3.5h12l2 8-2 8H6l-2-8 2-8Z" />
                <path d="M9 10h6" />
              </svg>
            </button>

            {/* Fullscreen button (top-right, on hover) */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onSelect()
              }}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                background: 'rgba(0,0,0,0.55)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 7,
                padding: '5px 7px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: hovered ? 1 : 0.75,
                transition: 'opacity 0.18s ease',
              }}
              title="Ver en pantalla completa"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
              </svg>
            </button>

            {/* Bottom gradient overlay with camera name */}
            {!loading && !error && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: '45%',
                  background: 'linear-gradient(to top, rgba(3,7,17,0.85) 0%, transparent 100%)',
                  display: 'flex',
                  alignItems: 'flex-end',
                  padding: '0 12px 10px',
                  pointerEvents: 'none',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>
                  {camera.name}
                </span>
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              Cámara sin configurar
            </span>
          </div>
        )}
      </div>

      {recordingsOpen && camera.status === 'ONLINE' && (
        <div className="recordings-panel">
          <div className="recordings-panel-header">
            <div>
              <p className="recordings-title">Grabaciones</p>
              <p className="recordings-subtitle">
                {recordings.loading
                  ? 'Cargando segmentos…'
                  : recordings.available
                    ? `${recordings.segments.length} segmentos disponibles`
                    : 'No hay grabaciones indexadas todavía'}
              </p>
            </div>

            <a className="recordings-download-all" href={manifestUrl} download>
              Descargar índice
            </a>
          </div>

          <div className="recordings-body">
            {recordingsError ? (
              <div className="recordings-empty">
                <p>{recordingsError}</p>
              </div>
            ) : recordings.loading ? (
              <div className="recordings-empty">
                <div className="loader" />
              </div>
            ) : latestSegments.length ? (
              <ul className="recordings-list">
                {latestSegments.map((segment) => {
                  const segmentUrl = `/recordings/${camera.id}/${segment.uri}`

                  return (
                    <li key={segment.uri} className="recording-row">
                      <div className="recording-row-meta">
                        <strong>{formatRecordingTime(segment.programDateTime)}</strong>
                        <span>{segment.duration ? `${segment.duration.toFixed(0)} s` : 'Duración desconocida'}</span>
                      </div>

                      <a className="recording-download" href={segmentUrl} download>
                        Descargar
                      </a>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="recordings-empty">
                <p>Abre esta sección cuando el grabador haya generado segmentos.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
