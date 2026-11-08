import React, { useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import { birthdayLabels, type BirthdayEvent, type BirthdayAsset } from 'shared/birthdays'
import { useAppSelector } from 'store/hooks'
import { birthdayApi, birthdayUrl } from './api'
import useBirthdayOverview from './useBirthdayOverview'
import BirthdayForm from './BirthdayForm'
import styles from './Birthdays.css'

export default function BirthdayPanel () {
  const { overview, error: loadError, refresh } = useBirthdayOverview()
  const status = useAppSelector(state => state.status)
  const [form, setForm] = useState<BirthdayEvent | 'new' | null>(null)
  const [preview, setPreview] = useState<BirthdayAsset | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const execute = async (event: BirthdayEvent, operation: string) => {
    if (busy) return
    setBusy(event.id)
    setError('')
    setPreview(null)
    try {
      await birthdayApi.post(`events/${event.id}`, { body: { operation, revision: event.revision } })
      refresh()
    } catch (failure) {
      setError((failure as Error).message)
    } finally { setBusy(null) }
  }
  const events = overview?.events.filter(event => !['completed', 'cancelled'].includes(event.playback)) ?? []
  const history = overview?.events.filter(event => ['completed', 'cancelled'].includes(event.playback)).slice(0, 10) ?? []
  return (
    <section className={styles.panel} aria-label='Cumpleaños preparados'>
      <div className={styles.heading}>
        <h2>Cumpleaños</h2>
        <Button onClick={() => setForm('new')}>Preparar cumpleaños</Button>
        <Link to='/admin/settings/birthdays'>Ajustes</Link>
      </div>
      {(error || loadError) && <p role='alert'>{error || loadError}</p>}
      {events.map((event) => {
        const editable = ['held', 'interrupted'].includes(event.playback) && ['ready', 'failed'].includes(event.preparation)
        const greeting = event.assets.find(asset => asset.kind === 'greeting')
        return (
          <article key={event.id} className={styles.card} aria-label={`Cumpleaños de ${event.name}`}>
            <div className={styles.identity}>
              <h3>{event.name}</h3>
              <p role='status'>{birthdayLabels[event.playback === 'held' ? event.preparation : event.phase && event.playback === 'playing' ? event.phase : event.playback]}</p>
              {event.error && <p role='alert'>{event.error}</p>}
              {event.playback === 'held' && <p>{status.queueId >= 0 && !status.isAtQueueEnd ? 'Al finalizar el tema actual.' : 'Al aprobar, comenzará cuando el reproductor esté disponible.'}</p>}
              {event.playback === 'scheduled' && event.preparation !== 'ready' && <p>Preparando el saludo antes de iniciar.</p>}
            </div>
            <div className={styles.actions}>
              {greeting && <Button onClick={() => setPreview(greeting)}>Escuchar prueba</Button>}
              {['held', 'interrupted'].includes(event.playback) && event.preparation !== 'failed' && <Button variant='primary' disabled={busy === event.id} onClick={() => void execute(event, 'schedule')}>Reproducir</Button>}
              {event.playback === 'scheduled' && <Button disabled={busy === event.id} onClick={() => void execute(event, 'unschedule')}>Retirar programación</Button>}
              {event.preparation === 'failed' && editable && <Button disabled={busy === event.id} onClick={() => void execute(event, 'retry')}>Reintentar preparación</Button>}
              {busy === event.id && <span role='status'>Guardando…</span>}
              {event.playback !== 'playing' && (
                <details>
                  <summary>Más acciones</summary>
                  <div className={styles.actions}>
                    {editable && <Button onClick={() => setForm(event)}>Editar datos</Button>}
                    {editable && <Button disabled={busy === event.id} onClick={() => void execute(event, 'regenerate')}>Generar otro saludo</Button>}
                    <Button disabled={busy === event.id} onClick={() => void execute(event, 'cancel')}>Cancelar cumpleaños</Button>
                  </div>
                </details>
              )}
            </div>
            {event.script && (
              <details className={styles.script}>
                <summary>Ver saludo</summary>
                <p>{event.script}</p>
              </details>
            )}
          </article>
        )
      })}
      {history.length > 0 && (
        <details>
          <summary>Celebraciones anteriores</summary>
          {history.map(event => (
            <p key={event.id}>
              {event.name}
              {' '}
              —
              {' '}
              {birthdayLabels[event.playback]}
            </p>
          ))}
        </details>
      )}
      {preview && (
        <div className={styles.preview}>
          <strong>Prueba en este dispositivo</strong>
          <audio key={preview.id} autoPlay controls src={birthdayUrl(preview.url)} />
          <Button onClick={() => setPreview(null)}>Cerrar prueba</Button>
        </div>
      )}
      {form && (
        <BirthdayForm
          event={form === 'new' ? undefined : form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null)
            refresh()
          }}
        />
      )}
    </section>
  )
}
