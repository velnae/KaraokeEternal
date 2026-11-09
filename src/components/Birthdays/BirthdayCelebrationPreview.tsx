import React, { useEffect, useRef, useState } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import { birthdayLabels, birthdaySequence, type BirthdayEvent } from 'shared/birthdays'
import BirthdayPresentation from './BirthdayPresentation'
import { birthdayUrl } from './api'
import styles from './BirthdayCelebration.css'

export default function BirthdayCelebrationPreview ({ event, currentRevision, currentPlayback, onClose }: { event: BirthdayEvent, currentRevision?: number, currentPlayback?: string, onClose(): void }) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [run, setRun] = useState(0)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState('')
  const [videoError, setVideoError] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  const sequence = birthdaySequence(event.assets)
  const selected = sequence[index]
  const changed = currentRevision !== event.revision || currentPlayback !== event.playback
  const src = birthdayUrl(selected.url)
  useEffect(() => {
    const element = audio.current
    if (playing && !changed) void element?.play().catch(() => {
      setPlaying(false)
      setError('No se pudo iniciar el audio. Pulse Reiniciar para intentarlo de nuevo.')
    })
    else element?.pause()
    return () => element?.pause()
  }, [src, playing, changed, run])
  const start = () => {
    audio.current?.pause()
    if (audio.current) audio.current.currentTime = 0
    setIndex(0)
    setFinished(false)
    setError('')
    setRun(value => value + 1)
    setPlaying(true)
  }
  return (
    <Modal title={`Previsualización de ${event.name}`} className={styles.previewDialog} scrollable onClose={onClose}>
      <div className={styles.stage}><BirthdayPresentation key={run} name={event.name} video={event.assets.find(asset => asset.kind === 'video')} playing={playing && !changed} onVideoError={() => setVideoError(true)} /></div>
      <p className={styles.status} role='status'>{changed ? 'La selección o el estado del evento cambió. Cierre y abra la previsualización de nuevo.' : finished ? 'Previsualización finalizada' : playing ? birthdayLabels[selected.kind as 'intro' | 'greeting' | 'music'] : 'Previsualización en este dispositivo'}</p>
      {videoError && <p role='status'>No se pudo abrir el fondo. La previsualización continúa con una presentación estática.</p>}
      {error && <p role='alert'>{error}</p>}
      <audio
        ref={audio}
        src={src}
        preload='auto'
        onError={() => {
          setPlaying(false)
          setError('No se pudo abrir un audio guardado. Revise los recursos del evento.')
        }}
        onEnded={() => {
          if (!playing || changed) return
          if (index + 1 < sequence.length) setIndex(index + 1)
          else {
            setPlaying(false)
            setFinished(true)
          }
        }}
      />
      <div className={styles.actions}>
        {!changed && !playing && <Button variant='primary' onClick={start}>Iniciar previsualización</Button>}
        {!changed && playing && (
          <Button onClick={() => {
            audio.current?.pause()
            setPlaying(false)
          }}
          >
            Detener
          </Button>
        )}
        {!changed && <Button onClick={start}>Reiniciar</Button>}
        <Button onClick={onClose}>Cerrar previsualización</Button>
      </div>
    </Modal>
  )
}
