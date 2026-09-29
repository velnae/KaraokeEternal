import React from 'react'
import styles from './YouTubePlayer.css'

const IFRAME_API_URL = 'https://www.youtube.com/iframe_api'
const STATUS_INTERVAL_MS = 500

interface YouTubePlayerInstance {
  cueVideoById(videoId: string): void
  destroy(): void
  getCurrentTime(): number
  loadVideoById(videoId: string): void
  pauseVideo(): void
  playVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  setSize(width: number, height: number): void
  setVolume(volume: number): void
}

interface YouTubePlayerEvent {
  data: number
  target: YouTubePlayerInstance
}

interface YouTubeApi {
  Player: new (element: HTMLElement, options: {
    width: number
    height: number
    videoId: string
    playerVars: Record<string, number | string>
    events: {
      onReady(event: YouTubePlayerEvent): void
      onStateChange(event: YouTubePlayerEvent): void
      onError(event: YouTubePlayerEvent): void
    }
  }) => YouTubePlayerInstance
  PlayerState: {
    ENDED: number
    PAUSED: number
    PLAYING: number
  }
}

declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<YouTubeApi> | null = null

const loadYouTubeIframeApi = (): Promise<YouTubeApi> => {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previousReady?.()
      if (window.YT?.Player) resolve(window.YT)
      else reject(new Error('YouTube IFrame Player API did not initialize'))
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${IFRAME_API_URL}"]`)
    if (existing) return

    const script = document.createElement('script')
    script.src = IFRAME_API_URL
    script.async = true
    script.onerror = () => {
      apiPromise = null
      reject(new Error('Could not load the YouTube IFrame Player API'))
    }
    document.head.appendChild(script)
  })

  return apiPromise
}

interface YouTubePlayerProps {
  height: number
  isPlaying: boolean
  mediaKey: number
  mediaReplayKey?: number
  onEnd(): void
  onError(error: string, diagnostic?: { category: 'iframe' | 'api-load', code?: number }): void
  onLoad(): void
  onPlay(): void
  onStatus(status: { isPlaying?: boolean, position?: number }): void
  videoId: string
  volume: number
  width: number
}

class YouTubePlayer extends React.Component<YouTubePlayerProps> {
  container = React.createRef<HTMLDivElement>()
  player: YouTubePlayerInstance | null = null
  statusTimer: ReturnType<typeof setInterval> | null = null
  isMounted = false
  awaitingPlayback = false

  componentDidMount () {
    this.isMounted = true
    this.props.onLoad()
    loadYouTubeIframeApi()
      .then(this.createPlayer)
      .catch((error) => {
        if (this.isMounted) this.props.onError(error.message, { category: 'api-load' })
      })
  }

  componentDidUpdate (prevProps: YouTubePlayerProps) {
    if (!this.player) return

    if (prevProps.mediaKey !== this.props.mediaKey || prevProps.videoId !== this.props.videoId) {
      this.props.onLoad()
      this.awaitingPlayback = this.props.isPlaying
      if (this.props.isPlaying) this.player.loadVideoById(this.props.videoId)
      else this.player.cueVideoById(this.props.videoId)
    } else if (prevProps.mediaReplayKey !== this.props.mediaReplayKey) {
      this.player.seekTo(0, true)
      if (this.props.isPlaying) this.player.playVideo()
    } else if (prevProps.isPlaying !== this.props.isPlaying) {
      this.awaitingPlayback = this.props.isPlaying
      this.updateIsPlaying()
    }

    if (prevProps.volume !== this.props.volume) this.updateVolume()
    if (prevProps.width !== this.props.width || prevProps.height !== this.props.height) {
      this.player.setSize(this.props.width, this.props.height)
    }
  }

  componentWillUnmount () {
    this.isMounted = false
    this.stopStatusUpdates()
    this.player?.destroy()
    this.player = null
  }

  createPlayer = (api: YouTubeApi) => {
    if (!this.isMounted || !this.container.current) return

    this.player = new api.Player(this.container.current, {
      width: this.props.width,
      height: this.props.height,
      videoId: this.props.videoId,
      playerVars: {
        autoplay: 0,
        controls: 1,
        disablekb: 0,
        enablejsapi: 1,
        origin: window.location.origin,
        playsinline: 1,
        rel: 0,
      },
      events: {
        onReady: this.handleReady,
        onStateChange: this.handleStateChange,
        onError: this.handleError,
      },
    })
  }

  handleReady = () => {
    this.updateVolume()
    this.updateIsPlaying()
  }

  handleStateChange = (event: YouTubePlayerEvent) => {
    if (event.data === window.YT?.PlayerState.PLAYING) {
      this.awaitingPlayback = false
      this.props.onPlay()
      this.props.onStatus({ isPlaying: true })
      this.startStatusUpdates()
    } else if (event.data === window.YT?.PlayerState.PAUSED) {
      // A previous video's pause can arrive while loadVideoById starts the next one.
      if (!this.awaitingPlayback) this.props.onStatus({ isPlaying: false })
      this.stopStatusUpdates()
    } else {
      this.stopStatusUpdates()
    }

    if (event.data === window.YT?.PlayerState.ENDED) this.props.onEnd()
  }

  handleError = (event: YouTubePlayerEvent) => {
    const messages: Record<number, string> = {
      2: 'Invalid YouTube video ID',
      5: 'YouTube HTML5 playback failed',
      100: 'YouTube video is unavailable or has been removed',
      101: 'YouTube video owner does not allow embedded playback',
      150: 'YouTube video owner does not allow embedded playback',
    }
    this.stopStatusUpdates()
    this.props.onError(`${messages[event.data] ?? 'YouTube playback failed'} (code ${event.data})`, {
      category: 'iframe',
      code: event.data,
    })
  }

  updateIsPlaying = () => {
    if (!this.player) return
    if (this.props.isPlaying) this.player.playVideo()
    else this.player.pauseVideo()
  }

  updateVolume = () => this.player?.setVolume(Math.round(Math.min(Math.max(this.props.volume, 0), 1) * 100))

  startStatusUpdates = () => {
    this.stopStatusUpdates()
    this.statusTimer = setInterval(() => {
      const position = this.player?.getCurrentTime()
      if (typeof position === 'number' && Number.isFinite(position)) this.props.onStatus({ position })
    }, STATUS_INTERVAL_MS)
  }

  stopStatusUpdates = () => {
    if (this.statusTimer) clearInterval(this.statusTimer)
    this.statusTimer = null
  }

  render () {
    return (
      <div
        className={styles.container}
        ref={this.container}
        style={{ width: this.props.width, height: this.props.height }}
      />
    )
  }
}

export default YouTubePlayer
