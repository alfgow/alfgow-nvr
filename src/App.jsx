import { useState } from 'react'
import Header from './components/Header'
import CameraGrid from './components/CameraGrid'
import FullscreenModal from './components/FullscreenModal'
import { cameras } from './config/cameras'

export default function App() {
  const [selectedCamera, setSelectedCamera] = useState(null)

  const onlineCameras = cameras.filter((c) => c.status === 'ONLINE')

  return (
    <div className="min-h-screen">
      <Header cameraCount={onlineCameras.length} />
      <main className="p-6">
        <CameraGrid cameras={cameras} onCameraSelect={setSelectedCamera} />
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
