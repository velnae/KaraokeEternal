import React from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import type { CallControls, CallPart, CallSnapshot } from 'shared/karaokeCalls'
import styles from './KaraokeCallPilot.css'

export default function AutomaticCallControls ({ snapshot, busy, configure, submit, listen }: {
  snapshot: CallSnapshot
  busy: boolean
  configure: (controls: CallControls) => Promise<boolean>
  submit: (suffix: string, body: object) => Promise<boolean>
  listen: (part: CallPart) => void
}) {
  const automatic = snapshot.automation
  if (!automatic) return null
  const { controls } = automatic
  const available = snapshot.intros.filter(part => part.profileKey === snapshot.profileKey)
  const canPrepare = snapshot.voice.configured && snapshot.voice.config.enabled && !snapshot.error
  const help = busy
    ? 'Guardando…'
    : !canPrepare
        ? automatic.message || snapshot.error || 'Configure y habilite la voz de Gemini antes de preparar.'
        : 'Prepare las mesas una vez. Los pedidos para cantar usarán sus datos y los audios guardados.'
  return (
    <section className={styles.automatic} aria-label='Funcionamiento automático de llamados'>
      <div className={styles.automaticHeading}>
        <h3>Funcionamiento automático</h3>
        <label className={styles.switch}>
          <input
            type='checkbox'
            role='switch'
            aria-label='Llamados automáticos'
            checked={controls.enabled}
            disabled={busy}
            onChange={event => void configure({ ...controls, enabled: event.target.checked, preparing: event.target.checked })}
          />
          {controls.enabled ? 'Activados' : 'Desactivados'}
        </label>
      </div>
      <p>Cuando toque cantar, el llamado reemplaza al anuncio general. La música para escuchar y de la casa conserva el animador habitual.</p>
      <label className={styles.field}>
        Introducción automática
        <select
          aria-label='Introducción automática'
          disabled={busy}
          value={controls.introIds[0] ?? ''}
          onChange={event => void configure({ ...controls, introIds: event.target.value ? [event.target.value] : [] })}
        >
          <option value=''>Alternar las introducciones disponibles</option>
          {available.map(part => <option key={part.variantId} value={part.variantId}>{part.title}</option>)}
        </select>
      </label>
      <div className={styles.readiness} role='status'>
        <strong>{`Mesas preparadas: ${automatic.tablesReady} de ${automatic.tablesTotal}`}</strong>
        <span>{automatic.fallbackReady ? 'Respaldo general disponible' : 'Respaldo general pendiente'}</span>
      </div>
      <div className={styles.actions}>
        <Button
          variant='primary'
          disabled={busy || !canPrepare}
          aria-describedby='call-setup-help'
          onClick={() => void submit('karaoke-calls/setup', { revision: controls.revision })}
        >
          Preparar mesas
        </Button>
        {controls.preparing && !controls.enabled && <Button disabled={busy} onClick={() => void configure({ ...controls, preparing: false })}>Detener preparación</Button>}
        <Link to='/admin/rooms'>Voces de las mesas</Link>
        <Link to='?view=greeting-voice'>Ajustes de voz</Link>
      </div>
      <p className={styles.hint} id='call-setup-help'>{help}</p>
      {automatic.message && canPrepare && <p className={styles.warning}>{automatic.message}</p>}
      <details className={styles.requestDetails}>
        <summary>{`Pedidos de karaoke (${automatic.requests.length})`}</summary>
        {!automatic.requests.length && <p className={styles.hint}>Los pedidos aceptados para cantar aparecerán aquí. No necesitan una preparación manual.</p>}
        <ul className={styles.list}>
          {automatic.requests.map(item => (
            <li key={item.queueId} className={styles.item}>
              <strong translate='no'>{item.title}</strong>
              <p translate='no'>{`${item.performer}${item.tableLabel ? ` · ${item.tableLabel}` : ''}`}</p>
              <span className={styles.notice}>{item.startedAt ? 'Anunciado' : ({ waiting: 'En espera', preparing: 'Preparando voz', ready: 'Listo para su turno', fallback: 'Usará el respaldo disponible', cancelled: 'Pedido finalizado o retirado' })[item.status]}</span>
              {item.reason && !item.startedAt && <p className={styles.hint}>{item.reason}</p>}
              <div className={styles.actions}>
                {item.result && <Button onClick={() => listen(item.result!)} aria-label={`Escuchar llamado de ${item.performer}`}>Escuchar</Button>}
                {item.status === 'fallback' && !item.startedAt && <Button disabled={busy || !canPrepare} onClick={() => void submit(`karaoke-calls/requests/${item.queueId}/retry`, { inputKey: item.inputKey })}>Reintentar</Button>}
              </div>
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
