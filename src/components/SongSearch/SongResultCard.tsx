import React, { useId, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import SongArtwork from 'components/SongArtwork/SongArtwork'
import SaveToPlaylist from 'components/Playlists/SaveToPlaylist'
import type { SongSearchResult } from 'shared/songSource'
import type { QueueItem } from 'shared/types'
import type { RequestReceipt } from 'routes/Participant/requests'
import { requestStatusLabels } from 'routes/Participant/model'
import styles from './SongSearch.css'
import { requestIntentLabels, type RequestIntent } from 'shared/requestIntent'
import SongPreviewModal from './SongPreviewModal'
import { getPreviewRestriction, previewRestrictionMessage, rememberPreviewRestriction, subscribePreviewRestrictions } from './previewAvailability'

interface RequestState {
  receipt?: RequestReceipt
  active?: QueueItem
  onRequest: (intent?: RequestIntent) => void
}

function RequestAction ({ receipt, active, onRequest, admin, house = false, connected, blocker, description }: RequestState & {
  admin: boolean
  house?: boolean
  connected: boolean
  blocker: string | null
  description: string
}) {
  const sending = receipt?.phase === 'sending'
  const uncertain = receipt?.phase === 'uncertain'
  const confirmed = active && !sending && !uncertain
  const action = sending ? (admin ? 'Agregando…' : 'Enviando…') : uncertain ? 'Comprobar pedido' : receipt?.phase === 'error' ? 'Reintentar' : house ? 'Agregar a la casa' : admin ? 'Agregar a la cola' : 'Pedir'
  if (receipt?.code === 'MUSIC_BLOCKED' && !confirmed) return <span>No disponible. Busca otra canción.</span>
  return confirmed
    ? (
        <Link className={styles.confirmed} data-status={active.status} to={house ? '/queue?view=house' : admin ? '/queue' : '/requests'} state={admin ? undefined : { requestedQueueId: active.queueId }} aria-describedby={description}>
          <Icon icon='CHECK' size={20} />
          {admin && active.status === 'PLAYING' ? 'Reproduciendo' : house ? 'En De la casa' : requestStatusLabels[active.status]}
        </Link>
      )
    : (
        <Button className={house ? styles.secondaryAction : styles.add} variant={house ? 'default' : 'primary'} aria-describedby={description} disabled={!connected || sending || (!uncertain && !!blocker)} onClick={() => onRequest()}>
          {admin && !house && !sending && !uncertain && receipt?.phase !== 'error' && <Icon icon='PLUS' size={20} />}
          {action}
        </Button>
      )
}

export default function SongResultCard ({ result, receipt, active, admin = false, house, connected, blocker, blockerDescriptionId, onRequest, requestIntent, previewScope }: RequestState & {
  result: SongSearchResult
  requestIntent?: RequestIntent
  admin?: boolean
  house?: RequestState
  connected: boolean
  blocker: string | null
  blockerDescriptionId?: string
  previewScope?: string
}) {
  const id = useId()
  const card = useRef<HTMLElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewKey = previewScope ? `${previewScope}:${result.sourceId}` : ''
  const restriction = useSyncExternalStore(subscribePreviewRestrictions, () => getPreviewRestriction(previewKey))
  const unavailable = previewRestrictionMessage(restriction)
  const [intent, setIntent] = useState<RequestIntent>(receipt?.requestIntent ?? 'LISTEN')
  const [moreOpen, setMoreOpen] = useState(house?.receipt?.phase === 'uncertain' || house?.receipt?.phase === 'error')
  const moreButton = useRef<HTMLButtonElement>(null)
  const sending = receipt?.phase === 'sending'
  const uncertain = receipt?.phase === 'uncertain'
  const confirmed = active && !sending && !uncertain
  const description = [`${id}-title`, `${id}-message`, blockerDescriptionId].filter(Boolean).join(' ')
  const openPreview = () => {
    if (!connected || sending || blocker || unavailable || confirmed || uncertain || receipt?.code === 'MUSIC_BLOCKED') return
    opener.current = document.activeElement as HTMLElement | null
    setPreviewOpen(true)
  }
  const closePreview = () => {
    setPreviewOpen(false)
    requestAnimationFrame(() => {
      const target = opener.current
      if (target?.isConnected && !target.matches(':disabled')) target.focus()
      else card.current?.focus()
    })
  }
  const request = () => {
    // Reconcile an existing uncertain request without creating another preview/order.
    if (previewKey && !uncertain) openPreview()
    else onRequest(requestIntent ?? intent)
  }
  return (
    <article
      ref={card}
      tabIndex={-1}
      className={styles.result}
      aria-labelledby={`${id}-title`}
      data-source-id={result.sourceId}
      data-participant={!admin}
      data-state={confirmed ? active.status : unavailable ? 'unavailable' : receipt?.phase || 'available'}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && moreOpen && !(event.target as HTMLElement).closest('dialog')) {
          setMoreOpen(false)
          moreButton.current?.focus()
        }
      }}
    >
      <div className={styles.artwork}>
        {previewKey && !confirmed
          ? (
              <button type='button' className={styles.previewButton} onClick={openPreview} disabled={!connected || sending || uncertain || !!blocker || !!unavailable} aria-label={`Previsualizar ${result.title}`} aria-describedby={description} aria-haspopup='dialog'>
                <SongArtwork thumbnailUrl={result.thumbnailUrl} durationSeconds={result.durationSeconds} />
                <span className={styles.playOverlay}><Icon icon='PLAY' size={30} /></span>
              </button>
            )
          : <SongArtwork thumbnailUrl={result.thumbnailUrl} durationSeconds={result.durationSeconds} />}
      </div>
      <div className={styles.details}>
        <h2 id={`${id}-title`} translate='no'>{result.title}</h2>
        <p translate='no'>{result.artistOrChannel}</p>
        {!admin && confirmed && active.requestIntent && <span className={styles.intentLabel}>{requestIntentLabels[active.requestIntent]}</span>}
        {unavailable && !confirmed && <span className={styles.unavailable}>No disponible</span>}
      </div>
      {!confirmed && !requestIntent && (
        <fieldset className={styles.intent} disabled={sending || uncertain} aria-label='Tipo de pedido'>
          <legend>Este pedido es para</legend>
          <div className={styles.options}>
            <label>
              <input type='radio' name={`${id}-intent`} value='SING' checked={intent === 'SING'} onChange={() => setIntent('SING')} />
              Cantar karaoke
            </label>
            <label>
              <input type='radio' name={`${id}-intent`} value='LISTEN' checked={intent === 'LISTEN'} onChange={() => setIntent('LISTEN')} />
              Escuchar música
            </label>
          </div>
        </fieldset>
      )}
      {admin && confirmed && active.requestIntent && <span className={styles.intentLabel}>{requestIntentLabels[active.requestIntent]}</span>}
      <div className={styles.resultActions}>
        <div className={styles.primaryAction} aria-live='polite'><RequestAction receipt={receipt} active={active} onRequest={request} admin={admin} connected={connected} blocker={unavailable || blocker} description={description} /></div>
        {admin && <button ref={moreButton} type='button' className={styles.moreButton} aria-label={`Más opciones para ${result.title}`} title='Más opciones' aria-expanded={moreOpen} aria-controls={`${id}-options`} onClick={() => setMoreOpen(value => !value)}><Icon icon='MORE_HORIZ' size={24} /></button>}
      </div>
      {admin && moreOpen && (
        <div id={`${id}-options`} className={styles.extraOptions} role='group' aria-label={`Opciones para ${result.title}`}>
          {house && <div aria-live='polite'><RequestAction {...house} admin house connected={connected} blocker={blocker} description={description} /></div>}
          <SaveToPlaylist source={result.source} sourceId={result.sourceId} title={result.title} />
        </div>
      )}
      <div id={`${id}-message`} className={styles.message} role='status'>
        {unavailable && !confirmed && <p className={styles.warning}>{unavailable}</p>}
        {admin && sending && <p>Esperando confirmación de la sala…</p>}
        {uncertain && <p className={styles.warning}>{admin ? 'No se recibió la confirmación. Comprueba el pedido para evitar duplicarlo.' : 'Pedido sin confirmar.'}</p>}
        {receipt?.phase === 'error' && !confirmed && <p className={styles.warning}>{receipt.message}</p>}
        {!confirmed && !sending && blocker && !blockerDescriptionId && <p>{blocker}</p>}
        {house?.receipt?.phase === 'uncertain' && <p className={styles.warning}>Pedido de la casa sin confirmar. Usa «Comprobar pedido» en Más opciones.</p>}
        {house?.receipt?.phase === 'error' && !house.active && <p className={styles.warning}>{house.receipt.message}</p>}
      </div>
      {previewOpen && <SongPreviewModal key={previewKey} result={result} receipt={receipt} blocker={!connected ? 'Sin conexión. Espera a reconectar.' : blocker} onClose={closePreview} onConfirm={() => onRequest(requestIntent ?? intent)} onUnavailable={code => rememberPreviewRestriction(previewKey, code)} />}
    </article>
  )
}
