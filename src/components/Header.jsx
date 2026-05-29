import { useState, useEffect } from 'react'

export default function Header({ cameraCount, activeView, onViewChange }) {
  const [time, setTime] = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const timeStr = time.toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const dateStr = time.toLocaleDateString('es-ES', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  })

  return (
    <header
      style={{
        borderBottom: '1px solid var(--color-border)',
        background: 'rgba(3, 7, 17, 0.9)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
      className="app-header"
    >
      {/* Logo */}
      <div className="header-logo">
        <img
          src="/logo.webp"
          alt="Alfgow NVR"
          style={{
            height: 52,
            width: 'auto',
            objectFit: 'contain',
          }}
        />
      </div>

      {/* Center — live indicator */}
      <div className="view-switcher">
        <button
          type="button"
          onClick={() => onViewChange('live')}
          className="text-sm font-medium"
          style={{
            color: activeView === 'live' ? 'var(--color-status)' : 'var(--color-text-muted)',
            background: activeView === 'live' ? 'rgba(34,197,94,0.1)' : 'transparent',
            border: `1px solid ${activeView === 'live' ? 'rgba(34,197,94,0.25)' : 'var(--color-border)'}`,
            borderRadius: 999,
            padding: '7px 12px',
            cursor: 'pointer',
          }}
        >
          <span
            className={activeView === 'live' ? 'rec-pulse' : ''}
            style={{
              display: 'inline-block',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: activeView === 'live' ? 'var(--color-status)' : 'var(--color-text-muted)',
              marginRight: 7,
            }}
          />
          {cameraCount} cam{cameraCount !== 1 ? 's' : ''} ONLINE
        </button>
        <button
          type="button"
          onClick={() => onViewChange('playback')}
          className="text-sm font-medium"
          style={{
            color: activeView === 'playback' ? 'var(--color-accent-glow)' : 'var(--color-text-muted)',
            background: activeView === 'playback' ? 'rgba(59,130,246,0.12)' : 'transparent',
            border: `1px solid ${activeView === 'playback' ? 'rgba(59,130,246,0.35)' : 'var(--color-border)'}`,
            borderRadius: 999,
            padding: '7px 12px',
            cursor: 'pointer',
          }}
        >
          Historial 48h
        </button>
      </div>

      {/* Clock */}
      <div className="text-right">
        <div
          className="text-sm font-semibold tabular-nums"
          style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em' }}
        >
          {timeStr}
        </div>
        <div className="text-xs mt-0.5 capitalize" style={{ color: 'var(--color-text-muted)' }}>
          {dateStr}
        </div>
      </div>
    </header>
  )
}
