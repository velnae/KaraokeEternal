import React, { useEffect, useCallback, useRef } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import Player from '../Player/Player'
import PlayerTextOverlay from '../PlayerTextOverlay/PlayerTextOverlay'
import PlayerQR from '../PlayerQR/PlayerQR'
import getRoundRobinQueue from 'routes/Queue/selectors/getRoundRobinQueue'
import { playerLeave, playerError, playerFailure, playerLoad, playerPlay, playerStatus, playerUpdate, type PlayerState } from '../../modules/player'
import store from 'store/store'
import socket from 'lib/socket'
import useAnimationPlayer from '../Animation/useAnimationPlayer'
import useGreetingPlayer from '../Animation/useGreetingPlayer'
import greetingStyles from 'components/Greetings/Greetings.css'
import Button from 'components/Button/Button'
import animationStyles from 'components/Animation/Animation.css'
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
  const advancing = useRef(false)
  const mounted = useRef(true)
  const animation = useAnimationPlayer()
  const greetings = useGreetingPlayer()
  const greetingsRef = useRef(greetings)
  greetingsRef.current = greetings
  const animationRef = useRef(animation)
  animationRef.current = animation

  const dispatch = useAppDispatch()
  const handleStatus = useCallback((status?: Partial<PlayerState>) => {
    if (player._authority === 'DENIED') return
    dispatch(playerStatus(status))
  }, [dispatch, player._authority])
  const handleLoad = () => dispatch(playerLoad())
  const handlePlay = () => dispatch(playerPlay())

  const handleReplay = useCallback((queueId: number) => {
    if (!socket.connected || advancing.current || animationRef.current.busy || animationRef.current.blocked) return
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
      _isBetweenTracks: false,
      _isReplayPlayback: true,
    })
  }, [handleStatus, player.historyJSON, player.queueId, queue.entities])

  const handleLoadNext = useCallback(async (includeCurrentInHistory = true, announce = false, boundary: 'ended' | 'idle' | 'start' = 'ended') => {
    if (!socket.connected || advancing.current || animationRef.current.busy || animationRef.current.blocked
      || store.getState().player._authority !== 'GRANTED') return
    advancing.current = true
    const controlVersion = animationRef.current.controlVersion()
    const before = store.getState().player
    const sourceId = before.queueId
    const historyJSON = appendCompletedToHistory(before.historyJSON, includeCurrentInHistory && sourceId >= 0 ? sourceId : undefined)
    dispatch(playerUpdate({ historyJSON, _isBetweenTracks: true }))
    const selection = () => {
      const state = store.getState()
      const ordered = getRoundRobinQueue({ ...state, status: { ...state.status, queueId: state.player.queueId, historyJSON: state.player.historyJSON, nextUserId: state.player.nextUserId } })
      const index = ordered.result.indexOf(state.player.queueId)
      return ordered.result.slice(index + 1).map(id => ordered.entities[id]).find(item => item.status === 'APPROVED')
    }
    try {
      await animationRef.current.stopAmbience()
      const upcoming = selection()
      const greeted = upcoming && controlVersion === animationRef.current.controlVersion()
        ? await greetingsRef.current.attempt(upcoming.queueId)
        : false
      if (!greeted && announce && controlVersion === animationRef.current.controlVersion()) {
        await animationRef.current.attempt(boundary, boundary === 'ended' ? sourceId : null, selection()?.queueId ?? null)
      }
      if (!mounted.current) return
      const current = store.getState().player
      if (!socket.connected || current._authority !== 'GRANTED' || current._isReplayingQueueId !== null || animationRef.current.blocked) return
      // Read the current intent, never restore the pre-announcement pause state.
      if (!current.isPlaying && !current._isPlayingNext) return
      const next = selection()
      if (!next) {
        dispatch(playerStatus({ historyJSON: current.historyJSON, isAtQueueEnd: true, isErrored: false, mediaType: null, _isPlayingNext: false, _isBetweenTracks: false }))
        return
      }
      dispatch(playerStatus({
        errorMessage: '', historyJSON: current.historyJSON, isAtQueueEnd: false, isErrored: false,
        isPlaying: true, isVideoKeyingEnabled: next.isVideoKeyingEnabled, mediaType: next.mediaType,
        position: 0, queueId: next.queueId, nextUserId: null, _isPlayingNext: false, _isBetweenTracks: false, _isReplayPlayback: false,
      }))
    } finally { advancing.current = false }
  }, [dispatch])

  const handleEnd = useCallback(() => {
    if (!queueItem) return
    const token = playbackToken(queueItem.queueId, player._lastReplayTime)
    settlePlayback(settlement.current, token, 'ENDED', { onAdvance: (include) => {
      void handleLoadNext(include, true)
    } })
  }, [handleLoadNext, player._lastReplayTime, queueItem])

  const handleError = useCallback((msg: string, diagnostic?: { category: 'iframe' | 'api-load', code?: number }) => {
    if (!queueItem || (queueItem.source !== 'YOUTUBE' && queueItem.origin !== 'HOUSE')) {
      dispatch(playerError(msg))
      handleStatus()
      return
    }

    const token = playbackToken(queueItem.queueId, player._lastReplayTime)
    settlePlayback(settlement.current, token, 'FAILED', {
      onFailure: () => dispatch(playerFailure({ queueId: queueItem.queueId, error: msg, ...diagnostic })),
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
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      dispatch(playerLeave())
    }
  }, [dispatch])

  // playing for first time or playing next?
  useEffect(() => {
    if (!animation.busy && !animation.blocked && ((player.isPlaying && (player.queueId === -1 || player._isBetweenTracks)) || player._isPlayingNext)) {
      const first = player.queueId === -1 && !player._isPlayingNext
      void handleLoadNext(!player._isBetweenTracks, first, first ? 'start' : 'ended')
    }
  }, [handleLoadNext, player.isPlaying, player.queueId, player._isPlayingNext, player._isBetweenTracks, animation.busy, animation.blocked])

  // replaying?
  useEffect(() => {
    if (player._isReplayingQueueId !== null) {
      handleReplay(player._isReplayingQueueId)
    }
  }, [handleReplay, player._isReplayingQueueId, animation.busy, animation.blocked])

  // queue was exhausted, but is no longer?
  useEffect(() => {
    if (!animation.busy && !animation.blocked && player.isAtQueueEnd && nextQueueItem && player.isPlaying) {
      void handleLoadNext(false, true, 'start')
    }
  }, [handleLoadNext, player.isPlaying, player.isAtQueueEnd, nextQueueItem, animation.busy, animation.blocked])

  const pendingIdleVoice = animation.snapshot?.active?.status === 'PENDING'
    && animation.snapshot.active.durationMs <= (animation.snapshot.voiceBudgetRemainingMs ?? 120000)
  const automaticIdleVoice = !animation.snapshot?.active && animation.snapshot?.prefs.automation && animation.snapshot?.session?.sessionId
  useEffect(() => {
    if (!animation.busy && !animation.blocked && animation.unlocked && (pendingIdleVoice || automaticIdleVoice)
      && !player.isErrored && (player.isAtQueueEnd || player.queueId === -1)) {
      void handleLoadNext(false, true, 'idle')
    }
  }, [pendingIdleVoice, automaticIdleVoice, animation.snapshot?.active?.interventionId, animation.snapshot?.active?.status, animation.snapshot?.prefs.automation,
    animation.snapshot?.session?.sessionId, animation.snapshot?.session?.status, animation.snapshot?.pendingEventJSON,
    animation.snapshot?.microphoneOccupied, animation.snapshot?.prefs.enabled, animation.snapshot?.prefs.volume,
    animation.snapshot?.active?.durationMs, animation.snapshot?.voiceBudgetRemainingMs,
    animation.busy, animation.blocked, animation.unlocked, animation.idleTick, player.isErrored, player.isAtQueueEnd, player.queueId, handleLoadNext])

  const { startAmbience, ambientPlaying, ambientTick } = animation
  useEffect(() => {
    if (!advancing.current && !animation.busy && !animation.blocked && animation.unlocked && !ambientPlaying
      && !player.isErrored && (player.isAtQueueEnd || player.queueId === -1)) void startAmbience()
  }, [animation.snapshot, animation.busy, animation.blocked, animation.unlocked, ambientPlaying, ambientTick, startAmbience, player.isErrored, player.isAtQueueEnd, player.queueId])

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
        <h1>{denied ? 'Ya hay un reproductor activo' : 'Conectando el reproductor…'}</h1>
        {denied && <p>Esperando a que se libere la sala.</p>}
      </div>
    )
  }

  return (
    <>
      <Player
        cdgAlpha={player.cdgAlpha}
        cdgSize={player.cdgSize}
        isPlaying={player.isPlaying}
        isVisible={!!queueItem && !player.isErrored && !player.isAtQueueEnd && !player._isBetweenTracks && !animation.busy && !animation.blocked}
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
      {animation.text && <div className={animationStyles.overlay} role='status' data-testid='announcement-overlay'><p>{animation.text}</p></div>}
      {greetings.active && (
        <section key={greetings.active.greetingId} ref={greetings.confirmMounted} className={greetingStyles.screen} role='status' data-testid='greeting-overlay' data-greeting-id={greetings.active.greetingId}>
          {greetings.active.recipient && <h2 translate='no'>{`Para ${greetings.active.recipient}`}</h2>}
          <p translate='no'>{greetings.active.message}</p>
          <footer translate='no'>{`De ${greetings.active.sender}`}</footer>
        </section>
      )}
      {greetings.error && <p className={greetingStyles.playerNotice} role='status'>{greetings.error}</p>}
      {animation.blocked && !animation.busy && <div className={animationStyles.overlay} role='status'><p>Esperando el cierre de la intervención anterior…</p></div>}
      {animation.snapshot?.prefs.enabled && !animation.unlocked && (
        <div className={animationStyles.unlock}>
          <Button onClick={() => void animation.unlock()}>Habilitar audio del animador</Button>
          {animation.error && <p role='alert'>{animation.error}</p>}
        </div>
      )}
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
