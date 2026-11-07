import React from 'react'
import Button from '../../../../../components/Button/Button'
import styles from './YouTubePlayer.css'

const IFRAME_API_URL = 'https://www.youtube.com/iframe_api'
const STATUS_INTERVAL_MS = 500
const VIDEO_CUED = 5

interface YouTubePlayerInstance {
  cueVideoById(videoId: string): void
  destroy(): void
  getCurrentTime(): number
  getVideoUrl(): string
  getDuration(): number
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
      onAutoplayBlocked(event: Pick<YouTubePlayerEvent, 'target'>): void
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
      else reject(new Error('No se pudo iniciar el reproductor de YouTube'))
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${IFRAME_API_URL}"]`)
    if (existing) return

    const script = document.createElement('script')
    script.src = IFRAME_API_URL
    script.async = true
    script.onerror = () => {
      apiPromise = null
      script.remove()
      reject(new Error('No se pudo cargar el reproductor de YouTube'))
    }
    document.head.appendChild(script)
  })

  return apiPromise
}

interface YouTubePlayerProps {
  controls?: 0 | 1
  showAutoplayRecovery?: boolean
  height: number
  isPlaying: boolean
  isActive?: boolean
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
  isReady = false
  mountGeneration = 0
  awaitingPlayback = false
  awaitingPreparedStart = false
  cuePending = false
  preparationError: Parameters<YouTubePlayerProps['onError']> | null = null
  state = { autoplayBlocked: false }

  componentDidMount () {
    this.isMounted = true
    const generation = ++this.mountGeneration
    if (this.props.isActive !== false) this.props.onLoad()
    loadYouTubeIframeApi()
      .then((api): void => {
        if (this.isMounted && generation === this.mountGeneration) this.createPlayer(api)
        return undefined
      })
      .catch((error) => {
        if (this.isMounted && generation === this.mountGeneration) {
          this.reportError(error.message, { category: 'api-load' })
        }
      })
  }

  componentDidUpdate (prevProps: YouTubePlayerProps) {
    const active = this.props.isActive !== false
    const activating = active && prevProps.isActive === false
    const mediaChanged = prevProps.mediaKey !== this.props.mediaKey || prevProps.videoId !== this.props.videoId
    const replayChanged = prevProps.mediaReplayKey !== this.props.mediaReplayKey
    if (mediaChanged && this.preparationError?.[1]?.category === 'iframe') this.preparationError = null
    if (activating) {
      this.props.onLoad()
      if (this.preparationError) {
        const error = this.preparationError
        this.preparationError = null
        this.props.onError(...error)
        return
      }
    }
    if (!active) {
      this.awaitingPlayback = false
      this.awaitingPreparedStart = true
      this.stopStatusUpdates()
    }
    if (!this.player || !this.isReady) return

    // Restore volume before starting the prepared video so its opening is audible.
    if (prevProps.volume !== this.props.volume) this.updateVolume()
    if (!active) {
      if (mediaChanged || replayChanged) {
        this.setState({ autoplayBlocked: false })
        this.cueVideo()
      } else if (prevProps.isActive !== false) this.player.pauseVideo()
    } else if (mediaChanged) {
      this.setState({ autoplayBlocked: false })
      if (!activating) this.props.onLoad()
      this.awaitingPlayback = this.props.isPlaying
      this.cuePending = false
      if (this.props.isPlaying) this.player.loadVideoById(this.props.videoId)
      else this.cueVideo()
    } else if (replayChanged) {
      this.awaitingPlayback = this.props.isPlaying
      if (!this.cuePending) {
        this.player.seekTo(0, true)
        if (this.props.isPlaying) this.player.playVideo()
      }
    } else if (activating || prevProps.isPlaying !== this.props.isPlaying) {
      this.awaitingPlayback = this.props.isPlaying
      this.updateIsPlaying()
    }

    if (prevProps.width !== this.props.width || prevProps.height !== this.props.height) {
      this.player.setSize(this.props.width, this.props.height)
    }
  }

  componentWillUnmount () {
    this.isMounted = false
    this.isReady = false
    this.cuePending = false
    ++this.mountGeneration
    this.stopStatusUpdates()
    const player = this.player
    this.player = null
    player?.destroy()
  }

  createPlayer = (api: YouTubeApi) => {
    if (!this.isMounted || !this.container.current || this.player) return

    // YouTube replaces its target node; keep React's container intact for remounts.
    const target = document.createElement('div')
    this.container.current.replaceChildren(target)
    this.isReady = false
    this.player = new api.Player(target, {
      width: this.props.width,
      height: this.props.height,
      videoId: this.props.videoId,
      playerVars: {
        autoplay: 0,
        controls: this.props.controls ?? 1,
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
        onAutoplayBlocked: this.handleAutoplayBlocked,
      },
    })
  }

  handleReady = (event: Pick<YouTubePlayerEvent, 'target'>) => {
    if (!this.isMounted || event.target !== this.player || this.isReady) return
    this.isReady = true
    this.awaitingPlayback = this.props.isActive !== false && this.props.isPlaying
    this.awaitingPreparedStart = this.props.isActive === false
    this.player.setSize(this.props.width, this.props.height)
    this.updateVolume()
    // Props may have changed while the iframe was initializing.
    if (this.awaitingPlayback) this.player.loadVideoById(this.props.videoId)
    else this.cueVideo()
  }

  cueVideo = () => {
    this.cuePending = true
    this.player?.cueVideoById(this.props.videoId)
  }

  handleStateChange = (event: YouTubePlayerEvent) => {
    if (!this.isMounted || !this.isReady || event.target !== this.player) return
    if (event.data === VIDEO_CUED && this.cuePending) {
      // cueVideoById is asynchronous. A previous cue may finish after replacement.
      if (new URL(this.player.getVideoUrl()).searchParams.get('v') !== this.props.videoId) return
      this.cuePending = false
      if (this.props.isActive !== false && this.props.isPlaying) this.updateIsPlaying()
      return
    }
    if (this.props.isActive === false || this.cuePending) {
      if (event.data === window.YT?.PlayerState.PLAYING) this.player.pauseVideo()
      return
    }
    if (event.data === window.YT?.PlayerState.PLAYING) {
      this.awaitingPreparedStart = false
      this.awaitingPlayback = false
      this.setState({ autoplayBlocked: false })
      this.props.onPlay()
      this.props.onStatus({ isPlaying: true })
      this.startStatusUpdates()
    } else if (event.data === window.YT?.PlayerState.PAUSED) {
      // A previous video's pause can arrive while loadVideoById starts the next one.
      if (!this.awaitingPlayback && !this.awaitingPreparedStart) this.props.onStatus({ isPlaying: false })
      this.stopStatusUpdates()
    } else {
      this.stopStatusUpdates()
    }

    if (event.data === window.YT?.PlayerState.ENDED && !this.awaitingPreparedStart) this.props.onEnd()
  }

  handleAutoplayBlocked = (event: Pick<YouTubePlayerEvent, 'target'>) => {
    if (!this.isMounted || !this.isReady || event.target !== this.player || this.props.isActive === false) return
    this.awaitingPlayback = false
    this.stopStatusUpdates()
    this.setState({ autoplayBlocked: true })
    // A browser permission block is recoverable; do not fail or skip this song.
    this.props.onStatus({ isPlaying: false })
  }

  retryPlayback = () => {
    if (!this.isMounted || !this.isReady || !this.player || this.props.isActive === false) return
    this.awaitingPlayback = true
    // Keep playVideo synchronous with the local click/keyboard gesture.
    this.player.playVideo()
  }

  seekForDevelopment = (target: 'end' | 'forward'): string | undefined => {
    if (process.env.NODE_ENV !== 'development' || process.env.DEV_PLAYER_TOOLS !== 'true') return
    if (!this.isMounted || !this.isReady || !this.player || this.awaitingPlayback || this.props.isActive === false) {
      return 'Esperando al video… Vuelve a intentarlo cuando esté listo.'
    }
    const duration = this.player.getDuration()
    const position = this.player.getCurrentTime()
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) {
      return 'Esperando al video… Reproduce la canción y vuelve a intentarlo.'
    }
    // Leave a real playback tail: only YouTube's ENDED event advances the queue.
    const seconds = target === 'end' ? Math.max(0, duration - 5) : Math.max(0, Math.min(position + 30, duration - 1))
    this.player.seekTo(seconds, true)
    if (!this.props.isPlaying) this.player.pauseVideo()
    return this.props.isPlaying ? 'Salto aplicado. La canción terminará normalmente.' : 'Salto aplicado. Pulsa Reproducir para continuar.'
  }

  handleError = (event: YouTubePlayerEvent) => {
    if (!this.isMounted || event.target !== this.player) return
    const messages: Record<number, string> = {
      2: 'El identificador del video de YouTube no es válido',
      5: 'No se pudo reproducir el video de YouTube en HTML5',
      100: 'El video de YouTube no está disponible o fue eliminado',
      101: 'El propietario del video no permite reproducirlo aquí',
      150: 'El propietario del video no permite reproducirlo aquí',
    }
    this.stopStatusUpdates()
    this.reportError(`${messages[event.data] ?? 'No se pudo reproducir el video de YouTube'} (código ${event.data})`, {
      category: 'iframe',
      code: event.data,
    })
  }

  reportError = (...error: Parameters<YouTubePlayerProps['onError']>) => {
    // Preparation belongs to the upcoming item, not the still-current queue item.
    if (this.props.isActive === false) this.preparationError = error
    else this.props.onError(...error)
  }

  updateIsPlaying = () => {
    if (!this.player || !this.isReady) return
    if (this.props.isPlaying) {
      if (!this.cuePending) this.player.playVideo()
    } else this.player.pauseVideo()
  }

  updateVolume = () => {
    if (!this.isReady) return
    this.player?.setVolume(Math.round(Math.min(Math.max(this.props.volume, 0), 1) * 100))
  }

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
        data-youtube-mode={this.props.isActive === false ? 'preparing' : 'active'}
        data-youtube-video-id={this.props.videoId}
        style={{ width: this.props.width, height: this.props.height, display: this.props.isActive === false ? 'none' : undefined }}
      >
        <div className={styles.surface} ref={this.container} />
        {this.state.autoplayBlocked && (this.props.showAutoplayRecovery ?? this.props.controls !== 0) && (
          <div className={styles.notice} role='status'>
            <p>El navegador bloqueó el inicio de YouTube. Pulse Reproducir aquí para continuar con esta canción.</p>
            <Button variant='primary' onClick={this.retryPlayback}>Reproducir aquí</Button>
          </div>
        )}
      </div>
    )
  }
}

export default YouTubePlayer
