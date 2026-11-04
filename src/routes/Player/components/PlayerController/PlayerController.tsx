import React, { useEffect, useCallback, useRef, useState } from 'react'
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
import PlayerTransitionScene from '../Animation/PlayerTransitionScene'
import useSelectedPlayerBackground from '../Animation/useSelectedPlayerBackground'
import greetingStyles from 'components/Greetings/Greetings.css'
import Button from 'components/Button/Button'
import animationStyles from 'components/Animation/Animation.css'
import getRoomPrefs from '../../selectors/getRoomPrefs'
import type { QueueItem } from 'shared/types'
import type { TransitionVideoBackground } from 'shared/transitionVideo'
import { TRANSITION_INTRO_MS } from 'shared/animation'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY } from 'shared/actionTypes'
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

type TransitionScene = { id: string, background: TransitionVideoBackground | null, phase: 'intro' | 'voice' | 'loading' }

const PlayerController = (props: PlayerControllerProps) => {
  const queue = useAppSelector(getRoundRobinQueue)
  const player = useAppSelector(state => state.player)
  const playerVisualizer = useAppSelector(state => state.playerVisualizer)
  const prefs = useAppSelector(state => state.prefs)
  const roomPrefs = useAppSelector(getRoomPrefs)
  const roomId = useAppSelector(state => state.user.roomId)
  const queueItem = queue.entities[player.queueId]
  const currentIndex = queue.result.indexOf(player.queueId)
  const nextQueueItem = queue.result
    .slice(currentIndex === -1 ? 0 : currentIndex + 1)
    .map(queueId => queue.entities[queueId])
    .find(item => item.status === 'APPROVED')
  const settlement = useRef<PlaybackSettlementState>({ token: null, outcome: null })
  const advancing = useRef(false)
  const [advanceRevision, retryAdvance] = useState(0)
  const mounted = useRef(true)
  const animation = useAnimationPlayer()
  const greetings = useGreetingPlayer(animation.channel, animation.refreshReadiness, animation.markStopped)
  const selectedBackground = useSelectedPlayerBackground(roomId, roomPrefs?.transitionVideo, player._authority === 'GRANTED')
  const backgroundRef = useRef(selectedBackground)
  backgroundRef.current = selectedBackground
  const [transition, setTransition] = useState<TransitionScene | null>(null)
  const transitionRef = useRef<TransitionScene | null>(null)
  const updateTransition = useCallback((value: TransitionScene | null) => {
    transitionRef.current = value
    if (mounted.current) setTransition(value)
  }, [])
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
  const finishTransition = useCallback(async (fadeMs = 80) => {
    const scene = transitionRef.current
    await animationRef.current.stopTransition(fadeMs)
    if (transitionRef.current === scene) updateTransition(null)
  }, [updateTransition])
  const handlePlay = () => {
    if (transitionRef.current?.phase === 'loading') {
      void finishTransition().then((): void => {
        if (mounted.current) dispatch(playerPlay())
        return undefined
      })
    } else dispatch(playerPlay())
  }

  useEffect(() => {
    const cancel = () => {
      updateTransition(null)
      void animationRef.current.stopTransition(30)
    }
    const command = (action: { type: string }) => {
      if ([PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY].includes(action.type)) cancel()
    }
    socket.on('action', command)
    socket.on('disconnect', cancel)
    return () => {
      socket.off('action', command)
      socket.off('disconnect', cancel)
      cancel()
    }
  }, [roomId, updateTransition])

  useEffect(() => {
    if (player._authority !== 'GRANTED') {
      updateTransition(null)
      void animationRef.current.stopTransition(30)
    }
  }, [player._authority, updateTransition])

  useEffect(() => {
    if (transition?.phase !== 'loading') return
    if (!player.isPlaying) {
      void finishTransition(30)
      return
    }
    // A failed/blocked media start must expose its existing controls, not leave
    // an opaque transition over the player's recovery UI indefinitely.
    const timer = setTimeout(() => void finishTransition(), 10000)
    return () => clearTimeout(timer)
  }, [transition, player.isPlaying, finishTransition])

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
      const upcoming = selection()
      if (upcoming || boundary !== 'idle') await animationRef.current.stopAmbience()
      if (announce && boundary !== 'idle' && (upcoming || animationRef.current.snapshot?.prefs.enabled)
        && (backgroundRef.current || animationRef.current.snapshot?.prefs.enabled || animationRef.current.snapshot?.greetingVoiceEnabled)) {
        const scene: TransitionScene = { id: crypto.randomUUID(), background: backgroundRef.current, phase: 'intro' }
        updateTransition(scene)
        const grant = await animationRef.current.startTransition(boundary === 'ended' ? sourceId : null, upcoming?.queueId ?? null)
        if (grant?.background) {
          scene.background = grant.background
          updateTransition({ ...scene })
        }
        const until = performance.now() + TRANSITION_INTRO_MS
        while (performance.now() < until && mounted.current && controlVersion === animationRef.current.controlVersion() && transitionRef.current?.id === scene.id) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        if (!mounted.current || controlVersion !== animationRef.current.controlVersion() || transitionRef.current?.id !== scene.id) return
        updateTransition({ ...scene, phase: 'voice' })
      }
      const greeted = upcoming && controlVersion === animationRef.current.controlVersion()
        ? await greetingsRef.current.attempt(upcoming.queueId)
        : false
      if (!greeted && announce && controlVersion === animationRef.current.controlVersion()) {
        await animationRef.current.attempt(boundary, boundary === 'ended' ? sourceId : null, selection()?.queueId ?? null)
      }
      if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      const current = store.getState().player
      if (!socket.connected || current._authority !== 'GRANTED' || current._isReplayingQueueId !== null || animationRef.current.isBlocked()) return
      // Read the current intent, never restore the pre-announcement pause state.
      if (!current.isPlaying && !current._isPlayingNext) return
      const next = selection()
      if (!next) {
        await finishTransition()
        dispatch(playerStatus({ historyJSON: current.historyJSON, isAtQueueEnd: true, isErrored: false, mediaType: null, _isPlayingNext: false, _isBetweenTracks: false }))
        void animationRef.current.startAmbience()
        return
      }
      if (transitionRef.current) updateTransition({ ...transitionRef.current, phase: 'loading' })
      dispatch(playerStatus({
        errorMessage: '', historyJSON: current.historyJSON, isAtQueueEnd: false, isErrored: false,
        isPlaying: true, isVideoKeyingEnabled: next.isVideoKeyingEnabled, mediaType: next.mediaType,
        position: 0, queueId: next.queueId, nextUserId: null, _isPlayingNext: false, _isBetweenTracks: false, _isReplayPlayback: false,
      }))
    } finally {
      advancing.current = false
      // A command received during an idle probe must get a fresh transition,
      // including its greeting, after the previous async owner releases it.
      if (mounted.current && controlVersion !== animationRef.current.controlVersion()) retryAdvance(value => value + 1)
    }
  }, [dispatch, finishTransition, updateTransition])

  const handleEnd = useCallback(() => {
    if (!queueItem) return
    const token = playbackToken(queueItem.queueId, player._lastReplayTime)
    settlePlayback(settlement.current, token, 'ENDED', { onAdvance: (include) => {
      void handleLoadNext(include, true)
    } })
  }, [handleLoadNext, player._lastReplayTime, queueItem])

  const handleError = useCallback((msg: string, diagnostic?: { category: 'iframe' | 'api-load', code?: number }) => {
    updateTransition(null)
    void animationRef.current.stopTransition(30)
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
  }, [dispatch, handleLoadNext, handleStatus, player._lastReplayTime, queueItem, updateTransition])

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
  }, [handleLoadNext, player.isPlaying, player.queueId, player._isPlayingNext, player._isBetweenTracks, animation.busy, animation.blocked, advanceRevision])

  // replaying?
  useEffect(() => {
    if (player._isReplayingQueueId !== null) {
      handleReplay(player._isReplayingQueueId)
    }
  }, [handleReplay, player._isReplayingQueueId, animation.busy, animation.blocked, advanceRevision])

  // queue was exhausted, but is no longer?
  useEffect(() => {
    if (!animation.busy && !animation.blocked && player.isAtQueueEnd && nextQueueItem && player.isPlaying) {
      void handleLoadNext(false, true, 'start')
    }
  }, [handleLoadNext, player.isPlaying, player.isAtQueueEnd, nextQueueItem, animation.busy, animation.blocked, advanceRevision])

  const pendingIdleVoice = animation.snapshot?.active?.status === 'PENDING'
    && animation.snapshot.active.durationMs <= (animation.snapshot.voiceBudgetRemainingMs ?? 120000)
  const automaticIdleVoice = !animation.snapshot?.active && animation.snapshot?.prefs.enabled && animation.snapshot?.prefs.automation && animation.snapshot?.session?.sessionId
  useEffect(() => {
    if (!animation.busy && !animation.blocked && animation.unlocked && (pendingIdleVoice || automaticIdleVoice)
      && !player.isErrored && (player.isAtQueueEnd || player.queueId === -1)) {
      void handleLoadNext(false, true, 'idle')
    }
  }, [pendingIdleVoice, automaticIdleVoice, animation.snapshot?.active?.interventionId, animation.snapshot?.active?.status, animation.snapshot?.prefs.automation,
    animation.snapshot?.session?.sessionId, animation.snapshot?.session?.status, animation.snapshot?.pendingEventJSON,
    animation.snapshot?.microphoneOccupied, animation.snapshot?.prefs.enabled, animation.snapshot?.prefs.volume,
    animation.snapshot?.active?.durationMs, animation.snapshot?.voiceBudgetRemainingMs,
    animation.busy, animation.blocked, animation.unlocked, animation.idleTick, player.isErrored, player.isAtQueueEnd, player.queueId, handleLoadNext, advanceRevision])

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

  const foregroundScene = !!transition || !!greetings.scene || !!animation.scene || animation.blocked || animation.busy
    || (player._isBetweenTracks && player.queueId !== -1 && !player.isAtQueueEnd)
  const showScene = animation.connected && (foregroundScene || animation.ambientPlaying) && !player.isErrored
  const background = transition
    ? transition.background
    : greetings.scene
      ? greetings.scene.background ?? null
      : animation.scene
        ? animation.scene.background ?? null
        : animation.ambientPlaying ? animation.snapshot?.ambience?.background ?? selectedBackground : selectedBackground
  const sceneId = greetings.scene ? `greeting:${greetings.scene.turnKey}` : animation.scene?.interventionId ?? animation.snapshot?.ambience?.id ?? 'boundary'
  const idleOverlay = (
    <PlayerTextOverlay
      queueItem={queueItem as QueueItem}
      nextQueueItem={nextQueueItem as QueueItem}
      isAtQueueEnd={player.isAtQueueEnd}
      isQueueEmpty={!queue.result.length}
      isErrored={player.isErrored}
      width={props.width}
      height={props.height}
    />
  )

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
        volume={transition ? 0 : player.volume}
        width={props.width}
        height={props.height}
      />
      {showScene && (
        <PlayerTransitionScene background={background} playing={!!(transition || animation.scene || greetings.scene || animation.ambientPlaying || player.isPlaying || player._isPlayingNext)} sceneId={sceneId}>
          {(animation.text || animation.scene) && <div className={`${animationStyles.overlay} ${styles.transitionText}`} role='status' data-testid='announcement-overlay'><p>{animation.text || animation.scene?.displayText}</p></div>}
          {greetings.intro && (
            <section className={`${greetingStyles.screen} ${styles.transitionText}`} role='status' data-testid='greeting-intro'>
              {greetings.performer && <div className={greetingStyles.performer} translate='no'>{`${greetings.performer.requestIntent === 'SING' ? 'Karaoke' : 'Pedido'}: ${greetings.performer.name}${greetings.performer.tableLabel ? ` · ${greetings.performer.tableLabel}` : ''}`}</div>}
              <p>{greetings.intro}</p>
            </section>
          )}
          {greetings.active && (
            <section key={greetings.active.greetingId} ref={greetings.confirmMounted} className={`${greetingStyles.screen} ${styles.transitionText}`} role='status' data-testid='greeting-overlay' data-greeting-id={greetings.active.greetingId}>
              {greetings.performer && <div className={greetingStyles.performer} translate='no'>{`${greetings.performer.requestIntent === 'SING' ? 'Karaoke' : 'Pedido'}: ${greetings.performer.name}${greetings.performer.tableLabel ? ` · ${greetings.performer.tableLabel}` : ''}`}</div>}
              {greetings.active.recipient && <h2 translate='no'>{`Para ${greetings.active.recipient}`}</h2>}
              <p translate='no'>{greetings.active.message}</p>
              <footer translate='no'>{`De ${greetings.active.sender}`}</footer>
            </section>
          )}
          {transition?.phase !== 'intro' && !greetings.active && !greetings.intro && !animation.scene && (foregroundScene
            ? <div className={`${animationStyles.overlay} ${styles.transitionText}`} role='status'><p>{animation.blocked ? 'Esperando el cierre de la intervención anterior…' : player.isPlaying || player._isPlayingNext ? 'Preparando la próxima canción…' : 'Reproducción en pausa'}</p></div>
            : idleOverlay)}
        </PlayerTransitionScene>
      )}
      {greetings.error && <p className={greetingStyles.playerNotice} role='status'>{greetings.error}</p>}
      {(animation.snapshot?.prefs.enabled || animation.snapshot?.greetingVoiceEnabled) && !animation.unlocked && (
        <div className={animationStyles.unlock}>
          {animation.needsGesture
            ? (
                <>
                  <p>El navegador requiere una interacción en esta pestaña para permitir el sonido. Puede usar Reproducir.</p>
                  <Button onClick={animation.unlock}>Permitir sonido</Button>
                </>
              )
            : <p role='status'>{animation.preparingAudio ? 'Preparando audio…' : 'Conectando audio…'}</p>}
          {animation.error && <p role='alert'>{animation.error}</p>}
          {animation.error && !animation.needsGesture && <Button onClick={animation.unlock}>Reintentar audio</Button>}
        </div>
      )}
      {!showScene && idleOverlay}
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
