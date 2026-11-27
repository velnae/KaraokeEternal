import React, { useEffect, useState } from 'react'
import TransitionBackground from 'components/TransitionBackground/TransitionBackground'
import type { TransitionVideoBackground } from 'shared/transitionVideo'
import styles from './PlayerTransitionScene.css'
const EXIT_DURATION_MS = 1500

export default function PlayerTransitionScene ({ background, playing, sceneId, exiting = false, visibility, onBackgroundReady, onExited, children }: {
  background: TransitionVideoBackground | null
  playing: boolean
  sceneId: string
  exiting?: boolean
  visibility?: 'warmup' | 'preroll'
  onBackgroundReady?: (ready: boolean) => void
  onExited?: () => void
  children: React.ReactNode
}) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    onBackgroundReady?.(ready)
  }, [onBackgroundReady, ready])
  const visible = !visibility || (visibility === 'preroll' && ready)
  const [enteredScene, setEnteredScene] = useState<string | null>(() => playing && visible ? sceneId : null)
  // Remember the first play so pausing freezes, rather than resets, the entrance.
  if (playing && visible && enteredScene !== sceneId) setEnteredScene(sceneId)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!exiting) return
    // Reduced motion and interrupted CSS transitions may not emit transitionend.
    const timer = setTimeout(() => onExited?.(), reducedMotion ? 0 : EXIT_DURATION_MS + 100)
    return () => clearTimeout(timer)
  }, [exiting, onExited, reducedMotion])
  return (
    <div
      className={styles.scene}
      data-testid='transition-scene'
      data-scene-id={sceneId}
      data-exiting={exiting}
      data-preroll={visibility === 'preroll'}
      data-hidden={!visible}
      aria-hidden={!visible || undefined}
      data-playing={playing}
      data-scene-entered={enteredScene === sceneId}
      style={{ '--scene-exit-duration': `${EXIT_DURATION_MS}ms` } as React.CSSProperties}
      onTransitionEnd={(event) => {
        if (exiting && event.target === event.currentTarget && event.propertyName === 'opacity') onExited?.()
      }}
    >
      <TransitionBackground className={styles.frame} resource={background?.resource ?? null} dimOpacity={background?.dimOpacity ?? 0.55} playing={playing && !reducedMotion} onVisualReady={setReady}>
        {children}
      </TransitionBackground>
    </div>
  )
}
