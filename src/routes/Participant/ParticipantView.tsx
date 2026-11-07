import React, { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
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
import GreetingComposer from 'components/Greetings/GreetingComposer'
import useGreetings from 'components/Greetings/useGreetings'
import { youtubeSearchCanRetry, youtubeSearchError, youtubeVideoId } from 'shared/youtubeSearch'
import { requestIntentLabels, type RequestIntent } from 'shared/requestIntent'
import searchStyles from 'components/SongSearch/SongSearch.css'
import { musicBlockedStatus, musicBlockedMessage, musicFilteredMessage, musicAllBlockedMessage } from 'shared/musicBlocking'

const ParticipantView = ({ page = 'search' }: { page?: 'search' | 'requests' | 'room' }) => {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const noticeId = useId()
  const requestScope = useRef({ active: true })
  const focusedLocation = useRef('')
  const highlight = useRef({ clear: () => {} })
  const connected = useConnection()
  const user = useAppSelector(state => state.user)
  const room = useAppSelector(state => state.rooms.entities[user.roomId])
  const queue = useAppSelector(state => ensureState(state.queue))
  const ordered = useAppSelector(getRoundRobinQueue)
  const status = useAppSelector(state => state.status)
  const { headerHeight, footerHeight } = useAppSelector(state => state.ui)
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const [intent, setIntent] = useState<RequestIntent>('LISTEN')
  const [submitted, setSubmitted] = useState<{ query: string, intent: RequestIntent } | null>(null)
  const search = useYouTubeSearch(page === 'search')
  const matchesSubmission = submitted?.query === query.trim() && submitted.intent === intent
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [cancelMessage, setCancelMessage] = useState('')
  const replacementId = Number(new URLSearchParams(location.search).get('replace')) || undefined
  const { controller, receipts } = useSongRequests('PARTICIPANT', replacementId)
  const greetings = useGreetings(page === 'requests')
  const unsettled = Object.values(receipts).filter(receipt => receipt.phase !== 'confirmed')

  useEffect(() => {
    if (connected) void dispatch(fetchCurrentRoom())
  }, [connected, dispatch])

  useEffect(() => {
    const scope = { active: true }
    const currentHighlight = highlight.current
    requestScope.current = scope
    return () => {
      scope.active = false
      currentHighlight.clear()
    }
  }, [page, user.roomId, user.userId, location.key])

  useEffect(() => {
    const id = location.state?.requestedQueueId
    if (page !== 'requests' || focusedLocation.current === location.key || !Number.isSafeInteger(id)) return
    if ((location.state?.requestedRoomId !== undefined && location.state.requestedRoomId !== user.roomId)
      || (location.state?.requestedUserId !== undefined && location.state.requestedUserId !== user.userId)) return
    const item = queue.entities[id]
    if (!item || item.isOptimistic === true || item.userId !== user.userId || item.origin !== 'PARTICIPANT') return
    const title = document.getElementById(`request-title-${id}`)
    if (!title) return
    const card = title.closest('article')
    const clear = () => {
      if (card) delete card.dataset.recent
    }
    const frame = requestAnimationFrame(() => {
      focusedLocation.current = location.key
      highlight.current.clear()
      if (card) card.dataset.recent = 'true'
      title.focus({ preventScroll: true })
      card?.scrollIntoView({ block: 'center' })
      const timer = setTimeout(clear, 3000)
      highlight.current.clear = () => {
        clearTimeout(timer)
        clear()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [page, location.key, location.state, queue, user.roomId, user.userId])

  const requestSong = async (sourceId: string, title: string, requestIntent?: RequestIntent) => {
    const scope = requestScope.current
    const receipt = await controller.request(sourceId, title, undefined, requestIntent)
    const account = store.getState().user
    if (!scope.active || account.userId !== user.userId || account.roomId !== user.roomId || receipt?.phase !== 'confirmed') return
    navigate('/requests', { state: { requestedQueueId: receipt.queueId, requestedRoomId: user.roomId, requestedUserId: user.userId } })
  }

  const items = Object.values(queue.entities).filter((item): item is QueueItem => item.isOptimistic !== true)
  const own = items.filter(item => item.userId === user.userId && item.origin === 'PARTICIPANT' && !isQueueHistoryHidden(item))
  const replacedIds = new Set(items.map(item => item.replacesQueueId))
  const replacement = own.find(item => item.queueId === replacementId && item.status === 'FAILED' && !replacedIds.has(item.queueId))
  const rules = normalizeQueuePrefs(room?.prefs?.queue)
  const pending = own.filter(isPendingRequest).length
  const remaining = Math.max(0, rules.maxPendingPerParticipant - pending)
  const ready = connected && !queue.isLoading && !!room
  const canRequest = ready && room.status === 'open' && remaining > 0 && (!replacementId || !!replacement)
  let pageNotice = ''
  if (!connected) pageNotice = 'Sin conexión · Reconectando…'
  else if (room?.status === 'closed') pageNotice = 'Sala cerrada.'
  else if (!ready) pageNotice = 'Actualizando…'
  else if (page === 'search' && replacementId && !replacement) pageNotice = 'Este pedido ya no se puede reemplazar. Revisa Mis pedidos.'
  else if (page === 'search' && !canRequest) pageNotice = 'Límite de pedidos alcanzado. Revisa Mis pedidos.'
  const visibleTable = tableMode(room?.prefs) !== 'OFF' ? user.tableLabel : null
  const shortQuery = query.trim().length === 1
  const searchDescription = [pageNotice ? noticeId : undefined, shortQuery ? `${noticeId}-minimum` : undefined].filter(Boolean).join(' ') || undefined
  const upcoming = ordered.result.map(id => ordered.entities[id]).filter((item): item is QueueItem =>
    item.status === 'APPROVED' || item.status === 'PLAYING')
  const current = items.find(item => item.queueId === status.queueId && !status.isAtQueueEnd && item.status === 'PLAYING')
  const next = upcoming.find(item => item.queueId !== current?.queueId)
  const nextParticipant = upcoming.find(item => item.queueId !== current?.queueId && item.origin === 'PARTICIPANT')
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
    const turnsAhead = ordered.turns.findIndex(turn => turn.ids.includes(item.queueId))
    const wait = activePlayer && status.isPlaying && current && index >= 0 && item.status === 'APPROVED'
      ? estimatedWait(upcoming.slice(0, index), status.queueId, status.position)
      : null
    return (
      <article key={item.queueId} className={styles.card} data-status={item.status} data-queue-id={item.queueId}>
        <div className={styles.details}>
          <div className={styles.cardStatus}>
            <span className={styles.badge}>{item.rejectionReason === 'MUSIC_BLOCKED' ? musicBlockedStatus : requestStatusLabels[item.status]}</span>
            {item.requestIntent && item.requestIntent !== 'UNKNOWN' && <span className={styles.badge}>{requestIntentLabels[item.requestIntent]}</span>}
            {wait !== null && <span className={styles.wait} aria-label={`Espera estimada: ${wait < 1 ? 'menos de 1 minuto' : `${wait} minutos`}`}>{wait < 1 ? '< 1 min' : `≈ ${wait} min`}</span>}
            {item.status === 'APPROVED' && turnsAhead >= 0 && <span className={styles.badge}>{turnsAhead === 0 ? 'Próximo turno de cliente' : `${turnsAhead} ${turnsAhead === 1 ? 'turno' : 'turnos'} por delante`}</span>}
          </div>
          <div className={styles.queuedSong}>
            <SongArtwork thumbnailUrl={item.thumbnailUrl} />
            <div>
              <h2 id={`request-title-${item.queueId}`} tabIndex={-1} translate='no'>{item.title}</h2>
              <p translate='no'>{personal ? item.artistOrChannel : item.userDisplayName}</p>
              {item.tableLabelSnapshot && (!personal || item.tableLabelSnapshot !== visibleTable) && <p>{item.tableLabelSnapshot}</p>}
            </div>
          </div>
          {personal && item.rejectionReason === 'MUSIC_BLOCKED' && (
            <div role='status'>
              <p>Tu pedido fue retirado. Puedes elegir otra canción.</p>
              <Link className={styles.textAction} to='/library'>Buscar otra canción</Link>
            </div>
          )}
          {personal && item.status === 'FAILED' && (replacedIds.has(item.queueId)
            ? <p>Ya elegiste un reemplazo para este pedido.</p>
            : (
                <>
                  <p>La canción falló. Puedes elegir otra versión conservando la antigüedad de tu pedido.</p>
                  <Link className={styles.textAction} to={`/library?replace=${item.queueId}`}>Buscar otra versión</Link>
                </>
              ))}
          {personal && greetings.byQueue[item.queueId] && (
            <QueueGreeting
              greeting={greetings.byQueue[item.queueId]}
              descriptionId={`request-title-${item.queueId}`}
              paused={greetings.snapshot?.paused}
              busy={greetings.busy}
            />
          )}
        </div>
        {personal && (
          <div className={styles.cardActions}>
            {!greetings.byQueue[item.queueId] && (
              <GreetingComposer
                key={`${user.roomId}:${user.userId}:${item.queueId}`}
                sender={item.userDisplayName}
                opportunity={greetings.snapshot?.opportunities?.[item.queueId]}
                pending={isPendingRequest(item)}
                busy={greetings.busy}
                connected={connected}
                descriptionId={`request-title-${item.queueId}`}
                noticeId={pageNotice ? noticeId : undefined}
                onSave={message => greetings.execute('attach', { queueId: item.queueId, message })}
              />
            )}
            {greetings.byQueue[item.queueId]?.status === 'QUEUED' && (
              <Button
                className={styles.greetingAction}
                disabled={greetings.busy || !!pageNotice}
                aria-busy={greetings.busy}
                aria-describedby={[`request-title-${item.queueId}`, pageNotice ? noticeId : undefined].filter(Boolean).join(' ')}
                onClick={() => void greetings.execute('remove', { greetingId: greetings.byQueue[item.queueId].greetingId })}
              >
                {greetings.busy && connected ? 'Procesando…' : 'Quitar saludo'}
              </Button>
            )}
            {isPendingRequest(item) && (
              <Button className={styles.cancel} aria-label='Cancelar pedido' aria-describedby={`request-title-${item.queueId}`} disabled={!connected || cancelling !== null} onClick={() => { void cancel(item) }}>
                {cancelling === item.queueId ? 'Cancelando…' : 'Cancelar pedido'}
              </Button>
            )}
          </div>
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
      {pageNotice && <p id={noticeId} role='status' className={styles.notice}>{pageNotice}</p>}
      {visibleTable && <p className={styles.notice}>{visibleTable}</p>}
      {activePlayer && nextParticipant?.userId === user.userId && <p role='status' className={styles.notice}>{next?.origin === 'HOUSE' ? 'Tu turno sigue después de la música de la casa' : 'Tu turno sigue'}</p>}
      {page === 'search' && replacement && (
        <p className={styles.notice}>
          {`Elige el reemplazo de «${replacement.title}». Conservaremos la antigüedad de tu pedido. `}
          <Link to='/library'>Cancelar reemplazo</Link>
        </p>
      )}

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
              <input ref={searchInput} id='youtube-query' type='search' aria-label='Buscar canción o artista' aria-describedby={searchDescription} value={query} onChange={event => setQuery(event.target.value)} placeholder='Canción, artista o enlace' maxLength={200} enterKeyHint='search' />
              {query && (
                <Button
                  className={styles.clearSearch}
                  icon='CLEAR'
                  size={20}
                  aria-label='Limpiar búsqueda'
                  title='Limpiar búsqueda'
                  onClick={() => {
                    setQuery('')
                    setSubmitted(null)
                    searchInput.current?.focus()
                  }}
                />
              )}
              <Button type='submit' disabled={!connected || query.trim().length < 2} aria-describedby={searchDescription}>Buscar</Button>
            </div>
            {shortQuery && <p id={`${noticeId}-minimum`} className={styles.searchHelp} role='status'>Mínimo 2 caracteres.</p>}
          </form>
          <div aria-live='polite'>
            {matchesSubmission && search.isLoading && <p>Buscando…</p>}
            {matchesSubmission && search.error && (
              <div className={styles.notice}>
                <p>{youtubeSearchError(search.code)}</p>
                {youtubeSearchCanRetry(search.code) && <Button disabled={!connected} onClick={() => { void search.submit(search.query) }}>Reintentar</Button>}
              </div>
            )}
            {matchesSubmission && search.query && !search.isLoading && !search.error && search.results.length === 0 && (
              <p className={styles.empty}>{search.blockedCount ? youtubeVideoId(search.query) ? musicBlockedMessage : musicAllBlockedMessage : 'Sin resultados.'}</p>
            )}
            {matchesSubmission && !search.isLoading && !search.error && search.blockedCount > 0 && search.results.length > 0 && <p className={styles.notice}>{musicFilteredMessage}</p>}
          </div>
          {matchesSubmission && search.results.map((result) => {
            const receipt = receipts[result.sourceId]
            const active = own.find(item => item.externalId === result.sourceId && (isPendingRequest(item) || item.status === 'PLAYING'))
            return (
              <SongResultCard
                key={result.sourceId}
                result={result}
                previewScope={`${user.roomId}:${user.userId}`}
                requestIntent={submitted.intent}
                receipt={receipt}
                active={active}
                connected={connected}
                blocker={pageNotice || null}
                blockerDescriptionId={pageNotice ? noticeId : undefined}
                onRequest={(intent) => { void requestSong(result.sourceId, result.title, intent) }}
              />
            )
          })}
        </>
      )}

      {page === 'requests' && (
        <>
          <p className={styles.searchHelp}>Una canción por persona en cada turno. La espera es aproximada e incluye la música programada.</p>
          {cancelMessage && <p role='status'>{cancelMessage}</p>}
          {connected && greetings.error && <p role='alert' className={styles.notice}>{greetings.error}</p>}
          {unsettled.map(receipt => (
            <article key={receipt.requestId} className={styles.card}>
              <h2 translate='no'>{receipt.title}</h2>
              {receipt.phase !== 'sending' && <p role='status'>{receipt.phase === 'error' ? receipt.message : 'Sin confirmar'}</p>}
              {receipt.code === 'MUSIC_BLOCKED'
                ? <Link to='/library'>Buscar otra canción</Link>
                : <Button disabled={!connected || receipt.phase === 'sending' || (receipt.phase === 'error' && !canRequest)} onClick={() => { void requestSong(receipt.sourceId, receipt.title) }}>{receipt.phase === 'sending' ? 'Enviando…' : receipt.phase === 'error' ? 'Reintentar' : 'Comprobar pedido'}</Button>}
            </article>
          ))}
          {own.length === 0 && unsettled.length === 0 && !queue.isLoading && (
            <div className={styles.empty}>
              <h2>Sin pedidos</h2>
              <Link to='/library'>Buscar una canción</Link>
            </div>
          )}
          {own.sort((a, b) => requestPriority(b) - requestPriority(a)
            || (a.status === 'APPROVED' && b.status === 'APPROVED' ? ordered.result.indexOf(a.queueId) - ordered.result.indexOf(b.queueId) : 0)
            || b.queueId - a.queueId).map(item => renderItem(item, true))}
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
