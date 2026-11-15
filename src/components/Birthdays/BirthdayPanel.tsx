import React, { useRef, useState } from 'react'
import Button from 'components/Button/Button'
import { birthdayLabels, type BirthdayEvent } from 'shared/birthdays'
import { useAppSelector } from 'store/hooks'
import { selectBirthdays } from 'store/modules/birthdays'
import { birthdayApi } from './api'
import useBirthdayOverview from './useBirthdayOverview'
import BirthdayForm from './BirthdayForm'
import BirthdayEventDetails from './BirthdayEventDetails'
import styles from './Birthdays.css'

export default function BirthdayPanel ({ onScheduled }: { onScheduled?(): void }) {
  const { overview, error: loadError, refresh } = useBirthdayOverview()
  const queued = useAppSelector(selectBirthdays)
  const [form, setForm] = useState(false)
  const [details, setDetails] = useState<{ event: BirthdayEvent, listen: boolean, opener: HTMLButtonElement } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const working = useRef(false)
  const panel = useRef<HTMLElement>(null)
  const focusPrepare = () => panel.current?.querySelector<HTMLButtonElement>('[data-birthday-prepare]')?.focus({ preventScroll: true })
  const execute = async (event: BirthdayEvent, operation: string) => {
    if (working.current) return
    working.current = true
    setBusy(event.id)
    setError('')
    try {
      await birthdayApi.post(`events/${event.id}`, { body: { operation, revision: event.revision } })
      if (operation === 'schedule') onScheduled?.()
      refresh()
      requestAnimationFrame(focusPrepare)
    } catch (failure) {
      setError((failure as Error).message)
      refresh()
    } finally {
      working.current = false
      setBusy(null)
    }
  }
  const events = overview?.events.filter(event => ['held', 'interrupted'].includes(event.playback) && !queued.some(active => active.id === event.id)) ?? []
  return (
    <section ref={panel} className={styles.panel} aria-label='Cumpleaños preparados'>
      <div className={styles.heading}>
        <h2>Cumpleaños</h2>
        <Button variant='default' aria-label='Preparar cumpleaños' data-birthday-prepare onClick={() => setForm(true)}>+ Preparar</Button>
      </div>
      {(error || loadError) && <p role='alert'>{error || loadError}</p>}
      {busy && <p role='status'>Guardando cumpleaños…</p>}
      {events.map(event => (
        <article key={event.id} className={styles.card} aria-label={`Cumpleaños de ${event.name}`}>
          <div className={styles.identity}>
            <h3>{`🎂 ${event.name}`}</h3>
            <p className={styles.status} role='status'>{birthdayLabels[event.playback === 'interrupted' ? 'interrupted' : event.preparation]}</p>
            {event.error && <p role='alert'>{event.error}</p>}
          </div>
          <div className={styles.actions}>
            {event.assets.some(asset => asset.kind === 'greeting') && <Button variant='default' aria-label={`Escuchar saludo de ${event.name}`} onClick={click => setDetails({ event, listen: true, opener: click.currentTarget })}>Escuchar</Button>}
            <Button variant='primary' disabled={!!busy} onClick={() => void execute(event, event.preparation === 'failed' ? 'retry' : 'schedule')}>{event.preparation === 'failed' ? 'Reintentar' : 'Programar'}</Button>
            <Button variant='default' className={styles.more} aria-label={`Más opciones de cumpleaños de ${event.name}`} onClick={click => setDetails({ event, listen: false, opener: click.currentTarget })}>⋯</Button>
          </div>
        </article>
      ))}
      {form && (
        <BirthdayForm
          profiles={overview?.settings.rules}
          onClose={() => {
            setForm(false)
            requestAnimationFrame(focusPrepare)
          }}
          onSaved={() => {
            setForm(false)
            refresh()
            requestAnimationFrame(focusPrepare)
          }}
        />
      )}
      {details && (
        <BirthdayEventDetails
          id={details.event.id}
          initial={details.event}
          listen={details.listen}
          onChanged={refresh}
          onScheduled={onScheduled}
          onClose={(removed) => {
            const opener = details.opener
            setDetails(null)
            requestAnimationFrame(() => {
              if (!removed && opener.isConnected) opener.focus({ preventScroll: true })
              else focusPrepare()
            })
          }}
        />
      )}
    </section>
  )
}
