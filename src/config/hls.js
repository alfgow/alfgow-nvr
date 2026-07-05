export const hlsOptions = {
  lowLatencyMode: false,
  liveSyncDurationCount: 2,
  liveMaxLatencyDurationCount: 4,
  maxLiveSyncPlaybackRate: 1.25,
  backBufferLength: 0,
}

export function keepNearLiveEdge(video, hls) {
  const liveSyncPosition = hls.liveSyncPosition
  if (!liveSyncPosition || !Number.isFinite(video.currentTime)) return

  const latency = liveSyncPosition - video.currentTime
  if (latency > 2) {
    video.currentTime = liveSyncPosition
  }
}
