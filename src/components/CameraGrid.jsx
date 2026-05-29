import CameraCard from './CameraCard'

export default function CameraGrid({ cameras, onCameraSelect }) {
  return (
    <div className="camera-grid">
      {cameras.map((camera) => (
        <CameraCard
          key={camera.id}
          camera={camera}
          onSelect={() => onCameraSelect(camera)}
        />
      ))}
    </div>
  )
}
