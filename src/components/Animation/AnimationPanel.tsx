import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import { animationRequest, animationTime, fetchAnimationClips, syncAnimation } from 'lib/animationApi'
import { ANIMATION_CANCEL, ANIMATION_REQUEST, interventionLabels, type AnimationClip } from 'shared/animation'
import { announcementBlocker } from './announcementAvailability'
import styles from './Animation.css'
import OperationControls from './OperationControls'

export default function AnimationPanel () {
  const { snapshot, connected } = useAppSelector(state => state.animation)
  const roomId = useAppSelector(state => state.user.roomId)
  const room = useAppSelector(state => state.rooms.entities[state.user.roomId])
  const current = snapshot?.roomId === roomId ? snapshot : null
  const [clips, setClips] = useState<AnimationClip[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [, refresh] = useState(0)
  const inFlight = useRef(false)
  useEffect(() => {
    let alive = true
    void fetchAnimationClips().then((result): void => {
      if (alive) {
        setClips(result.filter(clip => clip.kind !== 'ambience'))
        setSelected(previous => result.some(clip => clip.id === previous) ? previous : result.find(clip => clip.kind !== 'ambience')?.id ?? '')
      }
      return undefined
    }).catch((error) => { if (alive) setError(error.message) })
    void syncAnimation().catch(() => {})
    return () => {
      alive = false
    }
  }, [roomId, snapshot?.catalogVersion])
  useEffect(() => {
    const remaining = (current?.blockedUntil ?? 0) - animationTime()
    if (remaining <= 0) return
    const timer = setTimeout(() => refresh(value => value + 1), remaining + 50)
    return () => clearTimeout(timer)
  }, [current?.blockedUntil])
  const active = current?.active
  const clip = clips.find(item => item.id === selected)
  const blocker = announcementBlocker({ snapshot: current, connected, hasClip: !!clip, expired: !!clip?.validUntil && clip.validUntil <= animationTime(), roomClosed: room?.status === 'closed', now: animationTime() })
  const audioPending = !!current?.prefs.enabled && current.playerPresent && !current.audioUnlocked
  const status = !connected || !current ? 'Conectando con la sala' : !current.prefs.enabled ? 'Desactivado' : active?.stopRequestedAt ? 'Deteniendo anuncio…' : active ? audioPending ? 'Solicitud en espera de audio' : interventionLabels[active.status] : audioPending ? 'Audio pendiente en el reproductor' : blocker ? 'Requiere atención' : 'Listo para la próxima pausa'
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
  return (
    <section id='animator' className={styles.panel} aria-label='Control del animador'>
      <div className={styles.statusBar}>
        <p className={styles.status} role='status'>
          <span className={styles.statusDot} aria-hidden='true' />
          {status}
        </p>
      </div>
      <OperationControls />
      {error && <p className={styles.error} role='alert'>{error}</p>}
      <div className={styles.message}>
        <label className={styles.field}>
          Anuncio puntual
          <select aria-label='Clip' value={selected} onChange={event => setSelected(event.target.value)} disabled={!!active || busy}>
            {!clips.length && <option value=''>No hay audios disponibles</option>}
            {clips.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <div className={styles.cue}>
          <p className={styles.preview}>{active?.displayText ?? clip?.displayText ?? 'Agregue un audio para comenzar.'}</p>
          <span className={styles.duration}>{active || clip ? `${((active?.durationMs ?? clip?.durationMs ?? 0) / 1000).toFixed(1)} s` : ''}</span>
        </div>
        {active
          ? <Button className={styles.mainAction} variant='danger' disabled={busy || !connected || !!active.stopRequestedAt} onClick={() => void execute(ANIMATION_CANCEL, { interventionId: active.interventionId })}>{active.stopRequestedAt ? 'Deteniendo…' : active.status === 'PENDING' ? 'Cancelar solicitud' : 'Detener anuncio'}</Button>
          : <Button className={styles.mainAction} variant='primary' disabled={busy || !!blocker} aria-describedby='announcement-help' onClick={() => void execute(ANIMATION_REQUEST, { clipId: selected, requestId: crypto.randomUUID() })}>{busy ? 'Guardando…' : 'Anunciar en la próxima pausa'}</Button>}
        <p id='announcement-help' className={styles.actionHelp}>{active ? 'La solicitud espera una pausa disponible.' : blocker ?? (audioPending ? 'Puede dejar el anuncio en espera. Habilite el audio en el reproductor del local.' : '')}</p>
        {!clips.length && <Link className={styles.recoveryLink} to='?view=audio'>Ir a Audios</Link>}
      </div>
      <details className={styles.historyDetails}>
        <summary>
          Actividad reciente
          <span className={styles.historyCount}>{current?.history.length ?? 0}</span>
        </summary>
        {!current?.history.length
          ? <p className={styles.historyEmpty}>Todavía no hay anuncios.</p>
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
