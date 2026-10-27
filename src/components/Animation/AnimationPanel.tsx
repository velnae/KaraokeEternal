import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import { animationRequest, animationTime, fetchAnimationClips, syncAnimation } from 'lib/animationApi'
import { ANIMATION_CONTROL, ANIMATION_CANCEL, ANIMATION_REQUEST, interventionLabels, type AnimationClip } from 'shared/animation'
import { announcementBlocker } from './announcementAvailability'
import theme from 'styles/karaokeTheme.css'
import styles from './Animation.css'
import socket from 'lib/socket'
import OperationControls from './OperationControls'

export default function AnimationPanel () {
  const { snapshot, connected } = useAppSelector(state => state.animation)
  const roomId = useAppSelector(state => state.user.roomId)
  const room = useAppSelector(state => state.rooms.entities[state.user.roomId])
  const [clips, setClips] = useState<AnimationClip[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null)
  const [, refreshTime] = useState(0)
  const inFlight = useRef(false)

  useEffect(() => {
    let alive = true
    setClips([])
    setError('')
    void fetchAnimationClips().then((result): void => {
      if (alive) {
        setClips(result.filter(clip => clip.kind !== 'ambience'))
        setSelected(result[0]?.id ?? '')
      }
      return undefined
    }).catch((error) => { if (alive) setError(error.message) })
    if (socket.connected) void syncAnimation().catch((error) => {
      if (alive) setError(error.message)
    })
    return () => {
      alive = false
    }
  }, [roomId, snapshot?.catalogVersion])

  const current = snapshot?.roomId === roomId ? snapshot : null
  useEffect(() => {
    const remaining = (current?.blockedUntil ?? 0) - animationTime()
    if (remaining <= 0) return
    const timer = setTimeout(() => refreshTime(value => value + 1), remaining + 50)
    return () => clearTimeout(timer)
  }, [current?.blockedUntil])

  const active = current?.active
  const clip = clips.find(item => item.id === selected)
  const blocker = announcementBlocker({ snapshot: current, connected, hasClip: !!clip, expired: !!clip?.validUntil && clip.validUntil <= animationTime(), roomClosed: room?.status === 'closed', now: animationTime() })
  const controlsDisabled = !connected || !current || busy
  const audioPending = !!current?.prefs.enabled && current.playerPresent && !current.audioUnlocked
  const percent = volumeDraft ?? Math.round((current?.prefs.volume ?? 0.5) * 100)

  const execute = async (type: string, payload: object) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await animationRequest(type, payload)
    } catch (error) {
      setError((error as Error).message)
      void syncAnimation().catch(() => {})
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  const control = (patch: object) => execute(ANIMATION_CONTROL, { ...patch, controlVersion: current?.controlVersion })
  const commitVolume = (value: number) => {
    if (inFlight.current || controlsDisabled) return
    if (value === Math.round((current?.prefs.volume ?? 0.5) * 100)) {
      setVolumeDraft(null)
      return
    }
    void control({ volume: value / 100 }).finally(() => setVolumeDraft(null))
  }
  const reload = async () => {
    setError('')
    try {
      const result = await fetchAnimationClips()
      setClips(result.filter(clip => clip.kind !== 'ambience'))
      setSelected(previous => result.some(item => item.id === previous) ? previous : result[0]?.id ?? '')
      await syncAnimation()
    } catch (error) { setError((error as Error).message) }
  }

  const [status, tone] = (() => {
    if (!current) return ['Conectando con la sala', 'waiting']
    if (!connected) return ['Sin conexión', 'waiting']
    if (!current.prefs.enabled) return ['Animador desactivado', 'muted']
    if (room?.status === 'closed') return ['Sala cerrada', 'waiting']
    if (!current.playerPresent) return ['Falta abrir el reproductor', 'waiting']
    if (active?.stopRequestedAt) return ['Deteniendo anuncio…', 'waiting']
    if (current.microphoneOccupied) return ['Micrófono ocupado', 'waiting']
    if (current.prefs.volume === 0) return ['Voz silenciada', 'waiting']
    if (!clips.length) return ['Catálogo no disponible', 'waiting']
    if (audioPending) return [active ? 'Solicitud en espera de audio' : 'Audio por habilitar', 'waiting']
    if (active) return [interventionLabels[active.status], active.status === 'PLAYING' ? 'live' : 'waiting']
    if (current.blockedUntil > animationTime()) return ['Recuperando la pausa', 'waiting']
    return ['Listo para la próxima pausa', 'ready']
  })()

  return (
    <section id='animator' className={`${theme.theme} ${theme.forms} ${styles.panel}`} aria-labelledby='animator-title'>
      <header className={styles.heading}>
        <div className={styles.identity}>
          <span className={styles.micMark} aria-hidden='true'><Icon icon='MICROPHONE' size={24} /></span>
          <div>
            <h2 id='animator-title'>Animador</h2>
            <p>{room?.name || 'Sala'}</p>
          </div>
        </div>
        <label className={styles.enableSwitch}>
          <input
            type='checkbox'
            role='switch'
            aria-label='Activado'
            checked={current?.prefs.enabled ?? false}
            disabled={controlsDisabled}
            onChange={event => void control({ enabled: event.target.checked })}
          />
          <span className={styles.switchTrack} aria-hidden='true' />
          <span>{current?.prefs.enabled ? 'Activado' : 'Desactivado'}</span>
        </label>
      </header>

      <div className={styles.statusBar} data-tone={tone}>
        <p className={styles.status} role='status'>
          <span className={styles.statusDot} aria-hidden='true' />
          {status}
        </p>
        <Button className={styles.refresh} icon='REFRESH' size={20} aria-label='Actualizar estado' title='Actualizar estado' disabled={busy} onClick={() => void reload()} />
      </div>
      {error && <p className={styles.error} role='alert'>{error}</p>}

      <OperationControls />

      <div className={styles.desk}>
        <div className={styles.message}>
          <label className={styles.field}>
            Mensaje para la sala
            <select aria-label='Clip' value={selected} onChange={event => setSelected(event.target.value)} disabled={!!active || busy}>
              {!clips.length && <option value=''>No hay clips disponibles</option>}
              {clips.map(item => <option key={item.id} value={item.id}>{`${item.title} (${(item.durationMs / 1000).toFixed(1)} s)`}</option>)}
            </select>
          </label>
          <div className={styles.cue}>
            <p className={styles.preview}>{active?.displayText ?? clip?.displayText ?? 'Elija un clip para ver el mensaje que escuchará la sala.'}</p>
            <span className={styles.duration}>{active ? `${(active.durationMs / 1000).toFixed(1)} s` : clip ? `${(clip.durationMs / 1000).toFixed(1)} s` : 'Sin audio seleccionado'}</span>
          </div>
          {active
            ? (
                <Button
                  className={styles.mainAction}
                  variant='danger'
                  disabled={busy || !connected || !!active.stopRequestedAt}
                  onClick={() => void execute(ANIMATION_CANCEL, { interventionId: active.interventionId })}
                >
                  {active.stopRequestedAt ? 'Deteniendo…' : active.status === 'PENDING' ? 'Cancelar solicitud' : 'Detener anuncio'}
                </Button>
              )
            : (
                <Button
                  className={styles.mainAction}
                  variant='primary'
                  disabled={busy || !!blocker}
                  aria-describedby='announcement-help'
                  onClick={() => void execute(ANIMATION_REQUEST, { clipId: selected, requestId: crypto.randomUUID() })}
                >
                  {busy ? 'Guardando…' : 'Anunciar en la próxima pausa'}
                </Button>
              )}
          <p id='announcement-help' className={styles.actionHelp}>
            {active ? 'Su solicitud está guardada. La música continúa hasta una pausa disponible.' : blocker ?? 'Se guardará una solicitud. No interrumpe la canción actual.'}
          </p>
          {!!current?.prefs.enabled && !current.playerPresent && connected && (
            <Link className={styles.recoveryLink} to='/player' target='_blank' rel='noopener'>Abrir reproductor de la sala</Link>
          )}
          {audioPending && (
            <div className={styles.audioNotice}>
              <strong>{active ? 'Un paso antes de escucharlo' : 'Puede dejar el anuncio en espera'}</strong>
              <p>
                En la pantalla del local, pulse
                {' '}
                <b>Habilitar audio del animador</b>
                . El anuncio esperará hasta que el audio esté listo.
              </p>
            </div>
          )}
        </div>

        <aside className={styles.controls} aria-label='Controles de voz de la sala'>
          <div className={styles.controlGroup}>
            <h3>Micrófono</h3>
            <Button
              className={styles.microphone}
              aria-pressed={!!current?.microphoneOccupied}
              disabled={controlsDisabled}
              onClick={() => void control({ microphoneOccupied: !current?.microphoneOccupied })}
            >
              <Icon icon='MICROPHONE' size={20} />
              {current?.microphoneOccupied ? 'Marcar micrófono libre' : 'Marcar micrófono ocupado'}
            </Button>
            <p className={styles.hint}>Bloquea los anuncios, sin pausar la música ni controlar el micrófono físico.</p>
          </div>
          <div className={styles.controlGroup}>
            <div className={styles.volumeHeading}>
              <label htmlFor='animation-volume'>Volumen de voz</label>
              <output htmlFor='animation-volume'>
                {percent}
                %
              </output>
            </div>
            <input
              id='animation-volume'
              className={styles.volume}
              type='range'
              min='0'
              max='100'
              step='5'
              aria-label='Volumen de voz'
              value={percent}
              disabled={controlsDisabled}
              onChange={event => setVolumeDraft(Number(event.target.value))}
              onPointerUp={event => commitVolume(Number(event.currentTarget.value))}
              onBlur={event => commitVolume(Number(event.currentTarget.value))}
              onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) commitVolume(Number(event.currentTarget.value)) }}
            />
            <p className={styles.hint}>Independiente del volumen de la música.</p>
          </div>
        </aside>
      </div>

      <details className={styles.historyDetails}>
        <summary>
          Últimas intervenciones
          <span className={styles.historyCount}>{current?.history.length ?? 0}</span>
        </summary>
        {!current?.history.length
          ? <p className={styles.historyEmpty}>Aquí aparecerán los anuncios solicitados y su resultado.</p>
          : (
              <ol className={styles.history}>
                {current.history.map(item => (
                  <li key={item.interventionId}>
                    <time dateTime={new Date(item.requestedAt).toISOString()}>{new Date(item.requestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                    <div>
                      <strong>{interventionLabels[item.status]}</strong>
                      <p>{item.displayText}</p>
                      {item.reason && <small>{item.reason}</small>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
      </details>
    </section>
  )
}
