import React, { useState } from 'react'
import clsx from 'clsx'
import { avatarAsset, defaultAvatar } from 'shared/avatars'
import styles from './PlayerAvatar.css'

const fallback = avatarAsset(defaultAvatar)

function Portrait ({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  if (fallbackFailed) return null
  const url = failed ? fallback : src
  return <img key={url} src={url} alt='' onError={() => url === fallback ? setFallbackFailed(true) : setFailed(true)} />
}

export default function PlayerAvatar ({ src = fallback, className, light = false }: { src?: string, className: string, light?: boolean }) {
  return <span className={clsx(styles.frame, light && styles.light, className)} aria-hidden='true' data-player-avatar><Portrait key={src} src={src} /></span>
}
