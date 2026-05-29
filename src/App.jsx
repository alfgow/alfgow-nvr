import { useState } from 'react'
import Header from './components/Header'
import CameraGrid from './components/CameraGrid'
import FullscreenModal from './components/FullscreenModal'
import PlaybackView from './components/PlaybackView'
import { cameras } from './config/cameras'

export default function App() {
  const [selectedCamera, setSelectedCamera] = useState(null)
  const [activeView, setActiveView] = useState('live')

  const onlineCameras = cameras.filter((c) => c.status === 'ONLINE')

  return (
    <div className="min-h-screen">
      <Header
        cameraCount={onlineCameras.length}
        activeView={activeView}
        onViewChange={setActiveView}
      />
      <main className="app-main">
        {activeView === 'live' ? (
          <CameraGrid cameras={cameras} onCameraSelect={setSelectedCamera} />
        ) : (
          <PlaybackView cameras={cameras} />
        )}
      </main>
      {selectedCamera && (
        <FullscreenModal
          camera={selectedCamera}
          onClose={() => setSelectedCamera(null)}
        />
      )}
    </div>
  )
}
