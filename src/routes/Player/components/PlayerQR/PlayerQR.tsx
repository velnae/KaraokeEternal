import React, { useState, useEffect, useRef, useCallback } from 'react'
import clsx from 'clsx'
import { useAppSelector } from 'store/hooks'
import { CSSTransition } from 'react-transition-group'
import { QRCode } from 'react-qrcode-logo'
import type { QueueItem, IRoomPrefs } from 'shared/types'
import styles from './PlayerQR.css'

const MIN_STATIC_MS = 10000 // 10 sec
const MAX_STATIC_MS = 180000 // 3 min

interface PlayerQRProps {
  height: number
  prefs: IRoomPrefs['qr']
  queueItem: QueueItem
}

const PlayerQR = ({ height, prefs, queueItem }: PlayerQRProps) => {
  const ref = useRef<HTMLDivElement>(null)
  const maxTimerID = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastToggleTime = useRef<number>(0)
  const [show, setShow] = useState(true)
  const [alternate, setAlternate] = useState(false)
  const { isPlaying } = useAppSelector(state => state.player)
  const { roomId } = useAppSelector(state => state.user)

  const scheduleNextToggle = useCallback(() => {
    if (maxTimerID.current) {
      clearTimeout(maxTimerID.current)
      maxTimerID.current = null
    }

    // wait for current song to end?
    if (isPlaying) return

    const now = Date.now()
    const timeSinceLastToggle = now - lastToggleTime.current
    const timeUntilMax = Math.max(MAX_STATIC_MS - timeSinceLastToggle, 0)

    maxTimerID.current = setTimeout(() => {
      setShow(false)
    }, timeUntilMax)
  }, [isPlaying])

  useEffect(() => {
    lastToggleTime.current = Date.now()
  }, [])

  useEffect(() => {
    scheduleNextToggle()

    return () => {
      if (maxTimerID.current) clearTimeout(maxTimerID.current)
    }
  }, [scheduleNextToggle])

  useEffect(() => {
    const now = Date.now()
    const timeSinceLastToggle = now - lastToggleTime.current

    if (timeSinceLastToggle > MIN_STATIC_MS) {
      const timeout = setTimeout(() => setShow(false), 0)
      return () => clearTimeout(timeout)
    }
  }, [queueItem?.queueId])

  const handleTransitionEnd = () => {
    if (!show) {
      setAlternate(prev => !prev)
      setShow(true) // trigger enter transition
      lastToggleTime.current = Date.now()

      scheduleNextToggle()
    }
  }

  const url = new URL(window.location.href)
  url.pathname = url.pathname.replace(/\/player$/, '')
  url.searchParams.append('roomId', String(roomId))

  if (prefs.password) {
    url.searchParams.append('password', btoa(prefs.password))
  }

  const size = Math.round(height * (0.05 + (prefs.size ?? 0.5) / 5)) // min: 5vh, max: 25vh
  const quietZoneSize = 5 + (10 * (prefs.size ?? 0.5)) // min: 5px, max: 15px

  return (
    <CSSTransition
      in={show}
      nodeRef={ref}
      timeout={300}
      onExited={handleTransitionEnd}
      classNames={{
        enterActive: styles.enterActive,
        exitActive: styles.exitActive,
      }}
    >
      <div
        className={clsx(styles.container, alternate && styles.alternate)}
        ref={ref}
        aria-label='Código QR para entrar a la sala'
      >
        <QRCode
          value={url.href}
          ecLevel='M'
          size={size}
          quietZone={quietZoneSize}
          style={{ opacity: prefs.opacity ?? 0.625 }}
          qrStyle='dots'
        />
        <span className={styles.label}>Entrar a la sala</span>
      </div>
    </CSSTransition>
  )
}

export default PlayerQR
