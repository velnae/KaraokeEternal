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

class Player extends React.Component<PlayerProps> {
  audioCtx: AudioContext | null = null
  audioGainNode: GainNode | null = null
  audioSourceNode: MediaElementAudioSourceNode | null = null
  isFetching = false // internal

  state: State = {
    visualizerAudioSourceNode: null,
  }

  componentDidMount () {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      this.audioGainNode = this.audioCtx.createGain()
    }

    this.updateVolume()
  }

  componentDidUpdate (prevProps: PlayerProps) {
    // may have been suspended by browser if no user interaction yet
    if (this.props.isPlaying && !prevProps.isPlaying) {
      this.audioCtx?.resume()
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

  handleAudioElement = (el: HTMLVideoElement | HTMLAudioElement) => {
    if (!this.audioCtx || (this.audioSourceNode && this.audioSourceNode.mediaElement === el)) {
      return
    }

    this.audioSourceNode = this.audioCtx.createMediaElementSource(el)
    this.audioSourceNode.connect(this.audioGainNode)
    this.audioGainNode.connect(this.audioCtx.destination)

    // hand back copy of original audio source
    const sourceNodeCopy = this.audioSourceNode
    this.setState({ visualizerAudioSourceNode: sourceNodeCopy })
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

    let PlayerComponent

    if (playerKind === 'cdg') PlayerComponent = CDGPlayer
    else if (playerKind === 'mp4') PlayerComponent = MP4Player
    else if (playerKind === 'mp4-alpha') PlayerComponent = MP4AlphaPlayer

    if (typeof PlayerComponent === 'undefined') {
      this.props.onError(`No player for mediaType: ${this.props.mediaType}`)
      return null
    }

    const isVisualizerActive = (playerKind === 'cdg' || playerKind === 'mp4-alpha')
      && this.props.isWebGLSupported
      && this.props.visualizer.isEnabled
      && this.state.visualizerAudioSourceNode

    return (
      <>
        <PlayerComponent
          {...this.props}
          onAudioElement={this.handleAudioElement}
          onPlay={this.handlePlay}
        />
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
