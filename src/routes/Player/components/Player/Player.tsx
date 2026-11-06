import React from 'react'
import CDGPlayer from './CDGPlayer/CDGPlayer'
import MP4Player from './MP4Player/MP4Player'
import MP4AlphaPlayer from './MP4Player/MP4AlphaPlayer'
import YouTubePlayer from './YouTubePlayer/YouTubePlayer'
import { selectPlayerKind } from './playerSelection'
import { type PlayerState } from '../../modules/player'
import { type PlayerVisualizerState } from '../../modules/playerVisualizer'
import type { MediaType } from 'shared/types'
import type { SongSource } from 'shared/queueLifecycle'

const PlayerVisualizer = React.lazy(() => import('./PlayerVisualizer/PlayerVisualizer'))

interface PlayerProps {
  cdgAlpha: number
  cdgSize: number
  isPlaying: boolean
  isVisible: boolean
  isReplayGainEnabled: boolean
  isVideoKeyingEnabled: boolean
  isWebGLSupported: boolean
  externalId: string | null
  mediaId: number | null
  mediaKey: number | null
  mediaReplayKey?: number
  mediaType?: MediaType | null
  mp4Alpha: number
  rgTrackGain?: number
  rgTrackPeak?: number
  source?: SongSource
  visualizer: PlayerVisualizerState
  volume: number
  width: number
  height: number
  // media events
  onEnd(): void
  onError(error: string, diagnostic?: { category: 'iframe' | 'api-load', code?: number }): void
  onLoad(): void
  onPlay(): void
  onStatus(status: Partial<PlayerState>): void
}

interface State {
  visualizerAudioSourceNode: MediaElementAudioSourceNode | null
}

class Player extends React.PureComponent<PlayerProps> {
  audioCtx: AudioContext | null = null
  audioGainNode: GainNode | null = null
  audioSourceNode: MediaElementAudioSourceNode | null = null
  audioSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()
  audioLifecycle = 0
  isFetching = false // internal

  state: State = {
    visualizerAudioSourceNode: null,
  }

  componentDidMount () {
    // StrictMode immediately remounts the same instance and media element.
    // Keep its source/context association alive across that synchronous cycle.
    this.audioLifecycle++
    this.updateVolume()
  }

  ensureAudioContext = () => {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      this.audioCtx = new window.AudioContext()
      this.audioGainNode = this.audioCtx.createGain()
      this.audioGainNode.connect(this.audioCtx.destination)
      this.audioSources = new WeakMap()
    }
  }

  componentDidUpdate (prevProps: PlayerProps) {
    // YouTube owns its audio output. An idle local graph can still hold the
    // device open, especially with older Windows audio drivers.
    if (this.props.source === 'YOUTUBE' && this.audioCtx) {
      this.releaseAudioContext()
      this.setState({ visualizerAudioSourceNode: null })
    }

    // may have been suspended by browser if no user interaction yet
    if (this.props.isPlaying && !prevProps.isPlaying) {
      this.resumeAudioContext()
    }

    // prevent applying next song's RG vals prematurely
    if (this.props.mediaKey !== prevProps.mediaKey) {
      this.isFetching = true
    }

    // don't change volume if we know we're changing songs
    if (!this.isFetching && (prevProps.volume !== this.props.volume
      || prevProps.rgTrackGain !== this.props.rgTrackGain
      || prevProps.rgTrackPeak !== this.props.rgTrackPeak
      || prevProps.isReplayGainEnabled !== this.props.isReplayGainEnabled)) {
      this.updateVolume()
    }
  }

  resumeAudioContext = () => {
    const context = this.audioCtx
    if (this.props.source !== 'LOCAL' || !this.props.isPlaying || !context || context.state === 'closed' || context.state === 'running') return
    void context.resume().catch((error) => {
      if (this.audioCtx === context && this.props.source === 'LOCAL' && this.props.isPlaying && context.state !== 'closed') {
        this.props.onError(`No se pudo habilitar el audio: ${error.message}`)
      }
    })
  }

  handleAudioElement = (el: HTMLVideoElement | HTMLAudioElement) => {
    if (!el) return
    // Child media mounts run before this parent's componentDidMount.
    this.ensureAudioContext()
    if (this.audioSourceNode?.mediaElement === el) return

    this.audioSourceNode?.disconnect()
    let source = this.audioSources.get(el)
    if (!source) {
      source = this.audioCtx.createMediaElementSource(el)
      this.audioSources.set(el, source)
    }
    this.audioSourceNode = source
    this.audioSourceNode.connect(this.audioGainNode)
    this.updateVolume()
    this.resumeAudioContext()

    // hand back copy of original audio source
    const sourceNodeCopy = this.audioSourceNode
    this.setState({ visualizerAudioSourceNode: sourceNodeCopy })
  }

  componentWillUnmount () {
    const lifecycle = ++this.audioLifecycle
    // Actual route exits release the graph. A StrictMode remount in this same
    // turn cancels disposal; closing then recreating a source for the preserved
    // DOM element is illegal even if the old context has already closed.
    queueMicrotask(() => {
      if (lifecycle !== this.audioLifecycle) return
      this.releaseAudioContext()
    })
  }

  releaseAudioContext = () => {
    const context = this.audioCtx
    this.audioSourceNode?.disconnect()
    this.audioGainNode?.disconnect()
    this.audioSourceNode = null
    this.audioGainNode = null
    this.audioCtx = null
    this.audioSources = new WeakMap()
    if (context && context.state !== 'closed') {
      void context.close().catch((error) => {
        if (context.state !== 'closed') console.error('Could not release music audio context', error)
      })
    }
  }

  handlePlay = () => {
    this.isFetching = false
    this.updateVolume()
    this.props.onPlay()
  }

  updateVolume = () => {
    let vol = this.props.volume
    const { isReplayGainEnabled, rgTrackGain, rgTrackPeak } = this.props

    if (isReplayGainEnabled && typeof rgTrackGain === 'number' && typeof rgTrackPeak === 'number') {
      const gainDb = this.props.rgTrackGain
      const peakDb = 20 * Math.log10(this.props.rgTrackPeak) // linear amplitude factor to dB
      const safeGainDb = (gainDb + peakDb >= 0) ? -0.01 - peakDb : gainDb

      vol = vol * Math.pow(10, safeGainDb / 20) // dB to linear amplitude factor
    }

    if (this.audioCtx && this.audioGainNode) {
      this.audioGainNode.gain.setValueAtTime(vol, this.audioCtx.currentTime)
    }
  }

  render () {
    if (!this.props.isVisible || typeof this.props.mediaKey !== 'number') return null

    const playerKind = selectPlayerKind(
      this.props.source,
      this.props.mediaType,
      this.props.isVideoKeyingEnabled,
    )

    if (playerKind === 'youtube') {
      if (!this.props.externalId) return null

      return (
        <YouTubePlayer
          controls={0}
          showAutoplayRecovery
          height={this.props.height}
          isPlaying={this.props.isPlaying}
          mediaKey={this.props.mediaKey}
          mediaReplayKey={this.props.mediaReplayKey}
          onEnd={this.props.onEnd}
          onError={this.props.onError}
          onLoad={this.props.onLoad}
          onPlay={this.handlePlay}
          onStatus={this.props.onStatus}
          videoId={this.props.externalId}
          volume={this.props.volume}
          width={this.props.width}
        />
      )
    }

    if (typeof this.props.mediaId !== 'number') return null

    const mediaProps = { ...this.props, onAudioElement: this.handleAudioElement, onPlay: this.handlePlay }
    const media = playerKind === 'cdg'
      ? <CDGPlayer {...mediaProps} />
      : playerKind === 'mp4'
        ? <MP4Player {...mediaProps} />
        : playerKind === 'mp4-alpha' ? <MP4AlphaPlayer {...mediaProps} /> : null

    if (!media) {
      this.props.onError(`No hay reproductor para el tipo de archivo multimedia: ${this.props.mediaType}`)
      return null
    }

    const isVisualizerActive = (playerKind === 'cdg' || playerKind === 'mp4-alpha')
      && this.props.isWebGLSupported
      && this.props.visualizer.isEnabled
      && this.state.visualizerAudioSourceNode

    return (
      <>
        {media}
        {isVisualizerActive && (
          <PlayerVisualizer
            audioSourceNode={this.state.visualizerAudioSourceNode}
            isPlaying={this.props.isPlaying}
            onError={this.props.onError}
            presetKey={this.props.visualizer.presetKey}
            sensitivity={this.props.visualizer.sensitivity}
            width={this.props.width}
            height={this.props.height}
          />
        )}
      </>
    )
  }
}

export default Player
