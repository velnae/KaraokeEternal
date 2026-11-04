import React, { useEffect, useState } from 'react'
import TransitionBackground from 'components/TransitionBackground/TransitionBackground'
import type { TransitionVideoBackground } from 'shared/transitionVideo'
import styles from './PlayerTransitionScene.css'

export default function PlayerTransitionScene ({ background, playing, sceneId, children }: {
  background: TransitionVideoBackground | null
  playing: boolean
  sceneId: string
  children: React.ReactNode
}) {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  return (
    <div className={styles.scene} data-testid='transition-scene' data-scene-id={sceneId}>
      <TransitionBackground className={styles.frame} resource={background?.resource ?? null} dimOpacity={background?.dimOpacity ?? 0.55} playing={playing && !reducedMotion}>
        {children}
      </TransitionBackground>
    </div>
  )
}
