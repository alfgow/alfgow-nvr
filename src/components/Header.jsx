import { useState, useEffect } from 'react'

export default function Header({ cameraCount }) {
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
      className="px-6 py-4 flex items-center justify-between"
    >
      {/* Logo */}
      <div className="flex items-center">
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
      <div className="flex items-center gap-2">
        <span
          className="rec-pulse"
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: 'var(--color-status)',
            flexShrink: 0,
          }}
        />
        <span className="text-sm font-medium" style={{ color: 'var(--color-status)' }}>
          {cameraCount} cam{cameraCount !== 1 ? 's' : ''} ONLINE
        </span>
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
