import React, { useState } from 'react'
import Button from 'components/Button/Button'
import styles from './DevPlayerTools.css'

interface DevPlayerToolsProps {
  phase: string
  canSeek: boolean
  isPlaying: boolean
  onSeek(target: 'end' | 'forward'): string | undefined
}

export default function DevPlayerTools ({ phase, canSeek, isPlaying, onSeek }: DevPlayerToolsProps) {
  const [feedback, setFeedback] = useState('')
  return (
    <aside className={styles.panel} aria-label='Herramientas de desarrollo'>
      <p role='status'>{`Desarrollo · ${phase}`}</p>
      {canSeek
        ? (
            <>
              <div className={styles.actions}>
                <Button onClick={() => setFeedback(onSeek('end') ?? '')}>Últimos 5 segundos</Button>
                <Button onClick={() => setFeedback(onSeek('forward') ?? '')}>+30 segundos</Button>
              </div>
              <small role='status'>{feedback || (isPlaying ? 'Adelanta para probar el final real de la canción.' : 'En pausa. El salto conserva la pausa.')}</small>
            </>
          )
        : <small>Los saltos están disponibles durante una canción de YouTube.</small>}
    </aside>
  )
}
