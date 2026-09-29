import React, { useState } from 'react'
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

type QueueFilter = 'queue' | 'pending' | 'house'

const QueueList = () => {
  const artists = useAppSelector(state => state.artists)
  const { errorMessage, isAtQueueEnd, isErrored, isPlaying, position, queueId } = useAppSelector(state => state.status)

  const playerHistory = useAppSelector(getPlayerHistory)
  const queue = useAppSelector(getRoundRobinQueue)
  const rawQueue = useAppSelector(state => ensureState(state.queue))
  const songs = useAppSelector(state => state.songs)
  const starredSongs = useAppSelector(state => ensureState(state.userStars).starredSongs)
  const starCounts = useAppSelector(state => state.starCounts)
  const user = useAppSelector(state => state.user)
  const waits = useAppSelector(getWaits)
  const [filter, setFilter] = useState<QueueFilter>('queue')

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
  const result = user.isAdmin && filter === 'pending'
    ? pendingIds
    : user.isAdmin && filter === 'house'
      ? houseIds
      : [...ownerFeedbackIds, ...queue.result.filter(queueId => !ownerFeedbackIds.includes(queueId))]
  const pendingLabel = `${pendingIds.length === 1 ? 'Pendiente de aprobación' : 'Pendientes de aprobación'} (${pendingIds.length})`
  const houseLabel = `${houseIds.length === 1 ? 'Canción de la casa' : 'Canciones de la casa'} (${houseIds.length})`

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
  const items = result.map((qId) => {
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
      || (user.isAdmin && filter === 'house' && item.status === 'APPROVED')
    const isRemovable = canRemoveByStatus && (isOwner || user.isAdmin)

    return (
      <QueueItem
        {...item}
        artist={item.artistOrChannel || (localSong ? artists.entities[localSong.artistId]?.name : '')}
        errorMessage={isCurrent && errorMessage ? errorMessage : ''}
        isCurrent={isCurrent}
        key={qId}
        isAdmin={user.isAdmin}
        isErrored={isCurrent && isErrored}
        isInfoable={user.isAdmin && item.source === 'LOCAL' && typeof item.songId === 'number'}
        isMovable={isUpcoming && user.isAdmin}
        isOwner={isOwner}
        isPlayed={isTerminal && !isCurrent}
        isPlaying={isCurrent && isPlaying}
        isRemovable={isRemovable}
        isReplayable={(item.status === 'PLAYED' || isCurrent) && user.isAdmin}
        isSkippable={isCurrent && user.isAdmin}
        isStarred={typeof item.songId === 'number' && starredSongs.includes(item.songId)}
        isUpcoming={isUpcoming}
        pctPlayed={isCurrent && duration > 0 ? position / duration * 100 : 0}
        starCount={typeof item.songId === 'number' ? starCounts.songs[item.songId] || 0 : 0}
        title={item.title || localSong?.title || ''}
        status={item.status}
        wait={typeof waits[qId] === 'number' ? formatSeconds(waits[qId], true) : undefined} // fuzzy
        // actions
        onMoveClick={handleMoveClick}
        onRemoveUpcoming={handleRemoveUpcoming}
      />
    )
  })

  return (
    <>
      {user.isAdmin && (
        <div className={styles.filters}>
          <Button
            className={clsx(styles.filter, filter === 'queue' && styles.active)}
            onClick={() => setFilter('queue')}
          >
            Cola de reproducción
          </Button>
          <Button
            className={clsx(styles.filter, filter === 'pending' && styles.active)}
            onClick={() => setFilter('pending')}
          >
            {pendingLabel}
          </Button>
          <Button
            className={clsx(styles.filter, filter === 'house' && styles.active)}
            onClick={() => setFilter('house')}
          >
            {houseLabel}
          </Button>
        </div>
      )}
      {user.isAdmin && filter === 'pending' && pendingIds.length === 0 && (
        <div className={styles.empty}>No hay solicitudes pendientes de aprobación.</div>
      )}
      {user.isAdmin && filter === 'house' && houseIds.length === 0 && (
        <div className={styles.empty}>No hay canciones de la casa aprobadas.</div>
      )}
      <QueueListAnimator queueItems={items.filter(item => item !== null)} />
    </>
  )
}

export default QueueList
