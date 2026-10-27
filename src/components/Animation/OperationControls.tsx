import React, { useRef, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import Button from 'components/Button/Button'
import { animationRequest, syncAnimation } from 'lib/animationApi'
import { ANIMATION_CONTROL, ANIMATION_SESSION, animationPrefs, familyLabels, VOICE_FAMILIES } from 'shared/animation'
import styles from './PhaseTwo.css'

export default function OperationControls ({ settings = false }: { settings?: boolean }) {
  const { snapshot, connected } = useAppSelector(state => state.animation)
  const roomId = useAppSelector(state => state.user.roomId)
  const current = snapshot?.roomId === roomId ? snapshot : null
  const prefs = animationPrefs(current?.prefs)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [volume, setVolume] = useState<number | null>(null)
  const [ambience, setAmbience] = useState<number | null>(null)
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
  const disabled = !connected || !current || busy
  const session = current?.session
  const commit = (key: 'volume' | 'ambienceVolume', value: number) => {
    if (disabled || inFlight.current) return
    void control({ [key]: value / 100 }).finally(() => {
      setVolume(null)
      setAmbience(null)
    })
  }
  return (
    <section className={styles.operation} aria-label={settings ? 'Configuración del animador' : 'Funcionamiento del animador'}>
      {!settings
        ? (
            <>
              <div className={styles.settingsRow}>
                <label>
                  Modo
                  <select aria-label='Funcionamiento' value={prefs.automation ? 'automatic' : 'manual'} disabled={disabled} onChange={event => void control({ automation: event.target.value === 'automatic' })}>
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
                    <div className={styles.actions}>
                      {!session && <Button disabled={disabled} onClick={() => void send(ANIMATION_SESSION, { operation: 'open' })}>Iniciar jornada</Button>}
                      {session?.status === 'OPEN' && <Button disabled={disabled} onClick={() => void send(ANIMATION_SESSION, { operation: 'close' })}>Cerrar jornada</Button>}
                      {session?.status === 'CLOSING' && <Button disabled={disabled} onClick={() => void send(ANIMATION_SESSION, { operation: 'finish' })}>Finalizar sin despedida</Button>}
                    </div>
                  </div>
                )}
              </div>
              {prefs.automation && current?.lastOmission && <p role='status' className={styles.notice}>{current.lastOmission}</p>}
              {prefs.automation && session?.status === 'OPEN' && <div className={styles.actions}><Button disabled={disabled} onClick={() => void send(ANIMATION_SESSION, { operation: 'celebrate', confirmed: true })}>Confirmar celebración</Button></div>}
            </>
          )
        : (
            <>
              <div className={styles.settingsRow}>
                <label>
                  Volumen de voz
                  <output>
                    {volume ?? Math.round(prefs.volume * 100)}
                    %
                  </output>
                  <input type='range' aria-label='Volumen de voz' min='0' max='100' step='5' value={volume ?? Math.round(prefs.volume * 100)} disabled={disabled} onChange={event => setVolume(Number(event.target.value))} onPointerUp={event => commit('volume', Number(event.currentTarget.value))} onBlur={event => commit('volume', Number(event.currentTarget.value))} onKeyUp={(event) => { if (['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) commit('volume', Number(event.currentTarget.value)) }} />
                </label>
                <label>
                  Volumen de ambiente
                  <output>
                    {ambience ?? Math.round(prefs.ambienceVolume * 100)}
                    %
                  </output>
                  <input type='range' aria-label='Volumen de ambiente' min='0' max='100' step='5' value={ambience ?? Math.round(prefs.ambienceVolume * 100)} disabled={disabled} onChange={event => setAmbience(Number(event.target.value))} onPointerUp={event => commit('ambienceVolume', Number(event.currentTarget.value))} onKeyUp={(event) => { if (['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) commit('ambienceVolume', Number(event.currentTarget.value)) }} />
                </label>
              </div>
              <label className={styles.check}>
                <input type='checkbox' aria-label='Sonido de pausa' checked={prefs.ambienceEnabled} disabled={disabled} onChange={event => void control({ ambienceEnabled: event.target.checked })} />
                Ambiente entre canciones
              </label>
              <details className={styles.settingsDetails}>
                <summary>Eventos automáticos</summary>
                <div className={styles.events}>
                  {VOICE_FAMILIES.map(family => (
                    <label key={family}>
                      <input type='checkbox' checked={prefs.events[family]} disabled={disabled} onChange={event => void control({ events: { [family]: event.target.checked } })} />
                      {familyLabels[family]}
                    </label>
                  ))}
                </div>
              </details>
              <details className={styles.settingsDetails}>
                <summary>Horario de jornada</summary>
                <label>
                  Corte de jornada (Lima)
                  <input aria-label='Hora de corte de jornada' type='number' min='0' max='23' defaultValue={prefs.cutoffHour} key={prefs.cutoffHour} disabled={disabled} onBlur={(event) => { if (Number(event.target.value) !== prefs.cutoffHour) void control({ cutoffHour: Number(event.target.value) }) }} />
                </label>
              </details>
            </>
          )}
      {error && <p role='alert' className={styles.notice}>{error}</p>}
    </section>
  )
}
