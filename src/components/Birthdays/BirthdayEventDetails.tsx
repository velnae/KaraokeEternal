import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import { approachLabels, birthdayLabels, type BirthdayEvent } from 'shared/birthdays'
import { birthdayApi, birthdayUrl } from './api'
import useBirthdayOverview from './useBirthdayOverview'
import BirthdayForm from './BirthdayForm'
import BirthdayEventSceneEditor from './BirthdayEventSceneEditor'
import styles from './Birthdays.css'

export default function BirthdayEventDetails ({ id, initial, listen = false, onClose, onChanged, onScheduled }: {
  id: string
  initial?: BirthdayEvent
  listen?: boolean
  onClose(removed?: boolean): void
  onChanged?(): void
  onScheduled?(): void
}) {
  const { overview, error: loadError, refresh } = useBirthdayOverview()
  const event = overview ? overview.events.find(event => event.id === id) : initial
  const [view, setView] = useState<'details' | 'edit' | 'scene'>('details')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [audioError, setAudioError] = useState('')
  const working = useRef(false)
  const audio = useRef<HTMLAudioElement>(null)
  const autoListen = useRef(listen)
  const greeting = event?.assets.find(asset => asset.kind === 'greeting')
  useEffect(() => {
    const element = audio.current
    let active = true
    if (element && view === 'details' && autoListen.current) {
      void element.play().then((): void => {
        if (active) autoListen.current = false
        return undefined
      }).catch(() => {
        if (active && autoListen.current) setAudioError('No se pudo iniciar el audio. Pulse Reintentar audio.')
      })
    }
    return () => {
      active = false
      element?.pause()
    }
  }, [view, greeting?.id])
  const changed = () => {
    refresh()
    onChanged?.()
  }
  const execute = async (operation: string) => {
    if (!event || working.current) return
    working.current = true
    setBusy(true)
    setError('')
    autoListen.current = false
    audio.current?.pause()
    try {
      await birthdayApi.post(`events/${event.id}`, { body: { operation, revision: event.revision } })
      if (operation === 'schedule') onScheduled?.()
      changed()
      if (['schedule', 'unschedule', 'cancel'].includes(operation)) onClose(true)
    } catch (failure) {
      setError((failure as Error).message)
      refresh()
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  if (event && view === 'edit') return (
    <BirthdayForm
      event={event}
      profiles={overview?.settings.rules}
      onClose={() => setView('details')}
      onSaved={() => {
        changed()
        setView('details')
      }}
    />
  )
  if (event && view === 'scene') return (
    <BirthdayEventSceneEditor event={event} assets={overview?.assets ?? []} onClose={() => setView('details')} onSaved={changed} />
  )
  const pending = !!event && ['held', 'interrupted'].includes(event.playback)
  const editable = pending && !!event && ['ready', 'failed'].includes(event.preparation)
  return (
    <Modal title={event ? `Cumpleaños de ${event.name}` : 'Detalle del cumpleaños'} className={styles.dialog} scrollable onClose={() => onClose()}>
      {(error || loadError) && <p role='alert'>{error || loadError}</p>}
      {!event && <p role='status'>{overview ? 'Este cumpleaños ya no está disponible.' : 'Cargando cumpleaños…'}</p>}
      {event && (
        <div className={styles.detail}>
          <p role='status'>{birthdayLabels[event.playback === 'held' ? event.preparation : event.phase && event.playback === 'playing' ? event.phase : event.playback]}</p>
          {event.error && <p role='alert'>{event.error}</p>}
          {greeting && <audio ref={audio} src={birthdayUrl(greeting.url)} controls preload='metadata' aria-label={`Saludo de ${event.name}`} onError={() => setAudioError('No se pudo abrir el audio del saludo.')} />}
          {audioError && (
            <div>
              <p role='alert'>{audioError}</p>
              <Button
                variant='default'
                onClick={() => {
                  autoListen.current = false
                  setAudioError('')
                  audio.current?.load()
                  void audio.current?.play().catch(() => setAudioError('No se pudo reproducir el audio. Revise el recurso.'))
                }}
              >
                Reintentar audio
              </Button>
            </div>
          )}
          {event.script && <p className={styles.script}>{event.script}</p>}
          <div className={styles.actions}>
            {pending && event.preparation !== 'failed' && <Button variant='primary' disabled={busy} onClick={() => void execute('schedule')}>Programar</Button>}
            {event.playback === 'scheduled' && <Button variant='default' disabled={busy} onClick={() => void execute('unschedule')}>Retirar</Button>}
            {pending && event.preparation === 'failed' && <Button variant='primary' disabled={busy} onClick={() => void execute('retry')}>Reintentar</Button>}
            {editable && (
              <Button
                variant='default'
                disabled={busy}
                onClick={() => {
                  autoListen.current = false
                  setView('edit')
                }}
              >
                Editar datos
              </Button>
            )}
            {pending && event.assets.some(asset => asset.kind === 'intro') && event.assets.some(asset => asset.kind === 'video') && (
              <Button
                variant='default'
                disabled={busy}
                onClick={() => {
                  autoListen.current = false
                  setView('scene')
                }}
              >
                Configurar celebración
              </Button>
            )}
          </div>
          {busy && <p role='status'>Guardando…</p>}
          <details>
            <summary>Opciones avanzadas</summary>
            <div className={styles.actions}>
              {editable && <Button variant='default' disabled={busy} onClick={() => void execute('regenerate')}>Generar otro saludo</Button>}
              {editable && <Button variant='default' disabled={busy} onClick={() => void execute('revoice')}>Actualizar solo la voz</Button>}
              {editable && event.personalization?.speech.provider === 'gemini' && <Button variant='default' disabled={busy} onClick={() => void execute('lite')}>Probar voz Flash-Lite</Button>}
            </div>
            <ul>{event.assets.filter(asset => asset.kind !== 'greeting').map(asset => <li key={asset.id}>{asset.title}</li>)}</ul>
            {event.personalization && <p>{`${event.personalization.profile.title || 'Predeterminado'} · ${approachLabels[event.personalization.approach]} · ${event.personalization.speech.voice}`}</p>}
            <Link to='/admin/settings/birthdays?view=settings'>Configuración de cumpleaños</Link>
          </details>
          {event.playback !== 'playing' && !['completed', 'cancelled'].includes(event.playback) && <Button variant='danger' disabled={busy} onClick={() => void execute('cancel')}>Cancelar cumpleaños</Button>}
        </div>
      )}
    </Modal>
  )
}
