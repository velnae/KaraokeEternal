import React, { useEffect, useRef, useState } from 'react'
import type { ResolvedSceneCue } from 'shared/eventScenes'
import styles from './Scenes.css'

export default function SceneBackgrounds ({ cues, elapsedMs, playing, onError }: { cues: ResolvedSceneCue[], elapsedMs: number, playing: boolean, onError?: () => void }) {
  const [failed, setFailed] = useState<string[]>([])
  const [previousPlaying, setPreviousPlaying] = useState(playing)
  if (previousPlaying !== playing) {
    setPreviousPlaying(playing)
    if (playing) setFailed([])
  }
  const cue = cues.filter(cue => cue.lane === 'background' && cue.resource?.url && !failed.includes(`${cue.id}:${cue.resource.url}`) && elapsedMs >= cue.startMs && elapsedMs < cue.endMs).slice(-1)[0]
  const video = useRef<HTMLVideoElement>(null)
  const url = cue?.resource?.url
  const startMs = cue?.startMs ?? 0
  const durationMs = cue?.resource?.durationMs ?? 1000
  useEffect(() => {
    const node = video.current
    if (!node || !url) return
    const time = Math.max(0, (elapsedMs - startMs) / 1000) % Math.max(0.1, durationMs / 1000)
    if (node.readyState > 0 && Math.abs(node.currentTime - time) > 0.5) node.currentTime = time
    if (playing && node.paused) void node.play().catch(() => {})
    if (!playing) node.pause()
  }, [url, startMs, durationMs, elapsedMs, playing])
  useEffect(() => {
    const node = video.current
    if (node && url) node.src = new URL(url, document.baseURI).href
    return () => {
      node?.pause()
      node?.removeAttribute('src')
      node?.load()
    }
  }, [cue?.id, url])
  if (!cue?.resource) return null
  const progress = cue.fadeMs > 0 ? Math.max(0, Math.min(1, (elapsedMs - cue.startMs) / cue.fadeMs, (cue.endMs - elapsedMs) / cue.fadeMs)) : 1
  return (
    <div className={styles.sceneBackground} data-background-cue={cue.id} style={{ opacity: cue.animation === 'none' ? 1 : progress, transform: cue.animation === 'slide' ? `translateY(${(1 - progress) * 12}px)` : undefined }}>
      {cue.resource.posterUrl && <img src={new URL(cue.resource.posterUrl, document.baseURI).href} alt='' />}
      <video
        ref={video}
        key={`${cue.id}:${cue.resource.url}`}
        src={new URL(cue.resource.url!, document.baseURI).href}
        poster={cue.resource.posterUrl ? new URL(cue.resource.posterUrl, document.baseURI).href : undefined}
        muted
        loop
        playsInline
        preload='auto'
        autoPlay={playing}
        data-media-role='transition-background'
        onLoadedMetadata={(event) => {
          const node = event.currentTarget
          node.currentTime = Math.max(0, (elapsedMs - cue.startMs) / 1000) % Math.max(0.1, cue.resource!.durationMs / 1000)
        }}
        onError={() => {
          setFailed(previous => [...previous, `${cue.id}:${cue.resource?.url}`])
          onError?.()
        }}
      />
      <div style={{ background: `rgba(0,0,0,${cue.resource.dimOpacity ?? 0.3})` }} />
    </div>
  )
}
