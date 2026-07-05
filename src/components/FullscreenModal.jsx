import { useEffect, useRef } from 'react'
import Hls from 'hls.js'
import { hlsOptions, keepNearLiveEdge } from '../config/hls'

export default function FullscreenModal({ camera, onClose }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (Hls.isSupported()) {
      const hls = new Hls(hlsOptions)
      hls.loadSource(camera.stream)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.FRAG_LOADED, () => keepNearLiveEdge(video, hls))
      return () => hls.destroy()
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = camera.stream
      video.addEventListener(
        'loadedmetadata',
        () => {
          video.play().catch(() => {})
        },
        { once: true }
      )
    }
  }, [camera.stream])

  return (
    <div
      className="modal-enter"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(3, 7, 17, 0.88)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Modal container */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 1100,
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 16,
          overflow: 'hidden',
          boxShadow: '0 0 0 1px rgba(59,130,246,0.2), 0 40px 80px rgba(0,0,0,0.7)',
        }}
      >
        {/* Modal header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)' }}>
              {camera.name}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
              Vista completa
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* REC badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                className="rec-pulse"
                style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--color-rec)',
                }}
              />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--color-text-muted)' }}>
                REC
              </span>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                padding: '6px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-muted)',
                transition: 'background 0.15s',
              }}
              title="Cerrar (ESC)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Video */}
        <div style={{ aspectRatio: '16/9', background: '#000' }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            controls
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        </div>
      </div>

      {/* ESC hint */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8,
          padding: '5px 12px',
          fontSize: 11,
          color: 'var(--color-text-muted)',
        }}
      >
        Pulsa <kbd style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--color-text-primary)' }}>ESC</kbd> o haz clic fuera para cerrar
      </div>
    </div>
  )
}
