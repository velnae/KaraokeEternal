import React, { useCallback, useEffect, useState } from 'react'
import screenfull from 'screenfull'
import Button from 'components/Button/Button'
import { isPlayerFullscreenShortcut, requestPlayerFullscreen } from 'lib/playerFullscreen'
import { localPlay } from '../runtime/localPlay'
import styles from './PublicPlayerControls.css'

export default function PublicPlayerControls ({ showPlay }: { showPlay: boolean }) {
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
      {showPlay && <Button variant='primary' icon='PLAY' onClick={localPlay.start}>Reproducir</Button>}
      {screenfull.isEnabled && <Button icon='FULLSCREEN' size={24} aria-keyshortcuts='Control+Alt+K' onClick={toggle}>{fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}</Button>}
      {error && <span role='alert'>No se pudo cambiar la pantalla completa.</span>}
    </div>
  )
}
