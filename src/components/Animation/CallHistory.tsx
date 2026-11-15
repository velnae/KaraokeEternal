import React from 'react'
import Button from 'components/Button/Button'
import type { CallPart, CallRequestState } from 'shared/karaokeCalls'
import styles from './KaraokeCallPilot.css'

export default function CallHistory ({ items, kind, busy, canPrepare, submit, listen }: {
  items: CallRequestState[]
  kind: 'singing' | 'listening'
  busy: boolean
  canPrepare: boolean
  submit: (suffix: string, body: object) => Promise<boolean>
  listen: (part: CallPart) => void
}) {
  return (
    <section aria-label={kind === 'singing' ? 'Historial de llamados' : 'Historial para escuchar'}>
      {!items.length && <p role='status'>{kind === 'singing' ? 'Todavía no hay llamados para cantar.' : 'Todavía no hay presentaciones para escuchar.'}</p>}
      <ul className={styles.list}>
        {items.map((item) => {
          const different = !!item.playedResult && item.playedResult.id !== item.result?.id
          const recovering = !!item.recoveryJob && ['queued', 'generating', 'preparing'].includes(item.recoveryJob.status)
          return (
            <li key={item.queueId} className={styles.item}>
              <strong translate='no'>{item.title}</strong>
              <p translate='no'>{`${item.performer}${item.tableLabel ? ` · ${item.tableLabel}` : ''}`}</p>
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
            </li>
          )
        })}
      </ul>
    </section>
  )
}
