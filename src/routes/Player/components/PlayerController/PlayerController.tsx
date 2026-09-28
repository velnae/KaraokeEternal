import React, { useEffect, useCallback, useRef } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import Player from '../Player/Player'
import PlayerTextOverlay from '../PlayerTextOverlay/PlayerTextOverlay'
import PlayerQR from '../PlayerQR/PlayerQR'
import getRoundRobinQueue from 'routes/Queue/selectors/getRoundRobinQueue'
import { playerLeave, playerError, playerFailure, playerLoad, playerPlay, playerStatus, type PlayerState } from '../../modules/player'
import getRoomPrefs from '../../selectors/getRoomPrefs'
import type { QueueItem } from 'shared/types'
import styles from './PlayerController.css'
import {
  appendCompletedToHistory,
  playbackToken,
  settlePlayback,
  type PlaybackSettlementState,
} from './playbackSettlement'

interface PlayerControllerProps {
  width: number
  height: number
}

const PlayerController = (props: PlayerControllerProps) => {
  const queue = useAppSelector(getRoundRobinQueue)
  const player = useAppSelector(state => state.player)
  const playerVisualizer = useAppSelector(state => state.playerVisualizer)
  const prefs = useAppSelector(state => state.prefs)
  const roomPrefs = useAppSelector(getRoomPrefs)
  const queueItem = queue.entities[player.queueId]
  const currentIndex = queue.result.indexOf(player.queueId)
  const nextQueueItem = queue.result
    .slice(currentIndex === -1 ? 0 : currentIndex + 1)
    .map(queueId => queue.entities[queueId])
    .find(item => item.status === 'APPROVED')
  const settlement = useRef<PlaybackSettlementState>({ token: null, outcome: null })

  const dispatch = useAppDispatch()
  const handleStatus = useCallback((status?: Partial<PlayerState>) => {
    if (player._authority === 'DENIED') return
    dispatch(playerStatus(status))
  }, [dispatch, player._authority])
  const handleLoad = () => dispatch(playerLoad())
  const handlePlay = () => dispatch(playerPlay())

  const handleReplay = useCallback((queueId: number) => {
    const nextItem = queue.entities[queueId]
    if (!nextItem) return

    const history = JSON.parse(player.historyJSON)

    if (queueId !== player.queueId) {
      // reset history up to and including the replaying queueId
      const idx = history.lastIndexOf(queueId)
      if (idx !== -1) history.splice(idx)
    }

    handleStatus({
      historyJSON: JSON.stringify(history),
      isAtQueueEnd: false,
      isPlaying: true,
      isVideoKeyingEnabled: nextItem.isVideoKeyingEnabled,
      mediaType: nextItem.mediaType,
      position: 0,
      queueId: nextItem.queueId,
      nextUserId: null,
      _isReplayingQueueId: null,
    })
  }, [handleStatus, player.historyJSON, player.queueId, queue.entities])

  const handleLoadNext = useCallback((includeCurrentInHistory = true) => {
    const historyJSON = appendCompletedToHistory(
      player.historyJSON,
      includeCurrentInHistory ? queueItem?.queueId : undefined,
    )

    // queue exhausted?
    if (!nextQueueItem) {
      handleStatus({
        historyJSON,
        isAtQueueEnd: true,
        isErrored: false,
        mediaType: null,
        _isPlayingNext: false,
      })

      return
    }

    // play next
    handleStatus({
      errorMessage: '',
      historyJSON,
      isAtQueueEnd: false,
      isErrored: false,
      isPlaying: true,
      isVideoKeyingEnabled: nextQueueItem.isVideoKeyingEnabled,
      mediaType: nextQueueItem.mediaType,
      position: 0,
      queueId: nextQueueItem.queueId,
      nextUserId: null,
      _isPlayingNext: false,
    })
  }, [handleStatus, nextQueueItem, player.historyJSON, queueItem])

  const handleEnd = useCallback(() => {
    if (!queueItem) return
    const token = playbackToken(queueItem.queueId, player._lastReplayTime)
    settlePlayback(settlement.current, token, 'ENDED', { onAdvance: handleLoadNext })
  }, [handleLoadNext, player._lastReplayTime, queueItem])

  const handleError = useCallback((msg: string) => {
    if (!queueItem || queueItem.source !== 'YOUTUBE') {
      dispatch(playerError(msg))
      handleStatus()
      return
    }

    const token = playbackToken(queueItem.queueId, player._lastReplayTime)
    settlePlayback(settlement.current, token, 'FAILED', {
      onFailure: () => dispatch(playerFailure({ queueId: queueItem.queueId, error: msg })),
      onAdvance: handleLoadNext,
    })
  }, [dispatch, handleLoadNext, handleStatus, player._lastReplayTime, queueItem])

  // Lock the participant for the next participant turn. House/operator items
  // may play before it without allowing realtime changes to replace that turn.
  useEffect(() => {
    const currentIndex = queue.result.indexOf(queueItem?.queueId)
    const upcomingParticipantId = queue.result
      .slice(currentIndex + 1)
      .find(queueId => queue.entities[queueId].origin === 'PARTICIPANT')
    const upcomingUserId = upcomingParticipantId === undefined
      ? null
      : queue.entities[upcomingParticipantId].userId

    if (player.nextUserId !== upcomingUserId) {
      handleStatus({ nextUserId: upcomingUserId })
    }
  }, [handleStatus, player.nextUserId, queue, queueItem?.queueId])

  // always emit status when any of these change
  useEffect(() => handleStatus({ isVideoKeyingEnabled: queueItem?.isVideoKeyingEnabled }), [
    handleStatus,
    player.cdgAlpha,
    player.cdgSize,
    player.isPlaying,
    player.mp4Alpha,
    player.volume,
    playerVisualizer,
    player._authority,
    queueItem?.isVideoKeyingEnabled,
  ])

  // on unmount
  useEffect(() => () => dispatch(playerLeave()), [dispatch])

  // playing for first time or playing next?
  useEffect(() => {
    if ((player.isPlaying && player.queueId === -1) || player._isPlayingNext) {
      handleLoadNext()
    }
  }, [handleLoadNext, player.isPlaying, player.queueId, player._isPlayingNext])

  // replaying?
  useEffect(() => {
    if (player._isReplayingQueueId !== null) {
      handleReplay(player._isReplayingQueueId)
    }
  }, [handleReplay, player._isReplayingQueueId])

  // queue was exhausted, but is no longer?
  useEffect(() => {
    if (player.isAtQueueEnd && nextQueueItem && player.isPlaying) {
      handleLoadNext()
    }
  }, [handleLoadNext, player.isPlaying, player.isAtQueueEnd, nextQueueItem])

  // retrying after error?
  useEffect(() => {
    if (player.isErrored && player.isPlaying) {
      handleStatus({ isErrored: false })
    }
  }, [handleStatus, player.isErrored, player.isPlaying])

  if (player._authority !== 'GRANTED') {
    const denied = player._authority === 'DENIED'
    return (
      <div className={styles.authorityNotice} role='status'>
        <h1>{denied ? 'Player already active' : 'Connecting player…'}</h1>
        <p>
          {denied
            ? player._authorityMessage
            : 'Requesting the authoritative player slot for this room.'}
        </p>
        {denied && <p>This screen will take over automatically if the active player disconnects.</p>}
      </div>
    )
  }

  return (
    <>
      <Player
        cdgAlpha={player.cdgAlpha}
        cdgSize={player.cdgSize}
        isPlaying={player.isPlaying}
        isVisible={!!queueItem && !player.isErrored && !player.isAtQueueEnd}
        isReplayGainEnabled={prefs.isReplayGainEnabled}
        isVideoKeyingEnabled={!!queueItem?.isVideoKeyingEnabled}
        isWebGLSupported={player.isWebGLSupported}
        externalId={queueItem ? queueItem.externalId : null}
        mediaId={queueItem ? queueItem.mediaId : null}
        mediaKey={queueItem ? queueItem.queueId : null}
        mediaReplayKey={player._lastReplayTime}
        mediaType={queueItem ? queueItem.mediaType : null}
        mp4Alpha={player.mp4Alpha}
        onEnd={handleEnd}
        onError={handleError}
        onLoad={handleLoad}
        onPlay={handlePlay}
        onStatus={handleStatus}
        rgTrackGain={queueItem ? queueItem.rgTrackGain : null}
        rgTrackPeak={queueItem ? queueItem.rgTrackPeak : null}
        source={queueItem?.source}
        visualizer={playerVisualizer}
        volume={player.volume}
        width={props.width}
        height={props.height}
      />
      <PlayerTextOverlay
        queueItem={queueItem as QueueItem}
        nextQueueItem={nextQueueItem as QueueItem}
        isAtQueueEnd={player.isAtQueueEnd}
        isQueueEmpty={!queue.result.length}
        isErrored={player.isErrored}
        width={props.width}
        height={props.height}
      />
      {roomPrefs?.qr?.isEnabled && (
        <PlayerQR
          height={props.height}
          prefs={roomPrefs.qr}
          queueItem={queueItem}
        />
      )}
    </>
  )
}

export default PlayerController
