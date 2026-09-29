import React, { useRef, useState } from 'react'
import clsx from 'clsx'
import { useSwipeable } from 'react-swipeable'
import { useLongPress } from 'use-long-press'
import { useAppDispatch } from 'store/hooks'
import Button from 'components/Button/Button'
import ButtonStar from 'components/ButtonStar/ButtonStar'
import Buttons from 'components/Buttons/Buttons'
import UserImage from 'components/UserImage/UserImage'
import { requestPlayNext, requestReplay } from 'store/modules/status'
import { showSongInfo } from 'store/modules/songInfo'
import { toggleSongStarred } from 'store/modules/userStars'
import { showErrorMessage } from 'store/modules/ui'
import { approveRequest, queueSong, queueYouTubeSong, rejectRequest, removeItem } from '../../modules/queue'
import type { QueueItemOrigin, QueueItemStatus, SongSource } from 'shared/queueLifecycle'
import styles from './QueueItem.css'

const LONG_PRESS_THRESHOLD_MS = 700

interface QueueItemProps {
  artist: string
  errorMessage: string
  isAdmin: boolean
  isCurrent: boolean
  isErrored: boolean
  isInfoable: boolean
  isMovable: boolean
  isOwner: boolean
  isPlayed: boolean
  isPlaying: boolean
  isRemovable: boolean
  isReplayable: boolean
  isSkippable: boolean
  isStarred: boolean
  isUpcoming: boolean
  pctPlayed: number
  origin: QueueItemOrigin
  queueId: number
  songId: number | null
  source: SongSource
  externalId: string | null
  starCount: number
  status: QueueItemStatus
  title: string
  userDateUpdated: number
  userDisplayName: string
  userId: number
  wait?: string
  // actions
  onMoveClick(queueId: number): void
  onRemoveUpcoming: (userId: number) => void
}

const QueueItem = ({
  artist,
  errorMessage,
  isAdmin,
  isCurrent,
  isErrored,
  isInfoable,
  isMovable,
  isOwner,
  isPlayed,
  isPlaying,
  isRemovable,
  isReplayable,
  isSkippable,
  isStarred,
  isUpcoming,
  onMoveClick,
  onRemoveUpcoming,
  origin,
  pctPlayed,
  queueId,
  songId,
  source,
  externalId,
  starCount,
  status,
  title,
  userDateUpdated,
  userDisplayName,
  userId,
  wait,
}: QueueItemProps) => {
  const [isExpanded, setExpanded] = useState(false)
  const longPressActiveRef = useRef(false)
  const dispatch = useAppDispatch()

  const handleErrorInfoClick = () => dispatch(showErrorMessage(errorMessage))
  const isLocal = source === 'LOCAL' && typeof songId === 'number'
  const canModerate = isAdmin && status === 'PENDING_APPROVAL'
  const handleInfoClick = () => {
    if (typeof songId === 'number') dispatch(showSongInfo(songId))
  }
  const handleMoveClick = () => {
    onMoveClick(queueId)
    setExpanded(false)
  }
  const handleReplayClick = () => {
    dispatch(requestReplay(queueId))
    setExpanded(false)
  }
  const handleRequeueClick = () => {
    if (isLocal) dispatch(queueSong(songId, origin))
    else if (source === 'YOUTUBE' && externalId) dispatch(queueYouTubeSong(externalId, origin))
    setExpanded(false)
  }
  const handleSkipClick = () => {
    dispatch(requestPlayNext())
    setExpanded(false)
  }
  const handleRemoveClick = () => dispatch(removeItem({ queueId }))
  const handleStarClick = () => {
    if (typeof songId === 'number') dispatch(toggleSongStarred(songId))
  }
  const handleApproveClick = () => dispatch(approveRequest({ queueId }))
  const handleRejectClick = () => dispatch(rejectRequest({ queueId }))

  const statusLabel: Record<QueueItemStatus, string> = {
    PENDING_APPROVAL: 'Pendiente de aprobación',
    APPROVED: 'Aprobada',
    PLAYING: 'En reproducción',
    PLAYED: 'Reproducida',
    REJECTED: 'Solicitud rechazada',
    REMOVED: 'Quitada',
    FAILED: 'No se pudo reproducir',
  }

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      setExpanded(isErrored || isInfoable || isRemovable || isSkippable || canModerate)
    },
    onSwipedRight: () => setExpanded(false),
    preventScrollOnSwipe: true,
    trackMouse: true,
  })

  const bindRemovePressHandlers = useLongPress(() => {
    const confirmText = isOwner ? '¿Quitar todas sus próximas canciones?' : `¿Quitar todas las próximas canciones de "${userDisplayName}"?`
    longPressActiveRef.current = true

    if (confirm(confirmText)) {
      onRemoveUpcoming(userId)
    }
  }, { threshold: LONG_PRESS_THRESHOLD_MS, cancelOnMovement: true })

  const bindSkipPressHandlers = useLongPress(() => {
    const confirmText = isOwner ? '¿Saltar esta canción y quitar todas sus próximas canciones?' : `¿Saltar esta canción y quitar todas las próximas canciones de "${userDisplayName}"?`
    longPressActiveRef.current = true

    if (confirm(confirmText)) {
      onRemoveUpcoming(userId)
      handleSkipClick()
    }
  }, { threshold: LONG_PRESS_THRESHOLD_MS, cancelOnMovement: true })

  return (
    <div
      {...swipeHandlers}
      className={clsx(
        styles.container,
        isCurrent && styles.current,
        isCurrent && !isPlaying && styles.paused,
      )}
      style={{ '--progress': (isCurrent && pctPlayed < 2 ? 2 : pctPlayed) + '%' } as React.CSSProperties}
    >
      <div className={styles.content}>
        <div className={clsx(styles.imageContainer, isPlayed && styles.greyed)}>
          <UserImage userId={userId} dateUpdated={userDateUpdated} />
          <div className={styles.waitContainer}>
            {isUpcoming && (
              <div className={clsx(styles.wait, isOwner && styles.isOwner)}>
                {wait}
              </div>
            )}
          </div>
        </div>

        <div className={clsx(styles.primary, isPlayed && styles.greyed)} translate='no'>
          <div className={styles.innerPrimary}>
            <div className={styles.title}>{title}</div>
            <div className={styles.artist}>{artist}</div>
          </div>
          <div className={clsx(styles.user, isOwner && styles.isOwner)}>
            {userDisplayName}
          </div>
          <div className={styles.badges}>
            <div className={clsx(styles.origin, styles[origin.toLowerCase()])}>
              {origin === 'PARTICIPANT' ? 'Participante' : origin === 'HOUSE' ? 'De la casa' : 'Operador'}
            </div>
            <div className={clsx(styles.source, source === 'YOUTUBE' && styles.youtube)}>
              {source === 'YOUTUBE' ? 'YouTube' : 'Local'}
            </div>
          </div>
          <div className={clsx(styles.status, (status === 'REJECTED' || status === 'FAILED') && styles.rejected)}>
            {statusLabel[status]}
          </div>
        </div>

        <Buttons btnWidth={56} isExpanded={isExpanded} className={styles.btnContainer}>
          {isErrored && (
            <Button
              className={styles.danger}
              icon='INFO_OUTLINE'
              aria-label='Ver error de reproducción'
              onClick={handleErrorInfoClick}
            />
          )}
          {isLocal && (
            <ButtonStar
              className={styles.btnStar}
              isStarred={isStarred}
              onClick={handleStarClick}
              count={starCount}
            />
          )}
          {isInfoable && (
            <Button
              className={styles.active}
              data-hide
              icon='INFO_OUTLINE'
              aria-label='Información de la canción'
              onClick={handleInfoClick}
            />
          )}
          {canModerate && (
            <Button
              aria-label='Aprobar solicitud'
              className={clsx(styles.btnApprove, styles.active)}
              icon='PLUS'
              onClick={handleApproveClick}
            />
          )}
          {canModerate && (
            <Button
              aria-label='Rechazar solicitud'
              className={clsx(styles.btnReject, styles.danger)}
              icon='CLEAR'
              onClick={handleRejectClick}
            />
          )}
          {isMovable && (
            <Button
              className={clsx(styles.btnMove, styles.active)}
              data-hide
              icon='MOVE_TOP'
              aria-label='Mover canción al inicio'
              onClick={handleMoveClick}
            />
          )}
          {isPlayed && (
            <Button
              className={clsx(styles.btnAdd, styles.active)}
              data-hide
              icon='PLUS'
              aria-label='Volver a agregar a la cola de reproducción'
              onClick={handleRequeueClick}
            />
          )}
          {isReplayable && (
            <Button
              className={clsx(styles.active, styles.danger)}
              data-hide
              icon='REPLAY'
              aria-label='Volver a reproducir canción'
              onClick={handleReplayClick}
            />
          )}
          {isRemovable && (
            <Button
              className={clsx(styles.btnRemove, styles.danger)}
              data-hide
              icon='DELETE'
              aria-label='Quitar canción de la cola de reproducción'
              onTouchEnd={(e: React.TouchEvent<HTMLButtonElement>) => {
                if (longPressActiveRef.current) {
                  e.preventDefault()
                  e.stopPropagation()
                  longPressActiveRef.current = false
                  return
                }
              }}
              onClick={() => {
                if (longPressActiveRef.current) {
                  longPressActiveRef.current = false
                  return
                }
                handleRemoveClick()
              }}
              {...bindRemovePressHandlers()}
            />
          )}
          {isSkippable && (
            <Button
              className={clsx(styles.btnPlayNext, styles.danger)}
              data-hide
              icon='PLAY_NEXT'
              aria-label='Reproducir siguiente canción'
              onTouchEnd={(e: React.TouchEvent<HTMLButtonElement>) => {
                if (longPressActiveRef.current) {
                  e.preventDefault()
                  e.stopPropagation()
                  longPressActiveRef.current = false
                  return
                }
              }}
              onClick={() => {
                if (longPressActiveRef.current) {
                  longPressActiveRef.current = false
                  return
                }
                handleSkipClick()
              }}
              {...bindSkipPressHandlers()}
            />
          )}
        </Buttons>
      </div>
    </div>
  )
}

export default QueueItem
