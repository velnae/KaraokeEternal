import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ClientBranding } from 'shared/branding'
import { ANNOUNCEMENT_IMAGE_SCALE_LIMIT, announcementAtTurn, defaultPlayerDisplay, isDisplayColor, pickAnnouncementPhrase, type PlayerDisplaySettings } from 'shared/playerDisplay'
import type { RequestIntent } from 'shared/requestIntent'
import type { GreetingAnnouncement } from 'shared/greetings'
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
  greeting?: GreetingAnnouncement
}

const PlayerDisplayOverlay = ({ branding, settings, viewport, intent, isPlaying, greeting }: Props) => {
  const { logo, announcement: a } = settings
  const greetingId = greeting?.greetingId
  const [rotation, setRotation] = useState<{ position: number | 'greeting' | null, phrase: string | null, greetingId: number | undefined }>({ position: null, phrase: null, greetingId })
  if (rotation.greetingId !== greetingId) {
    const wasShowingGreeting = rotation.greetingId !== undefined && (rotation.position === null || rotation.position === 'greeting')
    setRotation({ ...rotation, greetingId, position: wasShowingGreeting && !greeting ? 0 : rotation.position })
  }
  const { position, phrase, cycleLength } = announcementAtTurn(a, typeof rotation.position === 'number' ? rotation.position : 0, rotation.phrase)
  const showGreeting = !!greeting && (rotation.position === null || rotation.position === 'greeting')
  const currentPosition = showGreeting ? 'greeting' : Number.isFinite(position) ? position : 0
  const image = typeof currentPosition === 'number' ? a.messages[currentPosition]?.image : null
  const advance = useRef(() => {})
  const [failedImages, setFailedImages] = useState<string[]>([])
  const [fitting, setFitting] = useState({ settings, greetingId, width: viewport.width, height: viewport.height, scale: 1 })
  const fit = fitting.settings === settings && fitting.greetingId === greetingId && fitting.width === viewport.width && fitting.height === viewport.height ? fitting.scale : 1
  const panel = useRef<HTMLElement>(null)
  const content = useRef<HTMLDivElement>(null)
  const announce = a.enabled && intent === 'LISTEN' && (a.messages.length > 0 || !!greeting)
  const layout = displayLayout(settings, viewport)
  const geometry = layout.announcement
  const imageScale = typeof currentPosition === 'number' ? a.messages[currentPosition]?.imageScale ?? 100 : 100
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
            settings, greetingId, width: viewport.width, height: viewport.height,
            scale: Math.max(0.05, (previous.settings === settings && previous.greetingId === greetingId && previous.width === viewport.width && previous.height === viewport.height ? previous.scale : 1) * ratio),
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
  }, [announce, settings, phrase, greetingId, viewport.width, viewport.height])

  useLayoutEffect(() => {
    // Refresh the next slot without restarting the timer of an unrelated visible notice.
    advance.current = () => {
      const next = currentPosition === 'greeting' ? 0 : currentPosition + 1
      const position = next >= cycleLength ? greeting ? 'greeting' : 0 : next
      const nextPhrase = cycleLength > a.messages.length && position === a.messages.length
        ? pickAnnouncementPhrase(a.phrases, rotation.phrase)
        : rotation.phrase
      setRotation(previous => ({ ...previous, position, phrase: nextPhrase }))
    }
  }, [greeting, currentPosition, cycleLength, a.messages.length, a.phrases, rotation.phrase])

  const rotates = cycleLength + Number(!!greeting) > 1
  const seconds = Number.isFinite(a.intervalSeconds) ? Math.max(5, a.intervalSeconds) : 15
  useEffect(() => {
    if (!announce || !isPlaying || !rotates) return
    const timer = setTimeout(() => advance.current(), seconds * 1000)
    return () => clearTimeout(timer)
  }, [announce, isPlaying, rotates, seconds, currentPosition])

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
          data-has-greeting={!!greeting}
        >
          {(greeting || (image && !failedImages.includes(image))) && (
            <span className={styles.imageSlot}>
              {showGreeting
                ? (
                    <svg className={clsx(styles.messageImage, styles.greetingIcon)} viewBox='0 0 32 32' aria-hidden='true' data-greeting-icon>
                      <path d='m9 19-3-4a1.7 1.7 0 0 1 2.7-2l3 3.7L8 8.4a1.5 1.5 0 1 1 2.7-1.3l3.5 6.9-2.5-8.4a1.5 1.5 0 1 1 2.9-.9l2.8 8.3-1-7.3a1.5 1.5 0 1 1 3-.4l1.3 9.4 1.6-3.7c.9-2 3.7-.9 3.2 1.1l-1.2 7.1c-.8 4.7-3.3 8.1-7.9 8.1-3.7 0-5.7-2.2-7.4-8.3Z' fill='#ffc662' stroke='#573715' strokeWidth='1.3' strokeLinejoin='round' />
                      <path d='M23 4a8 8 0 0 1 5 5m-3-6a10 10 0 0 1 5 5M3 18a9 9 0 0 0 3 6' fill='none' stroke='currentColor' strokeWidth='1.4' strokeLinecap='round' />
                    </svg>
                  )
                : image && !failedImages.includes(image) && <img className={styles.messageImage} src={announcementImageSource(image)} alt='' onError={() => setFailedImages(values => [...values, image])} />}
            </span>
          )}
          <div ref={content} className={styles.messages}>
            {greeting && (
              <div key={greeting.greetingId} className={clsx(styles.message, showGreeting && styles.current)} aria-hidden={!showGreeting} role='group' aria-label='Saludo' translate='no'>
                <strong>{`«${greeting.message}»`}</strong>
                <p>{`De ${greeting.sender}`}</p>
              </div>
            )}
            {a.messages.map((message, position) => (
              <div key={`notice:${position}`} className={clsx(styles.message, position === currentPosition && styles.current)} aria-hidden={position !== currentPosition}>
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
