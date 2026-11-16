import React from 'react'
import { playerLogoImagePath } from 'shared/playerLogo'
import styles from './KaraokeCallPilot.css'

export default function KaraokeMascot ({ imageId, fallback = '' }: { imageId?: string | null, fallback?: string }) {
  if (!imageId && !fallback) return null
  const url = (poster: boolean) => imageId ? new URL(playerLogoImagePath(imageId, poster), document.baseURI).href : fallback
  return (
    <picture className={styles.mascot} data-testid='karaoke-mascot'>
      <source media='(prefers-reduced-motion: reduce)' srcSet={url(true)} />
      <img src={url(false)} alt='Il Gatto' />
    </picture>
  )
}
