import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import styles from './Logo.css'

interface LogoProps {
  className?: string
  subtitle?: string
}

const Logo = (props: LogoProps) => {
  const subtitle = props.subtitle?.trim() || 'Eternal'
  const subtitleChars = Array.from(subtitle)
  const [isFontLoaded, setIsFontLoaded] = useState(() => {
    // if the font loading API is not supported, we can't wait for it
    return typeof document !== 'undefined' && !document.fonts
  })

  useEffect(() => {
    if (document.fonts) {
      document.fonts.load('1em Beon')
        .then(() => {
          setIsFontLoaded(true)
          return true
        })
        .catch(() => {
          setIsFontLoaded(true)
          return false
        })
    }
  }, [])

  return (
    <div
      className={clsx(styles.container, props.subtitle && styles.customized, props.className)}
      role='img'
      aria-label={`Karaoke ${subtitle}`}
      title={props.subtitle ? `Karaoke ${subtitle}` : undefined}
    >
      <span className={styles.title} aria-hidden='true'>
        Karaoke
        <span className={clsx(styles.eternal, { [styles.eternalVisible]: isFontLoaded })}>
          <span className={styles.subtitleText}>
            {subtitleChars.slice(0, -1).join('')}
            <span className={styles.lastChar}>{subtitleChars[subtitleChars.length - 1]}</span>
          </span>
        </span>
      </span>
    </div>
  )
}

export default Logo
