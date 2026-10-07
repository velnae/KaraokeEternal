import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router'
import { ensureState } from 'redux-optimistic-ui'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import store from 'store/store'
import { fetchCurrentRoom } from 'store/modules/rooms'
import getRoundRobinQueue from 'routes/Queue/selectors/getRoundRobinQueue'
import { queuePush } from 'routes/Queue/modules/queue'
import { QUEUE_ADD, QUEUE_REMOVE } from 'shared/actionTypes'
import type { QueueItem } from 'shared/types'
import { normalizeQueuePrefs } from 'shared/queueRules'
import socket from 'lib/socket'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import { createRequestController } from './requests'
import { estimatedWait, isPendingRequest, requestPriority, requestStatusLabels } from './model'
import { useConnection } from './useConnection'
import { useYouTubeSearch } from './useYouTubeSearch'
import SongArtwork from 'components/SongArtwork/SongArtwork'
import theme from 'styles/karaokeTheme.css'
import styles from './ParticipantView.css'

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
  const [karaoke, setKaraoke] = useState(true)
  const [retry, setRetry] = useState(0)
  const search = useYouTubeSearch(query, karaoke, retry, page === 'search')
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [cancelMessage, setCancelMessage] = useState('')
  const controller = useMemo(() => createRequestController({
    storage: {
      getItem: key => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
    },
    key: `karaoke-requests:${user.roomId}:${user.userId}`,
    makeId: () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''),
    send: async (sourceId, requestId) => {
      if (!socket.connected) throw new Error('offline')
      const response = await socket.timeout(12000).emitWithAck('action', {
        type: QUEUE_ADD, payload: { source: 'YOUTUBE', sourceId, origin: 'PARTICIPANT', requestId },
      })
      const account = store.getState().user
      if (account.userId === user.userId && account.roomId === user.roomId && response.payload?.queue) {
        dispatch(queuePush(response.payload.queue))
      }
      return response
    },
  }), [user.roomId, user.userId, dispatch])
  const receipts = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const unsettled = Object.values(receipts).filter(receipt => receipt.phase !== 'confirmed')

  useEffect(() => {
    if (connected) void dispatch(fetchCurrentRoom())
  }, [connected, dispatch])

  const items = Object.values(queue.entities).filter((item): item is QueueItem => item.isOptimistic !== true)
  const own = items.filter(item => item.userId === user.userId && item.origin === 'PARTICIPANT')
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
      <article key={item.queueId} className={styles.card} data-status={item.status}>
        <div className={styles.details}>
          <div className={styles.cardStatus}>
            <span className={styles.badge}>{requestStatusLabels[item.status]}</span>
            {wait !== null && <span className={styles.wait} aria-label={`Espera estimada: ${wait < 1 ? 'menos de 1 minuto' : `${wait} minutos`}`}>{wait < 1 ? '< 1 min' : `≈ ${wait} min`}</span>}
          </div>
          <div className={styles.queuedSong}>
            <SongArtwork thumbnailUrl={item.thumbnailUrl} />
            <div>
              <h2 id={`request-title-${item.queueId}`} translate='no'>{item.title}</h2>
              <p translate='no'>{personal ? item.artistOrChannel : item.userDisplayName}</p>
            </div>
          </div>
          {personal && item.status === 'FAILED' && <Link className={styles.textAction} to='/library'>Buscar otra versión</Link>}
        </div>
        {personal && isPendingRequest(item) && (
          <Button className={styles.cancel} aria-label='Cancelar pedido' aria-describedby={`request-title-${item.queueId}`} disabled={!connected || cancelling !== null} onClick={() => { void cancel(item) }}>
            {cancelling === item.queueId ? 'Cancelando…' : 'Cancelar'}
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
      {room?.status === 'closed' && <p role='status' className={styles.notice}>Sala cerrada</p>}
      {activePlayer && next?.userId === user.userId && <p role='status' className={styles.notice}>Tu turno sigue</p>}

      <div className={styles.pageHeading}>
        <h1>{page === 'search' ? '¿Qué quieres cantar?' : page === 'requests' ? 'Mis pedidos' : 'En la sala'}</h1>
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
              setRetry(value => value + 1)
            }}
          >
            <div className={styles.searchRow}>
              <input id='youtube-query' type='search' aria-label='Buscar canción o artista' value={query} onChange={event => setQuery(event.target.value)} placeholder='Canción o artista' maxLength={200} enterKeyHint='search' />
              <Button type='submit' icon='MAGNIFIER' size={24} aria-label='Buscar' disabled={!connected || query.trim().length < 2} />
            </div>
            <div className={styles.searchOptions}>
              <label className={styles.filter}>
                <input type='checkbox' aria-label='Buscar versiones karaoke' checked={karaoke} onChange={event => setKaraoke(event.target.checked)} />
                Karaoke
              </label>
              <span className={styles.provider}>YouTube</span>
            </div>
          </form>
          <div aria-live='polite'>
            {search.isLoading && <p>Buscando…</p>}
            {search.error && (
              <div className={styles.notice}>
                <p>{search.code === 'YOUTUBE_UNCONFIGURED' || search.code === 'YOUTUBE_QUOTA' ? 'Búsqueda no disponible. Consulta al organizador.' : 'No se pudo buscar en YouTube.'}</p>
                {search.code !== 'YOUTUBE_UNCONFIGURED' && search.code !== 'YOUTUBE_QUOTA' && <Button disabled={!connected} onClick={() => setRetry(value => value + 1)}>Reintentar</Button>}
              </div>
            )}
            {search.query && !search.isLoading && !search.error && search.results.length === 0 && (
              <div className={styles.empty}>
                <p>Sin resultados</p>
                {karaoke && <Button onClick={() => setKaraoke(false)}>Quitar filtro karaoke</Button>}
              </div>
            )}
          </div>
          {search.results.map((result) => {
            const receipt = receipts[result.sourceId]
            const active = own.find(item => item.externalId === result.sourceId && (isPendingRequest(item) || item.status === 'PLAYING'))
            const uncertain = receipt?.phase === 'uncertain'
            const sending = receipt?.phase === 'sending'
            return (
              <article className={styles.result} key={result.sourceId}>
                <div className={styles.artwork}>
                  <SongArtwork thumbnailUrl={result.thumbnailUrl} durationSeconds={result.durationSeconds} />
                </div>
                <div className={styles.details}>
                  <h2 id={`youtube-title-${result.sourceId}`} translate='no'>{result.title}</h2>
                  <p translate='no'>{result.artistOrChannel}</p>
                </div>
                <div className={styles.resultActions}>
                  <div role='status'>
                    {active && !sending && !uncertain
                      ? (
                          <Link className={styles.requestState} data-status={active.status} to='/requests' aria-describedby={`youtube-title-${result.sourceId}`}>
                            {requestStatusLabels[active.status]}
                            <Icon icon='CHEVRON_RIGHT' size={20} />
                          </Link>
                        )
                      : (
                          <Button aria-describedby={`youtube-title-${result.sourceId}`} variant='primary' disabled={!connected || sending || (!uncertain && !canRequest)} onClick={() => { void controller.request(result.sourceId, result.title) }}>
                            {sending ? 'Enviando…' : uncertain ? 'Comprobar pedido' : ready && remaining === 0 ? 'Límite alcanzado' : 'Pedir canción'}
                          </Button>
                        )}
                  </div>
                </div>
                <div className={styles.resultMessage} role='status'>
                  {uncertain && <p className={styles.error}>Sin confirmar</p>}
                  {receipt?.phase === 'error' && <p className={styles.error}>{receipt.message}</p>}
                </div>
              </article>
            )
          })}
        </>
      )}

      {page === 'requests' && (
        <>
          {cancelMessage && <p role='status'>{cancelMessage}</p>}
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
