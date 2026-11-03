import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ensureState } from 'redux-optimistic-ui'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import store from 'store/store'
import { fetchCurrentRoom } from 'store/modules/rooms'
import getRoundRobinQueue from 'routes/Queue/selectors/getRoundRobinQueue'
import { queuePush } from 'routes/Queue/modules/queue'
import { QUEUE_REMOVE } from 'shared/actionTypes'
import type { QueueItem } from 'shared/types'
import { tableMode } from 'shared/tableAccess'
import { normalizeQueuePrefs } from 'shared/queueRules'
import { isQueueHistoryHidden } from 'shared/queueCleanup'
import socket from 'lib/socket'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import { useSongRequests } from 'components/SongSearch/useSongRequests'
import SongResultCard from 'components/SongSearch/SongResultCard'
import { estimatedWait, isPendingRequest, requestPriority, requestStatusLabels } from './model'
import { useConnection } from './useConnection'
import { useYouTubeSearch } from './useYouTubeSearch'
import SongArtwork from 'components/SongArtwork/SongArtwork'
import theme from 'styles/karaokeTheme.css'
import styles from './ParticipantView.css'
import QueueGreeting from 'components/Greetings/QueueGreeting'
import useGreetings from 'components/Greetings/useGreetings'
import { YOUTUBE_MAX_DURATION_SECONDS, youtubeSearchCanRetry, youtubeSearchError } from 'shared/youtubeSearch'
import { requestIntentLabels, type RequestIntent } from 'shared/requestIntent'
import searchStyles from 'components/SongSearch/SongSearch.css'

const ParticipantView = ({ page = 'search' }: { page?: 'search' | 'requests' | 'room' }) => {
  const dispatch = useAppDispatch()
  const connected = useConnection()
  const user = useAppSelector(state => state.user)
  const room = useAppSelector(state => state.rooms.entities[user.roomId])
  const queue = useAppSelector(state => ensureState(state.queue))
  const ordered = useAppSelector(getRoundRobinQueue)
  const status = useAppSelector(state => state.status)
  const { headerHeight, footerHeight } = useAppSelector(state => state.ui)
  const [query, setQuery] = useState('')
  const [intent, setIntent] = useState<RequestIntent>('LISTEN')
  const [submitted, setSubmitted] = useState<{ query: string, intent: RequestIntent } | null>(null)
  const search = useYouTubeSearch(page === 'search')
  const matchesSubmission = submitted?.query === query.trim() && submitted.intent === intent
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [cancelMessage, setCancelMessage] = useState('')
  const { controller, receipts } = useSongRequests()
  const greetings = useGreetings(page === 'requests')
  const unsettled = Object.values(receipts).filter(receipt => receipt.phase !== 'confirmed')

  useEffect(() => {
    if (connected) void dispatch(fetchCurrentRoom())
  }, [connected, dispatch])

  const items = Object.values(queue.entities).filter((item): item is QueueItem => item.isOptimistic !== true)
  const own = items.filter(item => item.userId === user.userId && item.origin === 'PARTICIPANT' && !isQueueHistoryHidden(item))
  const rules = normalizeQueuePrefs(room?.prefs?.queue)
  const pending = own.filter(isPendingRequest).length
  const remaining = Math.max(0, rules.maxPendingPerParticipant - pending)
  const ready = connected && !queue.isLoading && !!room
  const canRequest = ready && room.status === 'open' && remaining > 0
  const upcoming = ordered.result.map(id => ordered.entities[id]).filter((item): item is QueueItem =>
    item.status === 'APPROVED' || item.status === 'PLAYING')
  const current = items.find(item => item.queueId === status.queueId && !status.isAtQueueEnd && item.status === 'PLAYING')
  const next = upcoming.find(item => item.queueId !== current?.queueId)
  const activePlayer = connected && status.isPlayerPresent

  const cancel = async (item: QueueItem) => {
    if (!connected || cancelling !== null || !window.confirm(`¿Cancelar tu pedido de «${item.title}»?`)) return
    setCancelling(item.queueId)
    setCancelMessage('')
    try {
      const response = await socket.timeout(12000).emitWithAck('action', { type: QUEUE_REMOVE, payload: { queueId: item.queueId, withReceipt: true } })
      const account = store.getState().user
      if (account.userId === user.userId && account.roomId === user.roomId && response.payload) dispatch(queuePush(response.payload))
      setCancelMessage(response.error || 'Pedido cancelado')
    } catch { setCancelMessage('Cancelación sin confirmar. Revisa tus pedidos al reconectar.') }
    setCancelling(null)
  }

  const renderItem = (item: QueueItem, personal: boolean) => {
    const index = upcoming.findIndex(entry => entry.queueId === item.queueId)
    const wait = activePlayer && status.isPlaying && current && index >= 0 && item.status === 'APPROVED'
      ? estimatedWait(upcoming.slice(0, index), status.queueId, status.position)
      : null
    return (
      <article key={item.queueId} className={styles.card} data-status={item.status} data-queue-id={item.queueId}>
        <div className={styles.details}>
          <div className={styles.cardStatus}>
            <span className={styles.badge}>{requestStatusLabels[item.status]}</span>
            {item.requestIntent && item.requestIntent !== 'UNKNOWN' && <span className={styles.badge}>{requestIntentLabels[item.requestIntent]}</span>}
            {wait !== null && <span className={styles.wait} aria-label={`Espera estimada: ${wait < 1 ? 'menos de 1 minuto' : `${wait} minutos`}`}>{wait < 1 ? '< 1 min' : `≈ ${wait} min`}</span>}
          </div>
          <div className={styles.queuedSong}>
            <SongArtwork thumbnailUrl={item.thumbnailUrl} />
            <div>
              <h2 id={`request-title-${item.queueId}`} translate='no'>{item.title}</h2>
              <p translate='no'>{personal ? item.artistOrChannel : item.userDisplayName}</p>
              {item.tableLabelSnapshot && <p>{item.tableLabelSnapshot}</p>}
            </div>
          </div>
          {personal && item.status === 'FAILED' && <Link className={styles.textAction} to='/library'>Buscar otra versión</Link>}
          {personal && greetings.byQueue[item.queueId] && (
            <QueueGreeting
              greeting={greetings.byQueue[item.queueId]}
              descriptionId={`request-title-${item.queueId}`}
              paused={greetings.snapshot?.paused}
              busy={greetings.busy}
              onRemove={greetings.byQueue[item.queueId].status === 'QUEUED' ? () => void greetings.execute('remove', { greetingId: greetings.byQueue[item.queueId].greetingId }) : undefined}
            />
          )}
        </div>
        {personal && isPendingRequest(item) && (
          <Button className={styles.cancel} aria-label='Cancelar pedido' aria-describedby={`request-title-${item.queueId}`} disabled={!connected || cancelling !== null} onClick={() => { void cancel(item) }}>
            {cancelling === item.queueId ? 'Cancelando…' : 'Cancelar pedido'}
          </Button>
        )}
      </article>
    )
  }

  return (
    <main className={`${theme.theme} ${styles.container}`} style={{ paddingTop: headerHeight + 16, paddingBottom: `calc(${footerHeight + 32}px + env(safe-area-inset-bottom))` }}>
      <div className={styles.identity}>
        <span className={styles.roomName}>
          <Icon icon='MICROPHONE' size={20} />
          <span translate='no'>{room?.name || 'Tu sala'}</span>
        </span>
        <Link to='/account' aria-label={`Mi cuenta: ${user.name}`}>
          <Icon icon='PERSON' size={20} />
          <span translate='no'>{user.name}</span>
        </Link>
      </div>
      {!connected && <p role='status' className={styles.notice}>Sin conexión · Reconectando…</p>}
      {user.tableLabel && tableMode(room?.prefs) !== 'OFF' && <p className={styles.notice}>{user.tableLabel}</p>}
      {room?.status === 'closed' && <p role='status' className={styles.notice}>Sala cerrada</p>}
      {activePlayer && next?.userId === user.userId && <p role='status' className={styles.notice}>Tu turno sigue</p>}

      <div className={styles.pageHeading}>
        <h1>{page === 'search' ? '¿Qué quieres pedir?' : page === 'requests' ? 'Mis pedidos' : 'En la sala'}</h1>
        {page !== 'room' && ready && (
          <Link
            to='/requests'
            className={styles.allowance}
            aria-label={`${pending} de ${rules.maxPendingPerParticipant} pedidos pendientes${remaining === 0 ? '. Límite alcanzado' : ''}`}
          >
            {`${pending}/${rules.maxPendingPerParticipant} pedidos`}
          </Link>
        )}
      </div>
      {connected && !ready && <p role='status'>Actualizando…</p>}

      {page === 'search' && (
        <>
          <form
            className={styles.search}
            role='search'
            onSubmit={(event) => {
              event.preventDefault()
              if (query.trim().length < 2) return
              setSubmitted({ query: query.trim(), intent })
              void search.submit(query, intent === 'SING' ? 'karaoke' : 'all')
            }}
          >
            <fieldset className={styles.searchIntent}>
              <legend>Quiero</legend>
              <div className={searchStyles.options}>
                <label>
                  <input type='radio' name='request-intent' checked={intent === 'SING'} onChange={() => setIntent('SING')} />
                  Cantar karaoke
                </label>
                <label>
                  <input type='radio' name='request-intent' checked={intent === 'LISTEN'} onChange={() => setIntent('LISTEN')} />
                  Escuchar música
                </label>
              </div>
            </fieldset>
            <div className={styles.searchRow}>
              <input id='youtube-query' type='search' aria-label='Buscar canción o artista' aria-describedby='youtube-search-help' value={query} onChange={event => setQuery(event.target.value)} placeholder='Canción, artista o enlace' maxLength={200} enterKeyHint='search' />
              <Button type='submit' disabled={!connected || query.trim().length < 2}>Buscar</Button>
            </div>
            <p id='youtube-search-help' className={styles.searchHelp}>{`Canciones de hasta ${YOUTUBE_MAX_DURATION_SECONDS / 60} minutos. Escribe al menos 2 caracteres y pulsa Buscar.`}</p>
          </form>
          <div aria-live='polite'>
            {!matchesSubmission && query.trim().length >= 2 && <p>Pulsa Buscar para ver los resultados.</p>}
            {matchesSubmission && search.isLoading && <p>Buscando…</p>}
            {matchesSubmission && search.error && (
              <div className={styles.notice}>
                <p>{youtubeSearchError(search.code)}</p>
                {youtubeSearchCanRetry(search.code) && <Button disabled={!connected} onClick={() => { void search.submit(search.query) }}>Reintentar</Button>}
              </div>
            )}
            {matchesSubmission && search.query && !search.isLoading && !search.error && search.results.length === 0 && (
              <div className={styles.empty}>
                <p>{`No encontramos canciones de hasta ${YOUTUBE_MAX_DURATION_SECONDS / 60} minutos.`}</p>
                <p>Prueba otro título, artista o un enlace de YouTube.</p>
              </div>
            )}
          </div>
          {matchesSubmission && search.results.map((result) => {
            const receipt = receipts[result.sourceId]
            const active = own.find(item => item.externalId === result.sourceId && (isPendingRequest(item) || item.status === 'PLAYING'))
            return (
              <SongResultCard
                key={result.sourceId}
                result={result}
                requestIntent={submitted.intent}
                receipt={receipt}
                active={active}
                connected={connected}
                blocker={!connected ? 'Sin conexión. Espera a reconectar para pedir la canción.' : !ready ? 'Actualizando la sala. Espera un momento.' : room.status === 'closed' ? 'Sala cerrada. Consulta al organizador.' : !canRequest ? 'Límite alcanzado. Revisa Mis pedidos antes de agregar otra canción.' : null}
                onRequest={(greeting, intent) => { void controller.request(result.sourceId, result.title, greeting, intent) }}
              />
            )
          })}
        </>
      )}

      {page === 'requests' && (
        <>
          {cancelMessage && <p role='status'>{cancelMessage}</p>}
          {connected && greetings.error && <p role='alert' className={styles.notice}>{greetings.error}</p>}
          {unsettled.map(receipt => (
            <article key={receipt.requestId} className={styles.card}>
              <h2 translate='no'>{receipt.title}</h2>
              {receipt.phase !== 'sending' && <p role='status'>{receipt.phase === 'error' ? receipt.message : 'Sin confirmar'}</p>}
              <Button disabled={!connected || receipt.phase === 'sending' || (receipt.phase === 'error' && !canRequest)} onClick={() => { void controller.request(receipt.sourceId, receipt.title) }}>{receipt.phase === 'sending' ? 'Enviando…' : receipt.phase === 'error' ? 'Reintentar' : 'Comprobar pedido'}</Button>
            </article>
          ))}
          {own.length === 0 && unsettled.length === 0 && !queue.isLoading && (
            <div className={styles.empty}>
              <h2>Sin pedidos</h2>
              <Link to='/library'>Buscar una canción</Link>
            </div>
          )}
          {own.sort((a, b) => requestPriority(b) - requestPriority(a) || b.queueId - a.queueId).map(item => renderItem(item, true))}
        </>
      )}
      {page === 'room' && (
        <>
          <h2>Ahora</h2>
          {activePlayer && current ? renderItem(current, false) : <p>{activePlayer ? 'Sin reproducción' : 'Reproductor desconectado'}</p>}
          <h2>A continuación</h2>
          {upcoming.filter(item => item.queueId !== current?.queueId).map(item => renderItem(item, false))}
          {upcoming.length === 0 && (
            <p>
              <Link to='/library'>Pedir una canción</Link>
            </p>
          )}
        </>
      )}
    </main>
  )
}

export default ParticipantView
