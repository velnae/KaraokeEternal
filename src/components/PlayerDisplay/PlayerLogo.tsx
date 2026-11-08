import React, { useState } from 'react'
import type { ClientBranding } from 'shared/branding'
import type { PlayerDisplaySettings } from 'shared/playerDisplay'
import { resolvePlayerLogo } from 'shared/playerLogo'
import useLogoAnimation from './useLogoAnimation'
import styles from './PlayerDisplayOverlay.css'

interface Props {
  branding: ClientBranding
  logo: PlayerDisplaySettings['logo']
  style: React.CSSProperties
  isPlaying: boolean
}

export default function PlayerLogo ({ branding, logo, style, isPlaying }: Props) {
  const sources = resolvePlayerLogo(logo, branding.logoSrc)
  const url = (value: string) => value ? new URL(value, document.baseURI).href : ''
  const [failed, setFailed] = useState<string[]>([])
  const still = [url(sources.still), url(sources.fallback)].find(source => source && !failed.includes(source))
  const { animatedSource, failAnimation } = useLogoAnimation(logo, url(sources.animated), isPlaying)
  const alt = logo.source === 'custom' ? 'Imagen de pantalla' : branding.name ? `Logo de ${branding.name}` : 'Logo del local'
  return (
    <>
      {still && (
        <img
          data-testid='display-logo-static'
          className={styles.logo}
          style={{ ...style, visibility: animatedSource ? 'hidden' : 'visible' }}
          aria-hidden={!!animatedSource}
          src={still}
          alt={alt}
          onError={() => setFailed(values => [...values, still])}
        />
      )}
      {animatedSource && <img data-testid='display-logo-animation' className={styles.logo} style={style} src={animatedSource} alt={alt} onError={failAnimation} />}
    </>
  )
}
