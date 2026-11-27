import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BirthdayAsset, BirthdayPhase } from 'shared/birthdays'
import { birthdayUrl } from './api'
import styles from '../../routes/Player/components/Birthday/BirthdayScene.css'

export default function BirthdayPresentation ({ name, video, phase = 'intro', playing = true, staged = false, onVideoReady, onVideoError }: { name: string, video?: Pick<BirthdayAsset, 'id' | 'url'>, phase?: BirthdayPhase, playing?: boolean, staged?: boolean, onVideoReady?(): void, onVideoError?(): void }) {
  const [failed, setFailed] = useState(false)
  const [videoRatio, setVideoRatio] = useState(16 / 9)
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const element = useRef<HTMLVideoElement>(null)
  const composition = useRef<HTMLDivElement>(null)
  const greeting = useRef<HTMLParagraphElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const entered = useRef([false, false])
  const entrances = useRef<Animation[]>([])
  const showName = phase !== 'prelude' && phase !== 'intro'
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    preference.addEventListener('change', update)
    return () => {
      preference.removeEventListener('change', update)
      entrances.current.forEach(animation => animation.cancel())
      entrances.current = []
      entered.current = [false, false]
    }
  }, [])
  useLayoutEffect(() => {
    if (reducedMotion) entrances.current.forEach(animation => animation.cancel())
    if (!playing) {
      entrances.current.forEach((animation) => {
        if (animation.playState === 'running') animation.pause()
      })
      return
    }
    for (const [index, target] of [greeting.current, heading.current].entries()) {
      if (!target || entered.current[index] || (index === 1 && !showName)) continue
      entered.current[index] = true
      if (!reducedMotion) entrances.current.push(target.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2000, easing: 'ease-out', fill: 'both' }))
    }
    entrances.current.forEach((animation) => {
      if (animation.playState === 'paused') animation.play()
    })
  }, [playing, reducedMotion, showName, phase])
  useLayoutEffect(() => {
    const title = heading.current
    const container = composition.current
    if (!title || !container) return
    const fit = () => {
      title.style.fontSize = ''
      let maximum = Number.parseFloat(getComputedStyle(title).fontSize)
      let minimum = Math.min(1, maximum)
      // Measure the actual name/font instead of truncating or guessing by length.
      while (maximum - minimum > 0.5) {
        const size = (minimum + maximum) / 2
        title.style.fontSize = `${size}px`
        if (title.scrollHeight <= Number.parseFloat(getComputedStyle(title).lineHeight) * 2 + 1) minimum = size
        else maximum = size
      }
      title.style.fontSize = `${minimum}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    return () => observer.disconnect()
  }, [name, showName])
  useEffect(() => {
    const current = element.current
    if (playing && !reducedMotion) void current?.play().catch(() => {})
    else current?.pause()
    return () => current?.pause()
  }, [playing, video?.id, reducedMotion])
  return (
    <section className={styles.scene} data-phase={phase} aria-hidden={staged || undefined} aria-label={`Cumpleaños de ${name}`} style={{ '--birthday-video-ratio': videoRatio, 'visibility': staged ? 'hidden' : undefined } as React.CSSProperties}>
      <div ref={composition} className={styles.composition}>
        {video && !failed && (
          <video
            ref={element}
            muted
            autoPlay={playing && !reducedMotion}
            preload='auto'
            loop
            playsInline
            src={birthdayUrl(video.url)}
            onLoadedData={onVideoReady}
            onLoadedMetadata={(event) => {
              const { videoWidth, videoHeight } = event.currentTarget
              if (videoWidth && videoHeight) setVideoRatio(videoWidth / videoHeight)
            }}
            onError={() => {
              setFailed(true)
              onVideoError?.()
            }}
          />
        )}
        {phase !== 'prelude' && (
          <div className={styles.recognition}>
            <p ref={greeting}>
              <span aria-hidden='true'>🎂 </span>
              ¡Feliz cumpleaños!
            </p>
            <h1 ref={heading} style={{ visibility: showName ? 'visible' : 'hidden' }}>{name}</h1>
          </div>
        )}
      </div>
    </section>
  )
}
