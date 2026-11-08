import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import Icon from 'components/Icon/Icon'
import { BRANDING_MESSAGE_INTERVAL_MS, defaultPlayerBranding, getPlayerBranding, isBrandingBackgroundColor, type ClientBranding } from 'shared/branding'
import type { RequestIntent } from 'shared/requestIntent'
import styles from './PlayerBranding.css'

interface PlayerBrandingProps {
  branding: ClientBranding
  intent?: RequestIntent
  isPlaying: boolean
}

const PlayerBranding = ({ branding, intent, isPlaying }: PlayerBrandingProps) => {
  const { showLogo, showAnnouncements, messages, alignment, backgroundColor } = getPlayerBranding(branding.player)
  const [failedLogo, setFailedLogo] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const announce = showAnnouncements && intent === 'LISTEN' && messages.length > 0
  // Incomplete color input stays readable while editing the live preview.
  const color = isBrandingBackgroundColor(backgroundColor) ? backgroundColor.toLowerCase() : defaultPlayerBranding.backgroundColor
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
  const luminance = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, channel) => sum + value * [0.2126, 0.7152, 0.0722][channel], 0)
  const foreground = luminance > 0.179 ? '#030509' : '#f4f7ff'
  const colors = {
    '--announcement-background': `${color}e0`,
    '--announcement-foreground': foreground,
    '--announcement-secondary': color === defaultPlayerBranding.backgroundColor ? 'var(--secondary)' : foreground,
    '--announcement-icon': foreground === '#030509' ? '#164c52' : 'var(--cyan)',
  } as React.CSSProperties

  useEffect(() => {
    if (!announce || !isPlaying || messages.length < 2) return
    const timer = setInterval(() => setIndex(value => (value + 1) % messages.length), BRANDING_MESSAGE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [announce, isPlaying, messages])

  return (
    <div className={styles.container} data-testid='player-branding'>
      {showLogo && branding.logoSrc && failedLogo !== branding.logoSrc && (
        <img
          className={styles.logo}
          src={branding.logoSrc}
          alt={branding.name ? `Logo de ${branding.name}` : 'Logo del local'}
          onError={() => setFailedLogo(branding.logoSrc)}
        />
      )}
      {announce && (
        <section className={clsx(styles.announcement, alignment === 'center' && styles.centered)} style={colors} aria-label='Comunicados del local'>
          <Icon icon='QR_CODE' className={styles.icon} />
          <div className={styles.messages}>
            {messages.map((message, position) => (
              <div
                key={position}
                className={clsx(styles.message, position === index % messages.length && styles.current)}
                aria-hidden={position !== index % messages.length}
              >
                <strong>{message.title}</strong>
                {message.text && <p>{message.text}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default PlayerBranding
