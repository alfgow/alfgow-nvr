import { useMemo, useState } from 'react'

const retentionDays = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
]

const timelineHours = ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00']

export default function PlaybackView({ cameras }) {
  const [selectedCameraId, setSelectedCameraId] = useState(cameras[0]?.id)
  const [selectedDay, setSelectedDay] = useState(retentionDays[0].id)
  const [selectedTime, setSelectedTime] = useState('Ahora')

  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === selectedCameraId) ?? cameras[0],
    [cameras, selectedCameraId],
  )

  return (
    <section style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, alignItems: 'start' }}>
      <aside
        style={{
          background: 'var(--color-bg-card)',
          border: '1px solid var(--color-border)',
          borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: 16, borderBottom: '1px solid var(--color-border)' }}>
          <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 700, fontSize: 15 }}>
            Reproducción
          </p>
          <p style={{ margin: '4px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
            Retención local de los últimos 2 días
          </p>
        </div>

        <div style={{ padding: 14, display: 'grid', gap: 14 }}>
          <div>
            <label style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>
              CÁMARA
            </label>
            <div style={{ display: 'grid', gap: 8 }}>
              {cameras.map((camera) => (
                <button
                  key={camera.id}
                  type="button"
                  onClick={() => setSelectedCameraId(camera.id)}
                  style={{
                    textAlign: 'left',
                    color: selectedCamera?.id === camera.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    background: selectedCamera?.id === camera.id ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${selectedCamera?.id === camera.id ? 'rgba(59,130,246,0.35)' : 'var(--color-border)'}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  {camera.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 8 }}>
              DÍA
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {retentionDays.map((day) => (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => setSelectedDay(day.id)}
                  style={{
                    color: selectedDay === day.id ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                    background: selectedDay === day.id ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${selectedDay === day.id ? 'rgba(34,197,94,0.25)' : 'var(--color-border)'}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    fontWeight: 700,
                  }}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <div style={{ display: 'grid', gap: 16 }}>
        <div
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 700, fontSize: 14 }}>
                {selectedCamera?.name}
              </p>
              <p style={{ margin: '3px 0 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
                {retentionDays.find((day) => day.id === selectedDay)?.label} · {selectedTime}
              </p>
            </div>
            <span
              style={{
                color: 'var(--color-accent-glow)',
                background: 'rgba(59,130,246,0.12)',
                border: '1px solid rgba(59,130,246,0.35)',
                borderRadius: 999,
                padding: '5px 10px',
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.08em',
              }}
            >
              PLAYBACK
            </span>
          </div>

          <div style={{ aspectRatio: '16/9', background: '#000', position: 'relative', display: 'grid', placeItems: 'center' }}>
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,0.16)',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto 14px',
                  background: 'rgba(255,255,255,0.06)',
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="9 7 19 12 9 17 9 7" />
                </svg>
              </div>
              <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 700 }}>
                Player de grabaciones
              </p>
              <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 13 }}>
                Aquí se reproducirán los clips guardados localmente cuando conectemos el índice de grabaciones.
              </p>
            </div>
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 16,
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ margin: 0, color: 'var(--color-text-primary)', fontWeight: 700, fontSize: 14 }}>
              Línea de tiempo
            </p>
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 12 }}>
              Selección rápida por bloque horario
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 8 }}>
            {timelineHours.map((hour) => (
              <button
                key={hour}
                type="button"
                onClick={() => setSelectedTime(hour)}
                style={{
                  color: selectedTime === hour ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
                  background: selectedTime === hour ? 'rgba(59,130,246,0.16)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${selectedTime === hour ? 'rgba(59,130,246,0.45)' : 'var(--color-border)'}`,
                  borderRadius: 10,
                  padding: '12px 6px',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {hour}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
