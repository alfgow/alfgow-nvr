import CameraCard from './CameraCard'

export default function CameraGrid({ cameras, onCameraSelect }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
