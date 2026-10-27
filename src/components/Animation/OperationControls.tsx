import React, { useRef, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import { animationRequest, syncAnimation } from 'lib/animationApi'
import { ANIMATION_CONTROL, ANIMATION_SESSION, animationPrefs, familyLabels, VOICE_FAMILIES } from 'shared/animation'
import styles from './PhaseTwo.css'

export default function OperationControls () {
  const { snapshot, connected } = useAppSelector(state => state.animation)
  const roomId = useAppSelector(state => state.user.roomId)
  const current = snapshot?.roomId === roomId ? snapshot : null
  const prefs = animationPrefs(current?.prefs)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [draftVolume, setDraftVolume] = useState<number | null>(null)
  const inFlight = useRef(false)
  const send = async (type: string, payload: object) => {
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
  const control = (patch: object) => send(ANIMATION_CONTROL, { ...patch, controlVersion: current?.controlVersion })
  const commitVolume = (value: number) => {
    if (inFlight.current || value === Math.round(prefs.ambienceVolume * 100)) return
    void control({ ambienceVolume: value / 100 }).finally(() => setDraftVolume(null))
  }
  const disabled = !connected || !current || busy
  const session = current?.session
  return (
    <section className={styles.operation} aria-label='Funcionamiento del animador'>
      <div className={styles.settingsRow}>
        <label>
          Funcionamiento
          <select
            aria-label='Funcionamiento'
            value={prefs.automation ? 'automatic' : 'manual'}
            disabled={disabled}
            onChange={event => void control({ automation: event.target.value === 'automatic' })}
          >
            <option value='manual'>Manual</option>
            <option value='automatic'>Automático</option>
          </select>
        </label>
        {(prefs.automation || session) && (
          <label>
            Perfil de sala
            <select aria-label='Perfil de sala' value={prefs.profile} disabled={disabled} onChange={event => void control({ profile: event.target.value })}>
              <option value='dinner'>Cena</option>
              <option value='mixed'>Mixto</option>
              <option value='party'>Fiesta</option>
            </select>
          </label>
        )}
        {(prefs.automation || session) && (
          <div className={styles.session}>
            <strong>{session ? session.status === 'CLOSING' ? 'Jornada cerrándose' : 'Jornada abierta' : 'Sin jornada abierta'}</strong>
            {session && <span>{session.businessDate}</span>}
            <div className={styles.actions}>
              {!session && <Button disabled={disabled} onClick={() => void send(ANIMATION_SESSION, { operation: 'open' })}>Iniciar jornada</Button>}
              {session?.status === 'OPEN' && <Button disabled={disabled} onClick={() => void send(ANIMATION_SESSION, { operation: 'close' })}>Cerrar jornada</Button>}
              {session?.status === 'CLOSING' && <Button disabled={disabled} onClick={() => void send(ANIMATION_SESSION, { operation: 'finish' })}>Finalizar sin despedida</Button>}
            </div>
          </div>
        )}
      </div>
      {prefs.automation && !session && <p className={styles.notice}>Inicie una jornada para activar los eventos automáticos. Los anuncios manuales siguen disponibles.</p>}
      {session?.status === 'CLOSING' && <p className={styles.notice}>La despedida espera una pausa hasta un minuto. La cola musical continúa.</p>}
      {error && <p role='alert' className={styles.notice}>{error}</p>}
      {prefs.automation && (
        <p className={styles.budget}>
          Tiempo disponible de intervenciones:
          {' '}
          {Math.floor((current?.voiceBudgetRemainingMs ?? 120000) / 1000)}
          {' '}
          s de 120 s por cada 10 minutos.
        </p>
      )}
      {prefs.automation && current?.lastOmission && <p role='status' className={styles.notice}>{current.lastOmission}</p>}
      <details className={styles.settingsDetails}>
        <summary>Eventos y ambiente de pausas</summary>
        <div className={styles.events}>
          {VOICE_FAMILIES.map(family => (
            <label key={family}>
              <input
                type='checkbox'
                checked={prefs.events[family]}
                disabled={disabled}
                onChange={event => void control({ events: { [family]: event.target.checked } })}
              />
              {familyLabels[family]}
            </label>
          ))}
        </div>
        <div className={styles.settingsRow}>
          <label className={styles.check}>
            <input
              type='checkbox'
              aria-label='Sonido de pausa'
              checked={prefs.ambienceEnabled}
              disabled={disabled}
              onChange={event => void control({ ambienceEnabled: event.target.checked })}
            />
            Sonido de pausa
          </label>
          <label>
            Volumen de ambiente
            <output>
              {draftVolume ?? Math.round(prefs.ambienceVolume * 100)}
              %
            </output>
            <input
              type='range'
              aria-label='Volumen de ambiente'
              min='0'
              max='100'
              step='5'
              disabled={disabled}
              value={draftVolume ?? Math.round(prefs.ambienceVolume * 100)}
              onChange={event => setDraftVolume(Number(event.target.value))}
              onPointerUp={event => commitVolume(Number(event.currentTarget.value))}
              onKeyUp={(event) => { if (['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) commitVolume(Number(event.currentTarget.value)) }}
            />
          </label>
          <label>
            Corte de jornada (Lima)
            <input
              type='number'
              aria-label='Hora de corte de jornada'
              min='0'
              max='23'
              defaultValue={prefs.cutoffHour}
              key={prefs.cutoffHour}
              disabled={disabled}
              onBlur={(event) => { if (Number(event.target.value) !== prefs.cutoffHour) void control({ cutoffHour: Number(event.target.value) }) }}
            />
          </label>
        </div>
        <p className={styles.hint}>El ambiente solo suena con jornada abierta y modo automático; cede inmediatamente a canciones, anuncios y micrófono.</p>
        {session?.status === 'OPEN' && prefs.automation && <Button disabled={disabled} onClick={() => void send(ANIMATION_SESSION, { operation: 'celebrate', confirmed: true })}>Confirmar celebración</Button>}
      </details>
    </section>
  )
}
