import React, { useRef, useState } from 'react'
import { birthdayLabels, type BirthdayQueueEvent, type PublicBirthday } from 'shared/birthdays'
import { formatSeconds } from 'lib/dateTime'
import { useAppSelector } from 'store/hooks'
import { canOperate } from 'shared/permissions'
import Button from 'components/Button/Button'
import { birthdayApi } from './api'
import BirthdayEventDetails from './BirthdayEventDetails'
import styles from './Birthdays.css'

export default function BirthdayQueueItem ({ event }: { event: PublicBirthday }) {
  const user = useAppSelector(state => state.user)
  const songPlaying = useAppSelector(state => state.status.queueId >= 0 && !state.status.isAtQueueEnd)
  const [details, setDetails] = useState<HTMLButtonElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const working = useRef(false)
  const withdraw = async () => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      const overview = await birthdayApi.get<{ events: Pick<BirthdayQueueEvent, 'id' | 'revision' | 'playback'>[] }>('queue')
      const current = overview.events.find(item => item.id === event.id)
      if (current?.playback !== 'scheduled') throw new Error('El cumpleaños cambió de estado. Revise la cola.')
      await birthdayApi.post(`events/${event.id}`, { body: { operation: 'unschedule', revision: current.revision } })
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-birthday-prepare]')?.focus({ preventScroll: true }))
    } catch (failure) {
      setError((failure as Error).message)
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  return (
    <article className={styles.queued} data-birthday-id={event.id} aria-label={`Cumpleaños de ${event.name}`}>
      <strong>{`🎂 Cumpleaños de ${event.name}`}</strong>
      <span role='status'>{event.playback === 'playing' && event.phase ? birthdayLabels[event.phase] : event.preparation !== 'ready' ? 'Preparando saludo…' : songPlaying ? 'Al terminar el tema actual' : 'Próximo cumpleaños'}</span>
      <span>{formatSeconds(Math.ceil(event.durationMs / 1000))}</span>
      {canOperate(user) && (
        <div className={styles.actions}>
          {event.playback === 'scheduled' && <Button variant='default' disabled={busy} onClick={() => void withdraw()}>Retirar</Button>}
          <Button variant='default' className={styles.more} aria-label={`Más opciones de cumpleaños de ${event.name}`} onClick={click => setDetails(click.currentTarget)}>⋯</Button>
        </div>
      )}
      {busy && <span role='status'>Guardando…</span>}
      {error && <p className={styles.message} role='alert'>{error}</p>}
      {details && (
        <BirthdayEventDetails
          id={event.id}
          onClose={(removed) => {
            const opener = details
            setDetails(null)
            requestAnimationFrame(() => {
              if (!removed && opener.isConnected) opener.focus({ preventScroll: true })
              else document.querySelector<HTMLButtonElement>('[data-birthday-prepare]')?.focus({ preventScroll: true })
            })
          }}
        />
      )}
    </article>
  )
}
