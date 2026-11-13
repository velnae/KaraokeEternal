import React, { useEffect, useRef, useState } from 'react'
import type { BirthdayAsset } from 'shared/birthdays'
import { birthdayUrl } from './api'
import styles from '../../routes/Player/components/Birthday/BirthdayScene.css'
import { resolveSceneVisuals, type EventScene, type SceneResources } from 'shared/eventScenes'
import SceneLayers from 'components/Animation/Scenes/SceneLayers'
import SceneBackgrounds from 'components/Animation/Scenes/SceneBackgrounds'
import BirthdayRecognition from './BirthdayRecognition'
import type SceneRun from 'routes/Player/components/Animation/SceneRun'

export default function BirthdayPresentation ({ name, video, playing = true, onVideoError, scene, assets = [], startedAt, mediaEndMs = 0, resources, run }: { name: string, video?: BirthdayAsset, playing?: boolean, onVideoError?(): void, scene?: EventScene | null, assets?: BirthdayAsset[], startedAt?: number, mediaEndMs?: number, resources?: SceneResources, run?: SceneRun | null }) {
  const [failed, setFailed] = useState(false)
  const element = useRef<HTMLVideoElement>(null)
  const began = useRef(0)
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (!scene || !playing) return
    if (!began.current) began.current = performance.now()
    const tick = () => setTime(performance.now() - (startedAt ?? began.current))
    tick()
    const timer = setInterval(tick, 50)
    return () => clearInterval(timer)
  }, [scene, playing, startedAt])
  const cues = scene ? resolveSceneVisuals(scene, { ...(resources ?? Object.fromEntries(assets.map(asset => [asset.kind === 'video' ? 'background' : asset.kind, asset]))), ...run?.resources }, run?.mediaEndMs() ?? mediaEndMs, run?.timing) : []
  const backgroundCue = cues.find(cue => cue.lane === 'background')
  const backgroundActive = !scene || cues.some(cue => cue.lane === 'background' && time >= cue.startMs && time < cue.endMs)
  useEffect(() => {
    const current = element.current
    if (playing && backgroundActive) void current?.play().catch(() => {})
    else current?.pause()
    return () => current?.pause()
  }, [playing, video?.id, backgroundActive])
  const recognition = <BirthdayRecognition name={name} />
  return (
    <section className={styles.scene} aria-label={`Cumpleaños de ${name}`} style={scene && !backgroundActive && time < mediaEndMs ? { background: 'transparent' } : undefined}>
      {scene && <SceneBackgrounds cues={cues} elapsedMs={time} playing={playing} onError={onVideoError} />}
      {!scene && video && !failed && backgroundActive && (
        <video
          ref={element}
          muted
          data-animation={backgroundCue?.animation ?? 'none'}
          style={{ '--birthday-enter-duration': `${backgroundCue?.fadeMs ?? 0}ms` } as React.CSSProperties}
          autoPlay={playing}
          loop
          playsInline
          src={birthdayUrl(video.url)}
          onError={() => {
            setFailed(true)
            onVideoError?.()
          }}
        />
      )}
      {scene ? <SceneLayers cues={cues} elapsedMs={time} values={{ name, table: '', song: '', venue: '' }}>{recognition}</SceneLayers> : recognition}
    </section>
  )
}
