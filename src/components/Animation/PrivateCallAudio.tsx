import React, { useEffect, useRef, useState } from 'react'
import HttpApi from 'lib/HttpApi'
import Button from 'components/Button/Button'
import type { CallPart } from 'shared/karaokeCalls'
import styles from './KaraokeCallPilot.css'

const api = new HttpApi()
export default function PrivateCallAudio ({ roomId, part, onClose }: { roomId: number, part: CallPart, onClose: () => void }) {
  const [url, setURL] = useState('')
  const [error, setError] = useState('')
  const audio = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    let alive = true
    let objectURL = ''
    const controller = new AbortController()
    const element = audio.current
    void api.get<Response>(`rooms/${roomId}/karaoke-calls/audio/${part.id}`, { signal: controller.signal })
      .then(response => response.blob()).then((blob): void => {
        if (alive) {
          objectURL = URL.createObjectURL(blob)
          setURL(objectURL)
        }
        return undefined
      }).catch((err: Error) => { if (alive) setError(err.message) })
    return () => {
      alive = false
      controller.abort()
      element?.pause()
      element?.removeAttribute('src')
      element?.load()
      URL.revokeObjectURL(objectURL)
    }
  }, [roomId, part.id])
  return (
    <section className={styles.preview} aria-label='Escucha privada'>
      <div className={styles.actions}>
        <strong>{part.title}</strong>
        <Button onClick={onClose}>Cerrar escucha</Button>
      </div>
      <p translate='no'>{part.text}</p>
      <audio ref={audio} controls autoPlay src={url || undefined} aria-label='Audio privado del llamado' onError={() => setError('No se pudo reproducir. Cierre la escucha y vuelva a intentarlo.')} />
      {!url && !error && <p role='status'>Descargando audio…</p>}
      {error && <p className={styles.error} role='alert'>{error}</p>}
      <small>Solo en este navegador. Si no comienza, use el control de reproducción.</small>
    </section>
  )
}
