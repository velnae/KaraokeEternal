import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ClientBranding } from 'shared/branding'
import { ANNOUNCEMENT_IMAGE_SCALE_LIMIT, announcementAtTurn, defaultPlayerDisplay, isDisplayColor, pickAnnouncementPhrase, type PlayerDisplaySettings } from 'shared/playerDisplay'
import type { RequestIntent } from 'shared/requestIntent'
import { displayForeground, displayLayout, type DisplayViewport } from './layout'
import styles from './PlayerDisplayOverlay.css'
import PlayerLogo from './PlayerLogo'
import { announcementImageSource } from './announcementImage'

interface Props {
  branding: ClientBranding
  settings: PlayerDisplaySettings
  viewport: DisplayViewport
  intent?: RequestIntent
  isPlaying: boolean
}

const PlayerDisplayOverlay = ({ branding, settings, viewport, intent, isPlaying }: Props) => {
  const { logo, announcement: a } = settings
  const [rotation, setRotation] = useState<{ turn: number, phrase: string | null }>({ turn: 0, phrase: null })
  const { position: currentPosition, phrase, cycleLength } = announcementAtTurn(a, rotation.turn, rotation.phrase)
  const image = a.messages[currentPosition]?.image
  const [failedImages, setFailedImages] = useState<string[]>([])
  const [fitting, setFitting] = useState({ settings, width: viewport.width, height: viewport.height, scale: 1 })
  const fit = fitting.settings === settings && fitting.width === viewport.width && fitting.height === viewport.height ? fitting.scale : 1
  const panel = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const announce = a.enabled && intent === 'LISTEN' && a.messages.length > 0
  const layout = displayLayout(settings, viewport)
  const geometry = layout.announcement
  const imageScale = a.messages[currentPosition]?.imageScale ?? 100
  const imageSize = geometry.iconSize * (Number.isFinite(imageScale) ? Math.max(ANNOUNCEMENT_IMAGE_SCALE_LIMIT[0], Math.min(ANNOUNCEMENT_IMAGE_SCALE_LIMIT[1], imageScale)) : 100) / 100
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
      '--title-size': `${Math.max(14, geometry.titleSize * fit)}px`, '--text-size': `${Math.max(12, geometry.textSize * fit)}px`, '--icon-size': `${imageSize}px`,
      '--image-slot-size': `${geometry.iconSize}px`,
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
        const text = content.current
        if (!element || !text) return
        const style = getComputedStyle(element)
        // Decorative image overflow must never shrink the text or grow its panel.
        const textHeight = text.scrollHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        if (textHeight > element.clientHeight + 1) {
          const ratio = element.clientHeight / textHeight * 0.97
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
  }, [announce, settings, phrase, viewport.width, viewport.height])

  useEffect(() => {
    if (!announce || !isPlaying || cycleLength < 2) return
    const seconds = Number.isFinite(a.intervalSeconds) ? Math.max(5, a.intervalSeconds) : 15
    const timer = setTimeout(() => {
      const turn = rotation.turn + 1
      const next = announcementAtTurn(a, turn, rotation.phrase)
      const phrase = next.position === a.messages.length
        ? pickAnnouncementPhrase(a.phrases, rotation.phrase)
        : rotation.phrase
      setRotation({ turn, phrase })
    }, seconds * 1000)
    return () => clearTimeout(timer)
  }, [announce, isPlaying, cycleLength, a, rotation])

  return (
    <div className={styles.container} data-testid='player-display-overlay'>
      {logo.enabled && (
        <PlayerLogo
          branding={branding}
          logo={logo}
          isPlaying={isPlaying}
          style={{ ...layout.logo, opacity: (Number.isFinite(logo.opacity) ? logo.opacity : 100) / 100, objectPosition: logo.position.replace('-', ' ') }}
        />
      )}
      {announce && (
        <section
          ref={panel}
          className={clsx(styles.announcement, a.alignment === 'center' && styles.centered, a.shadow && styles.shadow)}
          style={panelStyle}
          aria-label='Comunicados del local'
        >
          {image && !failedImages.includes(image) && (
            <span className={styles.imageSlot}>
              <img className={styles.messageImage} src={announcementImageSource(image)} alt='' onError={() => setFailedImages(values => [...values, image])} />
            </span>
          )}
          <div ref={content} className={styles.messages}>
            {a.messages.map((message, position) => (
              <div key={position} className={clsx(styles.message, position === currentPosition && styles.current)} aria-hidden={position !== currentPosition}>
                <strong>{message.title}</strong>
                {message.text && <p>{message.text}</p>}
              </div>
            ))}
            {phrase !== null && (
              <div className={clsx(styles.message, currentPosition === a.messages.length && styles.current)} aria-hidden={currentPosition !== a.messages.length}>
                <p className={styles.phrase}>{phrase}</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

export default PlayerDisplayOverlay
