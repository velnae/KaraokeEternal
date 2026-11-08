import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import Icon from 'components/Icon/Icon'
import type { ClientBranding } from 'shared/branding'
import { defaultPlayerDisplay, isDisplayColor, type PlayerDisplaySettings } from 'shared/playerDisplay'
import type { RequestIntent } from 'shared/requestIntent'
import { displayForeground, displayLayout, type DisplayViewport } from './layout'
import styles from './PlayerDisplayOverlay.css'

interface Props {
  branding: ClientBranding
  settings: PlayerDisplaySettings
  viewport: DisplayViewport
  intent?: RequestIntent
  isPlaying: boolean
}

const PlayerDisplayOverlay = ({ branding, settings, viewport, intent, isPlaying }: Props) => {
  const { logo, announcement: a } = settings
  const [failedLogo, setFailedLogo] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [fitting, setFitting] = useState({ settings, width: viewport.width, height: viewport.height, scale: 1 })
  const fit = fitting.settings === settings && fitting.width === viewport.width && fitting.height === viewport.height ? fitting.scale : 1
  const panel = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const announce = a.enabled && intent === 'LISTEN' && a.messages.length > 0
  const layout = displayLayout(settings, viewport)
  const geometry = layout.announcement
  const color = isDisplayColor(a.backgroundColor) ? a.backgroundColor : defaultPlayerDisplay.announcement.backgroundColor
  const foreground = isDisplayColor(a.textColor) ? a.textColor : displayForeground(color)
  const rgb = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)).join(',')
  const panelStyle = {
    left: geometry.left, width: geometry.width,
    [a.position.startsWith('top') ? 'top' : 'bottom']: geometry.inset,
    maxHeight: Math.max(1, viewport.height - geometry.inset * 2),
    padding: geometry.padding * fit, gap: geometry.gap * fit,
    borderWidth: (Number.isFinite(a.borderWidth) ? a.borderWidth : 1) * layout.scale,
    borderColor: isDisplayColor(a.borderColor) ? a.borderColor : defaultPlayerDisplay.announcement.borderColor,
    borderRadius: (Number.isFinite(a.borderRadius) ? a.borderRadius : 14) * layout.scale,
    backgroundColor: `rgba(${rgb},${(Number.isFinite(a.backgroundOpacity) ? a.backgroundOpacity : 88) / 100})`, color: foreground,
    ...{
      '--title-size': `${Math.max(14, geometry.titleSize * fit)}px`, '--text-size': `${Math.max(12, geometry.textSize * fit)}px`, '--icon-size': `${geometry.iconSize}px`,
      '--icon-color': foreground === '#030509' ? '#164c52' : 'var(--cyan)',
    },
  } as React.CSSProperties

  // All messages share a grid cell. Fit its largest content once, keeping rotation stable.
  useEffect(() => {
    if (!announce || !panel.current || !content.current) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const element = panel.current
        if (element && element.scrollHeight > element.clientHeight + 1) {
          const ratio = element.clientHeight / element.scrollHeight * 0.97
          setFitting(previous => ({
            settings, width: viewport.width, height: viewport.height,
            scale: Math.max(0.05, (previous.settings === settings && previous.width === viewport.width && previous.height === viewport.height ? previous.scale : 1) * ratio),
          }))
        }
      })
    })
    observer.observe(panel.current)
    observer.observe(content.current)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [announce, settings, viewport.width, viewport.height])

  useEffect(() => {
    if (!announce || !isPlaying || a.messages.length < 2) return
    const seconds = Number.isFinite(a.intervalSeconds) ? Math.max(5, a.intervalSeconds) : 15
    const timer = setInterval(() => setIndex(value => (value + 1) % a.messages.length), seconds * 1000)
    return () => clearInterval(timer)
  }, [announce, isPlaying, a.messages, a.intervalSeconds])

  return (
    <div className={styles.container} data-testid='player-display-overlay'>
      {logo.enabled && branding.logoSrc && failedLogo !== branding.logoSrc && (
        <img
          className={styles.logo}
          style={{ ...layout.logo, opacity: (Number.isFinite(logo.opacity) ? logo.opacity : 100) / 100, objectPosition: logo.position.replace('-', ' ') }}
          src={branding.logoSrc}
          alt={branding.name ? `Logo de ${branding.name}` : 'Logo del local'}
          onError={() => setFailedLogo(branding.logoSrc)}
        />
      )}
      {announce && (
        <section
          ref={panel}
          className={clsx(styles.announcement, a.alignment === 'center' && styles.centered, a.shadow && styles.shadow)}
          style={panelStyle}
          aria-label='Comunicados del local'
        >
          {a.showIcon && <Icon icon='QR_CODE' className={styles.icon} />}
          <div ref={content} className={styles.messages}>
            {a.messages.map((message, position) => (
              <div key={position} className={clsx(styles.message, position === index % a.messages.length && styles.current)} aria-hidden={position !== index % a.messages.length}>
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

export default PlayerDisplayOverlay
