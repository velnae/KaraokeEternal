import React from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import type { CallControls, CallSnapshot } from 'shared/karaokeCalls'
import styles from './KaraokeCallPilot.css'

export default function AutomaticCallControls ({ snapshot, busy, configure, submit }: {
  snapshot: CallSnapshot
  busy: boolean
  configure: (controls: CallControls) => Promise<boolean>
  submit: (suffix: string, body: object) => Promise<boolean>
}) {
  const automatic = snapshot.automation
  if (!automatic) return null
  const { controls } = automatic
  const canPrepare = snapshot.voice.configured && snapshot.voice.config.enabled && !snapshot.error
  const help = busy
    ? 'Guardando…'
    : automatic.bankPreparing
      ? 'Preparando el lote solicitado…'
      : !canPrepare
          ? automatic.message || snapshot.error || 'Configure y habilite la voz de llamados antes de preparar.'
          : ''
  return (
    <section className={styles.automatic} aria-label='Funcionamiento automático de llamados'>
      <label className={styles.switch}>
        <input
          type='checkbox'
          role='switch'
          aria-label='Llamados automáticos'
          checked={controls.enabled}
          disabled={busy}
          onChange={event => void configure({ ...controls, enabled: event.target.checked, preparing: event.target.checked })}
        />
        Llamados para cantar
      </label>
      <label className={styles.switch}>
        <input type='checkbox' role='switch' aria-label='Inicio automático de karaoke' checked={!!controls.automaticStart} disabled={busy} onChange={event => void configure({ ...controls, automaticStart: event.target.checked })} />
        Inicio automático de karaoke
      </label>
      <div className={styles.readiness} role='status'>
        <strong>{`Mesas preparadas: ${automatic.tablesReady} de ${automatic.tablesTotal}`}</strong>
        <span>{automatic.fallbackReady ? 'Respaldo general disponible' : 'Respaldo general pendiente'}</span>
      </div>
      <div className={styles.actions}>
        {automatic.bankPaused || automatic.missingBankParts?.length
          ? (
              <Button
                variant='primary'
                disabled={busy || !canPrepare || automatic.bankPreparing}
                aria-describedby={help ? 'call-setup-help' : undefined}
                onClick={() => void submit('karaoke-calls/setup', { revision: controls.revision, quote: automatic.bankQuote })}
              >
                {automatic.bankPaused ? 'Reanudar lote solicitado' : `Generar ${automatic.missingBankParts!.length} audios de plantillas`}
              </Button>
            )
          : <span role='status'>Plantillas disponibles</span>}
        {controls.preparing && !controls.enabled && <Button disabled={busy} onClick={() => void configure({ ...controls, preparing: false })}>Detener preparación</Button>}
        <Link to='/admin/rooms'>Voces de las mesas</Link>
        <Link to='/admin/settings/audio-providers?use=calls'>Ajustes de voz</Link>
      </div>
      {help && <p className={styles.hint} id='call-setup-help'>{help}</p>}
      {!!automatic.missingBankParts?.length && (
        <details>
          <summary>Audios pendientes de preparación</summary>
          <ul>{automatic.missingBankParts.map((title, index) => <li key={index}>{title}</li>)}</ul>
        </details>
      )}
      {automatic.message && canPrepare && <p className={styles.warning}>{automatic.message}</p>}
    </section>
  )
}
