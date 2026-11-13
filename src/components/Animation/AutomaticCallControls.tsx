import React from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import type { CallControls, CallPart, CallRequestState, CallSnapshot } from 'shared/karaokeCalls'
import styles from './KaraokeCallPilot.css'

function CallHistoryActions ({ item, kind, busy, canPrepare, submit, listen }: {
  item: CallRequestState
  kind: 'singing' | 'listening'
  busy: boolean
  canPrepare: boolean
  submit: (suffix: string, body: object) => Promise<boolean>
  listen: (part: CallPart) => void
}) {
  const different = !!item.playedResult && item.playedResult.id !== item.result?.id
  const recovering = !!item.recoveryJob && ['queued', 'generating', 'preparing'].includes(item.recoveryJob.status)
  return (
    <>
      <span className={styles.notice}>
        {item.playback && item.playback !== 'pending'
          ? ({ playing: 'Anunciando', played: 'Anunciado', omitted: 'Omitido', interrupted: 'Interrumpido' })[item.playback]
          : ({ waiting: 'En espera', preparing: 'Preparando voz', ready: 'Listo para su turno', fallback: 'Usará el respaldo disponible', cancelled: 'Pedido finalizado o retirado' })[item.status]}
        {item.usedFallback && ' · Respaldo'}
      </span>
      {item.playbackReason && <p className={styles.hint}>{item.playbackReason}</p>}
      {!item.playbackReason && item.reason && (!item.result || item.playback === 'pending') && <p className={styles.hint}>{item.reason}</p>}
      <div className={styles.actions}>
        {item.result && <Button onClick={() => listen(item.result!)} aria-label={`Escuchar ${kind === 'singing' ? 'llamado' : 'presentación'} de ${item.performer}`}>{different ? 'Escuchar preparado' : 'Escuchar'}</Button>}
        {different && <Button onClick={() => listen(item.playedResult!)} aria-label={`Escuchar audio anunciado de ${item.performer}`}>Escuchar anunciado</Button>}
        {item.canRecover && <Button disabled={busy || recovering} onClick={() => void submit(`karaoke-calls/requests/${item.queueId}/recover`, {})}>Recuperar audio</Button>}
        {kind === 'singing' && item.playback === 'pending' && item.status === 'fallback' && !item.startedAt && <Button disabled={busy || !canPrepare} onClick={() => void submit(`karaoke-calls/requests/${item.queueId}/retry`, { inputKey: item.inputKey })}>Reintentar</Button>}
      </div>
      {recovering && <p role='status'>Recuperando audio…</p>}
      {item.recoveryJob?.error && <p role='alert' className={styles.error}>{item.recoveryJob.error}</p>}
    </>
  )
}

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
  const available = snapshot.intros
  const canPrepare = snapshot.voice.configured && snapshot.voice.config.enabled && !snapshot.error
  const help = busy
    ? 'Guardando…'
    : automatic.bankPreparing
      ? 'Preparando el lote solicitado…'
      : !canPrepare
          ? automatic.message || snapshot.error || 'Configure y habilite la voz de Gemini antes de preparar.'
          : ''
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
          Llamados para cantar
        </label>
      </div>
      <label className={styles.switch}>
        <input
          type='checkbox'
          role='switch'
          aria-label='Presentar pedidos para escuchar'
          checked={!!controls.listeningEnabled}
          disabled={busy}
          onChange={event => void configure({ ...controls, listeningEnabled: event.target.checked })}
        />
        Presentar pedidos para escuchar
      </label>
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
      <details className={styles.requestDetails}>
        <summary>{`Pedidos de karaoke (${automatic.requests.length})`}</summary>
        {!automatic.requests.length && <p className={styles.hint}>Los pedidos aceptados para cantar aparecerán aquí. No necesitan una preparación manual.</p>}
        <ul className={styles.list}>
          {automatic.requests.map(item => (
            <li key={item.queueId} className={styles.item}>
              <strong translate='no'>{item.title}</strong>
              <p translate='no'>{`${item.performer}${item.tableLabel ? ` · ${item.tableLabel}` : ''}`}</p>
              <CallHistoryActions item={item} kind='singing' busy={busy} canPrepare={canPrepare && controls.enabled} submit={submit} listen={listen} />
            </li>
          ))}
        </ul>
      </details>
      {!!automatic.listeningRequests?.length && (
        <details className={styles.requestDetails}>
          <summary>{`Pedidos para escuchar (${automatic.listeningRequests.length})`}</summary>
          <ul className={styles.list}>
            {automatic.listeningRequests.map(item => (
              <li key={item.queueId} className={styles.item}>
                <strong translate='no'>{item.title}</strong>
                <p translate='no'>{`${item.performer}${item.tableLabel ? ` · ${item.tableLabel}` : ''}`}</p>
                <CallHistoryActions item={item} kind='listening' busy={busy} canPrepare={canPrepare} submit={submit} listen={listen} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
