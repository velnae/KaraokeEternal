import React, { useEffect, useRef, useState } from 'react'
import type { TransitionVideo } from 'shared/transitionVideo'
import { transitionVideoUrl } from 'lib/transitionVideoApi'
import styles from './TransitionBackground.css'

export type BackgroundPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'blocked' | 'failed'
interface Props {
  className?: string
  resource: TransitionVideo | null
  dimOpacity: number
  playing: boolean
  children: React.ReactNode
  onPlaybackStateChange?: (state: BackgroundPlaybackState) => void
}

export default function TransitionBackground (props: Props) {
  const resource = props.resource
  return <Background key={`${resource?.id}:${resource?.checksum}:${resource?.videoUrl}`} {...props} />
}

function Background ({ resource, dimOpacity, playing, children, onPlaybackStateChange, className = '' }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<BackgroundPlaybackState>(playing ? 'loading' : 'idle')
  const [previousPlaying, setPreviousPlaying] = useState(playing)
  const [posterFailed, setPosterFailed] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const source = resource?.state === 'ready' && resource.videoUrl ? transitionVideoUrl(resource.videoUrl) : ''
  const poster = resource?.posterUrl ? transitionVideoUrl(resource.posterUrl) : ''
  // A new explicit attempt must not retain the previous rejection while waiting
  // for native play events. Reset state during render without replacing the video.
  if (previousPlaying !== playing) {
    setPreviousPlaying(playing)
    if (playing) setStatus('loading')
  }
  let displayStatus: BackgroundPlaybackState = status
  if (!source) displayStatus = 'idle'
  else if (status !== 'failed' && status !== 'blocked') {
    if (!playing) displayStatus = 'paused'
    else if (status === 'idle' || status === 'paused') displayStatus = 'loading'
  }

  useEffect(() => {
    const element = video.current!
    element.muted = true
    if (source) element.src = source
    return () => {
      // Restore src in setup as well: StrictMode replays cleanup without recreating
      // the DOM element, and removing it here cancels abandoned range requests.
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
  }, [source])

  useEffect(() => {
    const element = video.current!
    let active = true
    if (playing && source) {
      if (element.error) element.load()
      void element.play().catch(() => {
        if (active) {
          const failure = element.error ? 'failed' : 'blocked'
          setStatus(failure)
          onPlaybackStateChange?.(failure)
        }
      })
    } else {
      element.pause()
    }
    return () => {
      active = false
      element.pause()
    }
  }, [playing, source, onPlaybackStateChange])

  useEffect(() => {
    onPlaybackStateChange?.(displayStatus)
  }, [displayStatus, onPlaybackStateChange])

  return (
    <div className={`${styles.background} ${className}`} data-playback={displayStatus} data-video-visible={displayStatus === 'playing' || (displayStatus === 'paused' && hasFrame)} data-resource-id={resource?.id}>
      {poster && !posterFailed && <img className={styles.media} src={poster} alt='' aria-hidden='true' onError={() => setPosterFailed(true)} />}
      <video
        ref={video}
        className={`${styles.media} ${styles.video}`}
        muted
        playsInline
        loop
        preload='none'
        aria-hidden='true'
        data-media-role='transition-background'
        tabIndex={-1}
        onLoadedData={() => setHasFrame(true)}
        onEmptied={() => setHasFrame(false)}
        onPlay={() => {
          if (playing && !video.current?.paused) setStatus('loading')
        }}
        onPause={() => {
          if (video.current?.paused) setStatus(previous => previous === 'failed' || previous === 'blocked' ? previous : 'paused')
        }}
        onPlaying={() => {
          if (playing && !video.current?.paused) setStatus('playing')
        }}
        onWaiting={() => {
          if (playing && (video.current?.readyState ?? 0) < 3) setStatus('buffering')
        }}
        onStalled={() => {
          if (playing) setStatus('buffering')
        }}
        onError={() => {
          if (video.current?.error) {
            video.current.pause()
            setStatus('failed')
          }
        }}
      />
      <div className={styles.scrim} style={{ opacity: dimOpacity }} aria-hidden='true' />
      <div className={styles.content}>{children}</div>
    </div>
  )
}
