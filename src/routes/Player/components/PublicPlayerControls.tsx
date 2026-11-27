import React, { useCallback, useEffect, useState } from 'react'
import screenfull from 'screenfull'
import Button from 'components/Button/Button'
import { isPlayerFullscreenShortcut, requestPlayerFullscreen } from 'lib/playerFullscreen'
import { localPlay } from '../runtime/localPlay'
import styles from './PublicPlayerControls.css'

export default function PublicPlayerControls ({ showPlay, onPlay = localPlay.start }: { showPlay: boolean, onPlay?: () => void }) {
  const [fullscreen, setFullscreen] = useState(screenfull.isFullscreen)
  const [error, setError] = useState(false)
  const toggle = useCallback(() => {
    setError(false)
    void (screenfull.isFullscreen ? screenfull.exit() : requestPlayerFullscreen()).catch(() => setError(true))
  }, [])
  useEffect(() => {
    if (!screenfull.isEnabled) return
    const change = () => setFullscreen(screenfull.isFullscreen)
    const shortcut = (event: KeyboardEvent) => {
      if (!isPlayerFullscreenShortcut(event) || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return
      event.preventDefault()
      toggle()
    }
    screenfull.on('change', change)
    window.addEventListener('keydown', shortcut)
    return () => {
      screenfull.off('change', change)
      window.removeEventListener('keydown', shortcut)
    }
  }, [toggle])
  return (
    <div className={styles.controls} role='group' aria-label='Controles del reproductor'>
      {showPlay && <Button className={styles.play} variant='primary' icon='PLAY' size={24} onClick={onPlay}>Reproducir</Button>}
      {screenfull.isEnabled && <Button className={styles.fullscreen} icon='FULLSCREEN' size={24} aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} aria-keyshortcuts='Control+Alt+K' onClick={toggle}>
        <span>{fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}</span>
      </Button>}
      {error && <span className={styles.error} role='alert'>No se pudo cambiar la pantalla completa.</span>}
    </div>
  )
}
