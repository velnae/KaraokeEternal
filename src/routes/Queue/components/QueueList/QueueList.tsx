import React, { useRef, useState } from 'react'
import { canOperate } from 'shared/permissions'
import clsx from 'clsx'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { ensureState } from 'redux-optimistic-ui'
import QueueItem from '../QueueItem/QueueItem'
import QueueListAnimator from '../QueueListAnimator/QueueListAnimator'
import { formatSeconds } from 'lib/dateTime'
import { moveItem, removeUpcomingItems } from '../../modules/queue'
import getPlayerHistory from '../../selectors/getPlayerHistory'
import getRoundRobinQueue from '../../selectors/getRoundRobinQueue'
import getWaits from '../../selectors/getWaits'
import Button from 'components/Button/Button'
import styles from './QueueList.css'
import { Link, useSearchParams } from 'react-router'
import HousePlaylistControl from 'components/Playlists/HousePlaylistControl'
import QueueMaintenance from '../QueueMaintenance/QueueMaintenance'
import { isQueueHistoryHidden } from 'shared/queueCleanup'
import useGreetings from 'components/Greetings/useGreetings'
import Modal from 'components/Modal/Modal'
import MusicBlockForm from 'components/MusicBlocking/MusicBlockForm'
import { musicRuleLabel, type MusicBlockRule } from 'shared/musicBlocking'
import { operatorQueue } from '../../selectors/operatorQueue'
import BirthdayPanel from 'components/Birthdays/BirthdayPanel'
import BirthdayQueueItem from 'components/Birthdays/BirthdayQueueItem'
import useBirthdaySync from 'components/Birthdays/useBirthdaySync'
import { selectBirthdays } from 'store/modules/birthdays'
import { playbackSequence } from 'shared/playbackSequence'

type QueueFilter = 'queue' | 'pending' | 'house'

const QueueList = () => {
  useBirthdaySync()
  const birthdays = useAppSelector(selectBirthdays)
  const [block, setBlock] = useState<{ rule: MusicBlockRule, title: string, opener: HTMLButtonElement } | null>(null)
  const [blockMessage, setBlockMessage] = useState('')
  const blockBusy = useRef(false)
  const feedback = useRef<HTMLParagraphElement>(null)
  const closeBlock = () => {
    if (blockBusy.current) return
    const opener = block?.opener
    setBlock(null)
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus({ preventScroll: true })
      else feedback.current?.focus({ preventScroll: true })
    })
  }
  const artists = useAppSelector(state => state.artists)
  const { errorMessage, isAtQueueEnd, isErrored, isPlaying, position, queueId } = useAppSelector(state => state.status)

  const playerHistory = useAppSelector(getPlayerHistory)
  const queue = useAppSelector(getRoundRobinQueue)
  const rawQueue = useAppSelector(state => ensureState(state.queue))
  const songs = useAppSelector(state => state.songs)
  const starredSongs = useAppSelector(state => ensureState(state.userStars).starredSongs)
  const starCounts = useAppSelector(state => state.starCounts)
  const user = useAppSelector(state => state.user)
  const isOperator = canOperate(user)
  const greetings = useGreetings(!!user.roomId)
  const waits = useAppSelector(getWaits)
  const [params, setParams] = useSearchParams()
  const view = params.get('view')
  const filter: QueueFilter = view === 'pending' || view === 'house' ? view : 'queue'
  const setFilter = (value: QueueFilter) => setParams((previous) => {
    const next = new URLSearchParams(previous)
    next.set('view', value)
    return next
  })
  const [tableFilter, setTableFilter] = useState('all')
  const tableOptions = new Map<number, string>()
  for (const item of Object.values(rawQueue.entities)) {
    if (item.isOptimistic !== true && !isQueueHistoryHidden(item) && item.tableId) tableOptions.set(item.tableId, item.tableLabelSnapshot || `Mesa ${item.tableId}`)
  }
  const activeTableFilter = tableOptions.size > 0 && (tableFilter === 'none' || tableOptions.has(Number(tableFilter))) ? tableFilter : 'all'

  const pendingIds = rawQueue.result.filter((queueId) => {
    const item = rawQueue.entities[queueId]
    return item.isOptimistic !== true && item.status === 'PENDING_APPROVAL'
  })
  const ownerFeedbackIds = rawQueue.result.filter((queueId) => {
    const item = rawQueue.entities[queueId]
    return item.isOptimistic !== true
      && item.userId === user.userId
      && (item.status === 'PENDING_APPROVAL' || item.status === 'REJECTED')
  })
  const houseIds = rawQueue.result.filter((queueId) => {
    const item = rawQueue.entities[queueId]
    return item.isOptimistic !== true && item.origin === 'HOUSE' && item.status === 'APPROVED'
  })
  const displayOrder = operatorQueue(queue.result, rawQueue.entities, playerHistory, queueId, isAtQueueEnd)
  const selectedResult = isOperator && filter === 'pending'
    ? pendingIds
    : isOperator && filter === 'house'
      ? houseIds
      : isOperator ? displayOrder : [...ownerFeedbackIds, ...queue.result.filter(queueId => !ownerFeedbackIds.includes(queueId))]
  const result = selectedResult.filter((id) => {
    const item = rawQueue.entities[id]
    return item.isOptimistic === true || !isQueueHistoryHidden(item) || (id === queueId && !isAtQueueEnd)
  })
  const pendingLabel = `Por aprobar (${pendingIds.length})`
  const houseLabel = `De la casa (${houseIds.length})`
  const replacedIds = new Set(Object.values(rawQueue.entities).filter(item => item.isOptimistic !== true).map(item => item.replacesQueueId))

  // actions
  const dispatch = useAppDispatch()
  const handleMoveClick = (qId: number) => {
    // reference user's last-played item as the new prevQueueId
    const userId = queue.entities[qId].userId
    let lastPlayed = queueId // default in case user has no played items

    for (let i = queue.result.indexOf(queueId); i >= 0; i--) {
      if (queue.entities[queue.result[i]].userId === userId) {
        lastPlayed = queue.result[i]
        break
      }
    }

    dispatch(moveItem({ queueId: qId, prevQueueId: lastPlayed }))
  }

  const handleRemoveUpcoming = (userId: number) => {
    dispatch(removeUpcomingItems(userId))
  }

  // build children array
  const visibleResult = result.filter((id) => {
    const item = rawQueue.entities[id]
    return item.isOptimistic !== true
      && (!isOperator || activeTableFilter === 'all' || String(item.tableId ?? 'none') === activeTableFilter)
  })
  const historyStart = isOperator && filter === 'queue'
    ? visibleResult.find(id => (isAtQueueEnd || id !== queueId) && playerHistory.includes(id))
    : undefined
  const items = visibleResult.map((qId) => {
    const item = rawQueue.entities[qId]
    if (item.isOptimistic === true) return null

    const localSong = typeof item.songId === 'number' ? songs.entities[item.songId] : undefined
    const duration = item.durationSeconds ?? localSong?.duration ?? 0
    const isCurrent = (qId === queueId) && !isAtQueueEnd
    const isUpcoming = item.status === 'APPROVED'
      && queue.result.includes(qId)
      && qId !== queueId
      && !playerHistory.includes(qId)
    const isOwner = item.userId === user.userId
    const isTerminal = item.status === 'PLAYED' || item.status === 'FAILED'
    const canRemoveByStatus = item.status === 'PENDING_APPROVAL'
      || isUpcoming
      || (isOperator && filter === 'house' && item.status === 'APPROVED')
    const isRemovable = canRemoveByStatus && (isOwner || isOperator)

    return (
      <QueueItem
        {...item}
        durationSeconds={duration > 0 ? duration : null}
        artist={item.artistOrChannel || (localSong ? artists.entities[localSong.artistId]?.name : '')}
        errorMessage={isCurrent && errorMessage ? errorMessage : ''}
        isCurrent={isCurrent}
        key={qId}
        isAdmin={isOperator}
        canRecover={isOperator && item.origin === 'PARTICIPANT' && item.status === 'FAILED' && !replacedIds.has(qId)}
        isErrored={isCurrent && isErrored}
        isInfoable={user.isAdmin && item.source === 'LOCAL' && typeof item.songId === 'number'}
        isMovable={isUpcoming && isOperator}
        isOwner={isOwner}
        isPlayed={isTerminal && !isCurrent}
        isPlaying={isCurrent && isPlaying}
        isRemovable={isRemovable}
        isReplayable={(item.status === 'PLAYED' || isCurrent) && isOperator}
        isSkippable={isCurrent && isOperator}
        isStarred={typeof item.songId === 'number' && starredSongs.includes(item.songId)}
        isUpcoming={isUpcoming}
        pctPlayed={isCurrent && duration > 0 ? position / duration * 100 : 0}
        starCount={typeof item.songId === 'number' ? starCounts.songs[item.songId] || 0 : 0}
        title={item.title || localSong?.title || ''}
        status={item.status}
        greeting={greetings.byQueue[qId]}
        greetingsPaused={greetings.snapshot?.paused}
        greetingBusy={greetings.busy}
        onRemoveGreeting={greetings.byQueue[qId] && (isOperator || (isOwner && greetings.byQueue[qId].status === 'QUEUED'))
          ? () => void greetings.execute('remove', { greetingId: greetings.byQueue[qId].greetingId })
          : undefined}
        wait={typeof waits[qId] === 'number' ? formatSeconds(waits[qId], true) : undefined} // fuzzy
        // actions
        onMoveClick={handleMoveClick}
        onRemoveUpcoming={handleRemoveUpcoming}
        onBlock={user.isAdmin
          ? (rule, title, opener) => {
              setBlockMessage('')
              setBlock({ rule, title, opener })
            }
          : undefined}
      />
    )
  })

  return (
    <>
      {user.isAdmin && <BirthdayPanel key={user.roomId} />}
      {isOperator && (
        <div className={styles.filters}>
          {tableOptions.size > 0 && (
            <select aria-label='Filtrar por mesa' value={activeTableFilter} onChange={e => setTableFilter(e.target.value)}>
              <option value='all'>Todas las mesas</option>
              <option value='none'>Sin mesa</option>
              {[...tableOptions].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          <Button
            className={clsx(styles.filter, filter === 'queue' && styles.active)}
            aria-pressed={filter === 'queue'}
            onClick={() => setFilter('queue')}
          >
            Cola
          </Button>
          <Button
            className={clsx(styles.filter, filter === 'pending' && styles.active)}
            aria-pressed={filter === 'pending'}
            onClick={() => setFilter('pending')}
          >
            {pendingLabel}
          </Button>
          <Button
            className={clsx(styles.filter, filter === 'house' && styles.active)}
            aria-pressed={filter === 'house'}
            onClick={() => setFilter('house')}
          >
            {houseLabel}
          </Button>
        </div>
      )}
      {isOperator && (
        <div className={styles.queueActions}>
          <QueueMaintenance key={`${user.roomId}:${user.userId}`} />
          {(greetings.snapshot?.paused || greetings.snapshot?.items.some(item => ['QUEUED', 'RESERVED', 'DISPLAYING'].includes(item.status))) && (
            <Button className={styles.greetingControl} disabled={greetings.busy} aria-pressed={greetings.snapshot.paused} onClick={() => void greetings.execute('pause', { paused: !greetings.snapshot?.paused })}>
              {greetings.snapshot.paused ? 'Reanudar saludos' : 'Pausar saludos'}
            </Button>
          )}
        </div>
      )}
      {greetings.error && <p role='alert'>{greetings.error}</p>}
      {user.isAdmin && <p ref={feedback} tabIndex={-1} role='status' className={styles.blockFeedback}>{blockMessage}</p>}
      {isOperator && houseIds.length > 0 && queue.housePolicy.reason && (
        <p className={styles.houseNotice} role='status'>
          {`De la casa en espera: ${queue.housePolicy.reason === 'backlog' ? 'hay 3 o más pedidos pendientes.' : 'un pedido lleva 10 minutos o más esperando.'}`}
        </p>
      )}
      {isOperator && filter === 'house' && <HousePlaylistControl key={user.roomId} />}
      {isOperator && filter === 'queue' && result.length === 0 && !birthdays.length && (
        <div className={styles.empty}>
          <h1>La cola de reproducción está vacía</h1>
          <Link to='/library'>Buscar una canción</Link>
        </div>
      )}
      {isOperator && filter === 'pending' && pendingIds.length === 0 && (
        <div className={styles.empty}>No hay solicitudes pendientes de aprobación.</div>
      )}
      {isOperator && filter === 'house' && houseIds.length === 0 && (
        <div className={styles.empty}>No hay canciones de la casa aprobadas.</div>
      )}
      {isOperator
        ? playbackSequence(visibleResult, filter === 'queue' ? birthdays : [], isAtQueueEnd ? -1 : queueId).flatMap((entry) => {
            if (entry.kind === 'birthday') return [<BirthdayQueueItem key={entry.event.id} event={entry.event} />]
            const item = items[visibleResult.indexOf(entry.queueId)]
            return entry.queueId === historyStart ? [<h2 key='queue-history' className={styles.historySeparator}>Historial</h2>, item] : [item]
          })
        : (
            <QueueListAnimator queueItems={playbackSequence(visibleResult, birthdays, isAtQueueEnd ? -1 : queueId).flatMap(entry => entry.kind === 'birthday'
              ? [<BirthdayQueueItem key={entry.event.id} event={entry.event} />]
              : [items[visibleResult.indexOf(entry.queueId)]]).filter(item => item !== null)}
            />
          )}
      {user.isAdmin && block && (
        <Modal
          title={block.rule.kind === 'artist' ? 'Bloquear artista' : block.rule.kind === 'song' ? 'Bloquear canción' : block.rule.source === 'YOUTUBE' ? 'Bloquear este video' : 'Bloquear este archivo'}
          className={styles.blockDialog}
          onClose={closeBlock}
        >
          <MusicBlockForm
            compact
            initial={block.rule}
            resourceTitle={block.title}
            onCancel={closeBlock}
            onBusyChange={(busy) => { blockBusy.current = busy }}
            onSaved={(rule) => {
              setBlockMessage(`Bloqueo guardado: ${musicRuleLabel(rule)}. Aplicado a todas las salas.`)
              setBlock(null)
              requestAnimationFrame(() => feedback.current?.focus({ preventScroll: true }))
            }}
          />
        </Modal>
      )}
    </>
  )
}

export default QueueList
