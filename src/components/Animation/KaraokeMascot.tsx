import React, { useState } from 'react'
import { playerLogoImagePath } from 'shared/playerLogo'
import styles from './KaraokeCallPilot.css'

export default function KaraokeMascot ({ imageId, fallback = '', countdown = false }: { imageId?: string | null, fallback?: string, countdown?: boolean }) {
  const [entered, setEntered] = useState(countdown)
  if (countdown && !entered) setEntered(true)
  if (!imageId && !fallback) return null
  const url = (poster: boolean) => imageId ? new URL(playerLogoImagePath(imageId, poster), document.baseURI).href : fallback
  return (
    <picture
      className={styles.mascot}
      data-testid='karaoke-mascot'
      data-entered={entered}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setEntered(true)
      }}
    >
      <source media='(prefers-reduced-motion: reduce)' srcSet={url(true)} />
      <img src={url(false)} alt='Il Gatto' />
    </picture>
  )
}
