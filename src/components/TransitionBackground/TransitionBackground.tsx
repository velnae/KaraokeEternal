import React, { useEffect, useRef, useState } from 'react'
import type { TransitionVideo } from 'shared/transitionVideo'
import { transitionVideoUrl } from 'lib/transitionVideoApi'
import styles from './TransitionBackground.css'

export type BackgroundPlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'blocked' | 'failed'
interface Props {
  transparent?: boolean
  className?: string
  resource: TransitionVideo | null
  dimOpacity: number
  playing: boolean
  children: React.ReactNode
  onPlaybackStateChange?: (state: BackgroundPlaybackState) => void
}

export default function TransitionBackground (props: Props) {
  return <Background {...props} />
}

function Background ({ resource, dimOpacity, playing, children, onPlaybackStateChange, className = '', transparent = false }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const pendingFrame = useRef<number | null>(null)
  const [status, setStatus] = useState<BackgroundPlaybackState>(playing ? 'loading' : 'idle')
  const [previousPlaying, setPreviousPlaying] = useState(playing)
  const [posterFailed, setPosterFailed] = useState(false)
  const [posterReady, setPosterReady] = useState(false)
  const [hasFrame, setHasFrame] = useState(false)
  const source = resource?.state === 'ready' && resource.videoUrl ? transitionVideoUrl(resource.videoUrl) : ''
  const poster = resource?.posterUrl ? transitionVideoUrl(resource.posterUrl) : ''
  const identity = `${resource?.id}:${resource?.checksum}:${resource?.videoUrl}`
  const [resourceKey, setResourceKey] = useState(identity)
  // Reset media readiness without remounting the foreground presentation.
  if (resourceKey !== identity) {
    setResourceKey(identity)
    setHasFrame(false)
    setPosterFailed(false)
    setPosterReady(false)
    setStatus(playing ? 'loading' : 'idle')
  }
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
      if (pendingFrame.current !== null) element.cancelVideoFrameCallback(pendingFrame.current)
      pendingFrame.current = null
      // Restore src in setup as well: StrictMode replays cleanup without recreating
      // the DOM element, and removing it here cancels abandoned range requests.
      element.pause()
      element.removeAttribute('src')
      element.load()
    }
  }, [source, resourceKey])

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
  }, [playing, source, resourceKey, onPlaybackStateChange])

  useEffect(() => {
    onPlaybackStateChange?.(displayStatus)
  }, [displayStatus, onPlaybackStateChange])

  const revealFrame = () => {
    const element = video.current!
    if (!element.requestVideoFrameCallback) {
      setHasFrame(true)
    } else if (pendingFrame.current === null) {
      pendingFrame.current = element.requestVideoFrameCallback(() => {
        pendingFrame.current = null
        if (video.current === element && element.readyState >= 2) setHasFrame(true)
      })
    }
  }

  return (
    <div className={`${styles.background} ${className}`} data-transparent={transparent} data-playback={displayStatus} data-video-visible={hasFrame && displayStatus !== 'failed' && displayStatus !== 'blocked'} data-poster-ready={posterReady} data-resource-id={resource?.id}>
      {poster && !posterFailed && <img key={resourceKey} className={`${styles.media} ${styles.poster}`} src={poster} alt='' aria-hidden='true' onLoad={() => setPosterReady(true)} onError={() => setPosterFailed(true)} />}
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
        onLoadedData={revealFrame}
        onEmptied={() => {
          if (pendingFrame.current !== null) video.current?.cancelVideoFrameCallback(pendingFrame.current)
          pendingFrame.current = null
          setHasFrame(false)
        }}
        onPlay={() => {
          if (playing && !video.current?.paused) setStatus('loading')
        }}
        onPause={() => {
          if (video.current?.paused) setStatus(previous => previous === 'failed' || previous === 'blocked' ? previous : 'paused')
        }}
        onPlaying={() => {
          if (playing && !video.current?.paused) {
            setStatus('playing')
            if (!hasFrame) revealFrame()
          }
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
