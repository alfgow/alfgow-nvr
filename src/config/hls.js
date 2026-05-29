export const hlsOptions = {
  lowLatencyMode: true,
  liveSyncDurationCount: 1,
  liveMaxLatencyDurationCount: 3,
  maxLiveSyncPlaybackRate: 1.5,
  backBufferLength: 0,
}

export function keepNearLiveEdge(video, hls) {
  const liveSyncPosition = hls.liveSyncPosition
  if (!liveSyncPosition || !Number.isFinite(video.currentTime)) return

  const latency = liveSyncPosition - video.currentTime
  if (latency > 4) {
    video.currentTime = liveSyncPosition
  }
}
