import React, { useEffect, useRef, useState } from 'react'
import type { BirthdayAsset } from 'shared/birthdays'
import { birthdayUrl } from './api'
import styles from '../../routes/Player/components/Birthday/BirthdayScene.css'

export default function BirthdayPresentation ({ name, video, playing = true, onVideoError }: { name: string, video?: BirthdayAsset, playing?: boolean, onVideoError?(): void }) {
  const [failed, setFailed] = useState(false)
  const element = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const current = element.current
    if (playing) void current?.play().catch(() => {})
    else current?.pause()
    return () => current?.pause()
  }, [playing, video?.id])
  return (
    <section className={styles.scene} aria-label={`Cumpleaños de ${name}`}>
      {video && !failed && (
        <video
          ref={element}
          muted
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
      <div className={styles.recognition}>
        <p>¡Feliz cumpleaños!</p>
        <h1>{name}</h1>
      </div>
    </section>
  )
}
