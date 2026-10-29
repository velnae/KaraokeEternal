import React, { useId, useRef, useState } from 'react'
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
import GreetingComposer from 'components/Greetings/GreetingComposer'
import { validateGreeting, type GreetingDraft } from 'shared/greetings'
import { useAppSelector } from 'store/hooks'

interface RequestState {
  receipt?: RequestReceipt
  active?: QueueItem
  onRequest: (greeting?: GreetingDraft | null) => void
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
  const action = sending ? (admin ? 'Agregando…' : 'Enviando…') : uncertain ? 'Comprobar pedido' : receipt?.phase === 'error' ? 'Reintentar' : house ? 'Agregar a la casa' : admin ? 'Agregar a la cola' : 'Pedir canción'
  return confirmed
    ? (
        <Link className={styles.confirmed} data-status={active.status} to={house ? '/queue?view=house' : admin ? '/queue' : '/requests'} aria-describedby={description}>
          <Icon icon='CHECK' size={20} />
          {admin && active.status === 'PLAYING' ? 'Reproduciendo' : house ? 'En De la casa' : requestStatusLabels[active.status]}
        </Link>
      )
    : (
        <Button className={house ? styles.secondaryAction : styles.add} variant={house ? 'default' : 'primary'} aria-describedby={description} disabled={!connected || sending || (!uncertain && !!blocker)} onClick={() => onRequest()}>
          {!house && !sending && !uncertain && receipt?.phase !== 'error' && <Icon icon='PLUS' size={20} />}
          {action}
        </Button>
      )
}

export default function SongResultCard ({ result, receipt, active, admin = false, house, connected, blocker, onRequest }: RequestState & {
  result: SongSearchResult
  admin?: boolean
  house?: RequestState
  connected: boolean
  blocker: string | null
}) {
  const id = useId()
  const sender = useAppSelector(state => state.user.name)
  const [greeting, setGreeting] = useState<GreetingDraft | null>(receipt?.greeting ?? null)
  let greetingError: string | null = null
  if (!admin && greeting) {
    try {
      validateGreeting(greeting, sender)
    } catch (error) { greetingError = (error as Error).message }
  }
  const [moreOpen, setMoreOpen] = useState(house?.receipt?.phase === 'uncertain' || house?.receipt?.phase === 'error')
  const moreButton = useRef<HTMLButtonElement>(null)
  const sending = receipt?.phase === 'sending'
  const uncertain = receipt?.phase === 'uncertain'
  const confirmed = active && !sending && !uncertain
  const description = `${id}-title ${id}-message`
  return (
    <article
      className={styles.result}
      aria-labelledby={`${id}-title`}
      data-source-id={result.sourceId}
      data-participant={!admin}
      data-state={confirmed ? active.status : receipt?.phase || 'available'}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && moreOpen && !(event.target as HTMLElement).closest('dialog')) {
          setMoreOpen(false)
          moreButton.current?.focus()
        }
      }}
    >
      <div><SongArtwork thumbnailUrl={result.thumbnailUrl} durationSeconds={result.durationSeconds} /></div>
      <div className={styles.details}>
        <h2 id={`${id}-title`} translate='no'>{result.title}</h2>
        <p translate='no'>{result.artistOrChannel}</p>
      </div>
      {!admin && !confirmed && <GreetingComposer value={greeting} onChange={setGreeting} locked={sending || uncertain} />}
      <div className={styles.resultActions}>
        <div className={styles.primaryAction} aria-live='polite'><RequestAction receipt={receipt} active={active} onRequest={() => onRequest(admin ? undefined : greeting)} admin={admin} connected={connected} blocker={blocker ?? greetingError} description={description} /></div>
        {admin && <button ref={moreButton} type='button' className={styles.moreButton} aria-label={`Más opciones para ${result.title}`} title='Más opciones' aria-expanded={moreOpen} aria-controls={`${id}-options`} onClick={() => setMoreOpen(value => !value)}><Icon icon='MORE_HORIZ' size={24} /></button>}
      </div>
      {admin && moreOpen && (
        <div id={`${id}-options`} className={styles.extraOptions} role='group' aria-label={`Opciones para ${result.title}`}>
          {house && <div aria-live='polite'><RequestAction {...house} admin house connected={connected} blocker={blocker} description={description} /></div>}
          <SaveToPlaylist source={result.source} sourceId={result.sourceId} title={result.title} />
        </div>
      )}
      <div id={`${id}-message`} className={styles.message} role='status'>
        {sending && <p>Esperando confirmación de la sala…</p>}
        {uncertain && <p className={styles.warning}>No se recibió la confirmación. Comprueba el pedido para evitar duplicarlo.</p>}
        {receipt?.phase === 'error' && !confirmed && <p className={styles.warning}>{receipt.message}</p>}
        {!confirmed && !sending && blocker && <p>{blocker}</p>}
        {!confirmed && !sending && !uncertain && greetingError && <p>{greetingError}</p>}
        {house?.receipt?.phase === 'uncertain' && <p className={styles.warning}>Pedido de la casa sin confirmar. Usa «Comprobar pedido» en Más opciones.</p>}
        {house?.receipt?.phase === 'error' && !house.active && <p className={styles.warning}>{house.receipt.message}</p>}
      </div>
    </article>
  )
}
