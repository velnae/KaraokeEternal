import React, { useEffect, useRef, useState } from 'react'
import type { ClientBranding } from 'shared/branding'
import { DISPLAY_REFERENCE, type PlayerDisplaySettings } from 'shared/playerDisplay'
import PlayerDisplayOverlay from './PlayerDisplayOverlay'
import styles from './PlayerDisplaySettings.css'

export default function DisplayPreview ({ branding, settings }: { branding: ClientBranding, settings: PlayerDisplaySettings }) {
  const [resolution, setResolution] = useState<number>(DISPLAY_REFERENCE.width)
  const [scene, setScene] = useState('LISTEN')
  const [background, setBackground] = useState('dark')
  const [availableWidth, setWidth] = useState(0)
  const frame = useRef<HTMLDivElement>(null)
  const height = resolution * 9 / 16
  useEffect(() => {
    const element = frame.current!
    const resize = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    resize.observe(element)
    setWidth(element.clientWidth)
    return () => resize.disconnect()
  }, [])
  return (
    <figure className={styles.preview} aria-label='Vista previa de pantalla'>
      <figcaption>Vista previa</figcaption>
      <div className={styles.previewControls}>
        <label>
          Resolución
          <select aria-label='Resolución de vista previa' value={resolution} onChange={event => setResolution(Number(event.currentTarget.value))}>
            <option value={1280}>HD · 720p</option>
            <option value={1920}>FHD · 1080p</option>
            <option value={3840}>4K · 2160p</option>
          </select>
        </label>
        <label>
          Contenido
          <select aria-label='Contenido de la vista previa' value={scene} onChange={event => setScene(event.currentTarget.value)}>
            <option value='LISTEN'>Música para escuchar</option>
            <option value='SING'>Karaoke</option>
            <option value='TRANSITION'>Transición</option>
          </select>
        </label>
        <label>
          Fondo
          <select aria-label='Fondo de prueba' value={background} onChange={event => setBackground(event.currentTarget.value)}>
            <option value='dark'>Oscuro</option>
            <option value='light'>Claro</option>
          </select>
        </label>
      </div>
      <div ref={frame} className={styles.previewFrame}>
        <div
          className={styles.previewCanvas}
          data-testid='display-preview-canvas'
          data-background={background}
          data-resolution={`${resolution}x${height}`}
          style={{ width: resolution, height, transform: `scale(${availableWidth / resolution})` }}
        >
          <span className={styles.previewContent} style={{ fontSize: 32 * resolution / 1920 }}>{scene === 'TRANSITION' ? 'Transición' : scene === 'SING' ? 'Karaoke' : 'Video de YouTube'}</span>
          {scene !== 'TRANSITION' && (
            <PlayerDisplayOverlay key={scene} branding={branding} settings={settings} viewport={{ width: resolution, height }} intent={scene === 'SING' ? 'SING' : 'LISTEN'} isPlaying />
          )}
        </div>
      </div>
    </figure>
  )
}
