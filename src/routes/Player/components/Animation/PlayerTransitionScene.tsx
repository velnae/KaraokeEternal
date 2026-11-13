import React, { useEffect, useState } from 'react'
import TransitionBackground from 'components/TransitionBackground/TransitionBackground'
import type { TransitionVideoBackground } from 'shared/transitionVideo'
import styles from './PlayerTransitionScene.css'

const EXIT_DURATION_MS = 1000

export default function PlayerTransitionScene ({ background, playing, sceneId, exiting = false, onExited, children, exitMs = EXIT_DURATION_MS, transparent = false, entrance }: {
  entrance?: { animation: 'fade' | 'slide' | 'none', fadeMs: number }
  transparent?: boolean
  exitMs?: number
  background: TransitionVideoBackground | null
  playing: boolean
  sceneId: string
  exiting?: boolean
  onExited?: () => void
  children: React.ReactNode
}) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!exiting) return
    // Reduced motion and interrupted CSS transitions may not emit transitionend.
    const timer = setTimeout(() => onExited?.(), reducedMotion ? 0 : exitMs + 100)
    return () => clearTimeout(timer)
  }, [exiting, onExited, reducedMotion, exitMs])
  return (
    <div
      className={styles.scene}
      data-testid='transition-scene'
      data-scene-id={sceneId}
      data-exiting={exiting}
      data-animation={entrance?.animation ?? 'fade'}
      style={{ '--scene-exit-duration': `${exitMs}ms`, '--scene-enter-duration': `${entrance?.fadeMs ?? 240}ms`, '--scene-media-fade': `${entrance?.fadeMs ?? 220}ms` } as React.CSSProperties}
      onTransitionEnd={(event) => {
        if (exiting && event.target === event.currentTarget && event.propertyName === 'opacity') onExited?.()
      }}
    >
      <TransitionBackground transparent={transparent} className={styles.frame} resource={background?.resource ?? null} dimOpacity={background?.dimOpacity ?? 0.55} playing={playing && !reducedMotion}>
        {children}
      </TransitionBackground>
    </div>
  )
}
