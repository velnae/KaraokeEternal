import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import { ensureState } from 'redux-optimistic-ui'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import Player from '../Player/Player'
import PlayerTextOverlay from '../PlayerTextOverlay/PlayerTextOverlay'
import PlayerQR from '../PlayerQR/PlayerQR'
import PlayerDisplayOverlay from 'components/PlayerDisplay/PlayerDisplayOverlay'
import { turnPlacement } from 'components/PlayerDisplay/layout'
import useBirthdayPlayer from '../Birthday/useBirthdayPlayer'
import BirthdayScene from '../Birthday/BirthdayScene'
import { resolvePlayerLogo } from 'shared/playerLogo'
import { getPlaybackQueue } from 'routes/Queue/selectors/getRoundRobinQueue'
import { playerLeave, playerError, playerFailure, playerLoad, playerPlay, playerStatus, playerStatusCancel, type PlayerState } from '../../modules/player'
import store from 'store/store'
import socket from 'lib/socket'
import useAnimationPlayer from '../Animation/useAnimationPlayer'
import useGreetingPlayer from '../Animation/useGreetingPlayer'
import PlayerTransitionScene from '../Animation/PlayerTransitionScene'
import PlayerTransitionPresentation from '../Animation/PlayerTransitionPresentation'
import { createTransitionPresentationSelector } from '../Animation/transitionPresentation'
import useSelectedPlayerBackground from '../Animation/useSelectedPlayerBackground'
import usePlayerDiagnostic, { logPlayerDiagnostic } from 'lib/usePlayerDiagnostic'
import Button from 'components/Button/Button'
import animationStyles from 'components/Animation/Animation.css'
import getRoomPrefs from '../../selectors/getRoomPrefs'
import type { QueueItem } from 'shared/types'
import { TRANSITION_VIDEO_SCENE, type TransitionVideoBackground } from 'shared/transitionVideo'
import { animationRequest } from 'lib/animationApi'
import { ANIMATION_LIMITS, TRANSITION_INTRO_MS } from 'shared/animation'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY } from 'shared/actionTypes'
import styles from './PlayerController.css'
import {
  appendCompletedToHistory,
  playbackToken,
  settlePlayback,
  type PlaybackSettlementState,
} from './playbackSettlement'

const DevPlayerTools = process.env.NODE_ENV === 'development' && process.env.DEV_PLAYER_TOOLS === 'true'
  ? React.lazy(() => import('./DevPlayerTools'))
  : null

interface PlayerControllerProps {
  width: number
  height: number
}

type TransitionScene = { id: string, background: TransitionVideoBackground | null, phase: 'intro' | 'voice' | 'loading' | 'handoff' | 'exiting' }

const PlayerController = (props: PlayerControllerProps) => {
  const queue = useAppSelector(getPlaybackQueue)
  const rawQueue = useAppSelector(state => ensureState(state.queue))
  const player = useAppSelector(state => state.player)
  const playerVisualizer = useAppSelector(state => state.playerVisualizer)
  const prefs = useAppSelector(state => state.prefs)
  const roomPrefs = useAppSelector(getRoomPrefs)
  const roomId = useAppSelector(state => state.user.roomId)
  const uiError = useAppSelector(state => state.ui.isErrored ? state.ui.errorMessage : null)
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
  const mediaPlayerRef = useRef<Player>(null)
  const animation = useAnimationPlayer()
  const birthday = useBirthdayPlayer(animation.channel)
  const birthdayRef = useRef(birthday)
  birthdayRef.current = birthday
  const greetings = useGreetingPlayer(animation.channel, animation.refreshReadiness, animation.markStopped)
  const selectedBackground = useSelectedPlayerBackground(roomId, roomPrefs?.transitionVideo, player._authority === 'GRANTED')
  const backgroundRef = useRef(selectedBackground)
  backgroundRef.current = selectedBackground
  const [transition, setTransition] = useState<TransitionScene | null>(null)
  const [preparingQueueId, setPreparingQueueId] = useState<number | null>(null)
  const selectPresentation = useMemo(createTransitionPresentationSelector, [])
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
  const handleLoad = useCallback(() => dispatch(playerLoad()), [dispatch])
  const finishTransition = useCallback(async (fadeMs = 80) => {
    const scene = transitionRef.current
    await animationRef.current.stopTransition(fadeMs)
    if (scene && socket.connected) void animationRequest(TRANSITION_VIDEO_SCENE, { sceneId: scene.id, finished: true }, 1000).catch(() => {})
    if (transitionRef.current === scene) updateTransition(null)
  }, [updateTransition])
  const handlePlay = useCallback(() => {
    animationRef.current.channel.musicStarted()
    const scene = transitionRef.current
    const fadeVisuals = () => {
      if (!mounted.current || transitionRef.current !== scene) return
      updateTransition({ ...scene!, phase: 'exiting' })
      dispatch(playerPlay())
    }
    if (scene?.phase === 'loading') {
      // Local media starts muted until the remaining bed has finished fading.
      void animationRef.current.stopTransition(80).then(fadeVisuals)
    } else if (scene?.phase === 'handoff') {
      fadeVisuals()
    } else dispatch(playerPlay())
  }, [dispatch, updateTransition])
  const handleVisualExit = useCallback(() => {
    if (transition?.phase === 'exiting' && transitionRef.current === transition) void finishTransition(0)
  }, [transition, finishTransition])

  useEffect(() => {
    const cancel = () => {
      setPreparingQueueId(null)
      const scene = transitionRef.current
      if (scene && socket.connected) void animationRequest(TRANSITION_VIDEO_SCENE, { sceneId: scene.id, finished: true }, 1000).catch(() => {})
      updateTransition(null)
      void animationRef.current.stopTransition(30)
    }
    const command = (action: { type: string }) => {
      if (action.type === PLAYER_CMD_STOP) dispatch(playerStatusCancel())
      if ([PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY].includes(action.type)) cancel()
    }
    socket.on('action', command)
    socket.on('disconnect', cancel)
    return () => {
      socket.off('action', command)
      socket.off('disconnect', cancel)
      cancel()
    }
  }, [roomId, updateTransition, dispatch])

  useEffect(() => {
    if (player._authority !== 'GRANTED') {
      setPreparingQueueId(null)
      updateTransition(null)
      void animationRef.current.stopTransition(30)
    }
  }, [player._authority, updateTransition])

  useEffect(() => {
    if (transition?.phase !== 'loading' && transition?.phase !== 'handoff') return
    if (!player.isPlaying) {
      void finishTransition(30)
      return
    }
    if (transition.phase === 'loading' && queueItem?.source === 'YOUTUBE') {
      // Release audio first; keep the picture until YouTube actually starts.
      const scene = transitionRef.current
      void animationRef.current.stopTransition(80).then((): void => {
        if (mounted.current && scene && transitionRef.current === scene) updateTransition({ ...scene, phase: 'handoff' })
        return undefined
      })
    }
    // A failed/blocked media start must expose its existing controls, not leave
    // an opaque transition over the player's recovery UI indefinitely.
    const timer = setTimeout(() => void finishTransition(), 10000)
    return () => clearTimeout(timer)
  }, [transition, player.isPlaying, queueItem?.source, finishTransition, updateTransition])

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
      || store.getState().player._authority !== 'GRANTED' || store.getState().player._isQueueStopped) return
    advancing.current = true
    const controlVersion = animationRef.current.controlVersion()
    const before = store.getState().player
    const transitionStartedAt = performance.now()
    let retryHouseSelection = false
    const sourceId = before.queueId
    const historyJSON = appendCompletedToHistory(before.historyJSON, includeCurrentInHistory && sourceId >= 0 ? sourceId : undefined)
    // Replay suppresses announcements for that playback, not the incoming turn.
    dispatch(playerStatus({ historyJSON, _isBetweenTracks: true, _isReplayPlayback: false, queueDecisionAt: Math.floor(Date.now() / 1000) }))
    const selection = () => {
      const state = store.getState()
      const ordered = getPlaybackQueue(state)
      const index = ordered.result.indexOf(state.player.queueId)
      return ordered.result.slice(index + 1).map(id => ordered.entities[id]).find(item => item.status === 'APPROVED')
    }
    try {
      if (birthdayRef.current.pending) await animationRef.current.stopAmbience()
      const celebration = await birthdayRef.current.attempt(boundary, sourceId)
      if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      if (celebration === 'waiting') return
      if (celebration === 'finished') dispatch(playerStatus({ isPlaying: true }))
      const upcoming = selection()
      setPreparingQueueId(upcoming?.source === 'YOUTUBE' ? upcoming.queueId : null)
      const callRequested = (animationRef.current.snapshot?.karaokeCallsEnabled && upcoming?.origin !== 'HOUSE' && upcoming?.requestIntent === 'SING')
        || (animationRef.current.snapshot?.listeningPresentationsEnabled && upcoming?.origin === 'PARTICIPANT' && upcoming?.requestIntent === 'LISTEN')
      const scene: TransitionScene | null = (announce || callRequested) && boundary !== 'idle' && (upcoming || animationRef.current.snapshot?.prefs.enabled)
        && (backgroundRef.current || store.getState().rooms.entities[store.getState().user.roomId]?.prefs?.transitionVideo?.mode === 'all'
          || animationRef.current.snapshot?.prefs.enabled || animationRef.current.snapshot?.greetingVoiceEnabled)
        ? { id: crypto.randomUUID(), background: backgroundRef.current ?? animationRef.current.snapshot?.ambience?.background ?? null, phase: 'intro' }
        : null
      // Retain the current backdrop before releasing idle ambience or awaiting a new selection.
      if (scene) updateTransition(scene)
      if (upcoming || boundary !== 'idle') await animationRef.current.stopAmbience()
      // A pause can arrive while the previous ambience is being released.
      if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      if (scene) {
        // A scene owns one choice across intro, speech and loading. Preview and
        // audio-permit renewals must not consume another position in the rotation.
        const visual = await animationRequest(TRANSITION_VIDEO_SCENE, { sceneId: scene.id, finished: false }, ANIMATION_LIMITS.startMs).catch((): null => null)
        if (!mounted.current || controlVersion !== animationRef.current.controlVersion() || transitionRef.current?.id !== scene.id) return
        scene.background = visual?.background ?? null
        updateTransition({ ...scene })
        const grant = await animationRef.current.startTransition(boundary === 'ended' ? sourceId : null, upcoming?.queueId ?? null)
        if (!mounted.current || controlVersion !== animationRef.current.controlVersion() || transitionRef.current?.id !== scene.id) return
        if (!visual && grant?.background) {
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
        ? await greetingsRef.current.attempt(upcoming.queueId, callRequested ? Math.max(0, 25000 - (performance.now() - transitionStartedAt)) : undefined)
        : false
      if (!greeted && announce && controlVersion === animationRef.current.controlVersion()) {
        await animationRef.current.attempt(boundary, boundary === 'ended' ? sourceId : null, upcoming?.queueId ?? null)
      }
      if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      const current = store.getState().player
      if (!socket.connected || current._authority !== 'GRANTED' || current._isReplayingQueueId !== null || animationRef.current.isBlocked()) return
      // Read the current intent, never restore the pre-announcement pause state.
      if (!current.isPlaying && !current._isPlayingNext) return
      // An approval can arrive while a normal announcement is running.
      if (birthdayRef.current.pending) {
        await finishTransition()
        const celebration = await birthdayRef.current.attempt(boundary, sourceId)
        if (celebration === 'waiting' || !mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      }
      // Keep the song whose transition just ran, unless it was cancelled.
      const reserved = upcoming && ensureState(store.getState().queue).entities[upcoming.queueId]
      if (reserved?.isOptimistic !== true && reserved?.origin === 'HOUSE' && reserved.status === 'APPROVED') {
        // A customer's reserved turn is protected; house filler must still yield
        // to demand or aging that changed while the transition was running.
        const { housePolicy } = getPlaybackQueue(store.getState(), Math.floor(Date.now() / 1000))
        if (housePolicy.pendingCount > 0 && housePolicy.limit === 0) {
          await finishTransition()
          retryHouseSelection = true
          return
        }
      }
      const next = reserved?.isOptimistic !== true && reserved?.status === 'APPROVED' ? reserved : selection()
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
        position: 0, queueId: next.queueId,
        nextUserId: next.origin === 'PARTICIPANT' ? null : current.nextUserId,
        _isPlayingNext: false, _isBetweenTracks: false, _isReplayPlayback: false,
      }))
    } finally {
      if (mounted.current) setPreparingQueueId(null)
      advancing.current = false
      // A command received during an idle probe must get a fresh transition,
      // including its greeting, after the previous async owner releases it.
      if (mounted.current && (retryHouseSelection || controlVersion !== animationRef.current.controlVersion())) retryAdvance(value => value + 1)
    }
  }, [dispatch, finishTransition, updateTransition])

  useEffect(() => {
    if (!birthday.pending || birthday.busy || player._authority !== 'GRANTED') return
    const probe = () => {
      const current = store.getState().player
      if (!current._isQueueStopped && (current.isAtQueueEnd || current.queueId === -1 || current._isBetweenTracks)) {
        void handleLoadNext(false, false, current.queueId === -1 || current.isAtQueueEnd ? 'idle' : 'ended')
      }
    }
    probe()
    const timer = setInterval(probe, 1000)
    return () => clearInterval(timer)
  }, [birthday.pending, birthday.busy, player._authority, handleLoadNext])

  const handleEnd = useCallback(() => {
    if (!queueItem) return
    const token = playbackToken(queueItem.queueId, player._lastReplayTime)
    settlePlayback(settlement.current, token, 'ENDED', { onAdvance: (include) => {
      void handleLoadNext(include, true)
    } })
  }, [handleLoadNext, player._lastReplayTime, queueItem])

  const handleError = useCallback((msg: string, diagnostic?: { category: 'iframe' | 'api-load', code?: number }) => {
    logPlayerDiagnostic('media', msg, store.getState().user.roomId, queueItem?.queueId)
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
      .find(queueId => queue.entities[queueId].origin === 'PARTICIPANT' && queue.entities[queueId].status === 'APPROVED')
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
      // Next and a resumed boundary need the same full transition as natural end.
      void handleLoadNext(!player._isBetweenTracks, true, first ? 'start' : 'ended')
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
    if (!player._isQueueStopped && !animation.busy && !animation.blocked && animation.unlocked && (pendingIdleVoice || automaticIdleVoice)
      && !player.isErrored && (player.isAtQueueEnd || player.queueId === -1)) {
      void handleLoadNext(false, true, 'idle')
    }
  }, [pendingIdleVoice, automaticIdleVoice, animation.snapshot?.active?.interventionId, animation.snapshot?.active?.status, animation.snapshot?.prefs.automation,
    animation.snapshot?.session?.sessionId, animation.snapshot?.session?.status, animation.snapshot?.pendingEventJSON,
    animation.snapshot?.microphoneOccupied, animation.snapshot?.prefs.enabled, animation.snapshot?.prefs.volume,
    animation.snapshot?.active?.durationMs, animation.snapshot?.voiceBudgetRemainingMs,
    animation.busy, animation.blocked, animation.unlocked, animation.idleTick, player.isErrored, player.isAtQueueEnd, player.queueId, player._isQueueStopped, handleLoadNext, advanceRevision])

  const { startAmbience, ambientPlaying, ambientTick } = animation
  useEffect(() => {
    if (!birthday.pending && !birthday.busy && !player._isQueueStopped && !advancing.current && !animation.busy && !animation.blocked && animation.unlocked && !ambientPlaying
      && !player.isErrored && (player.isAtQueueEnd || player.queueId === -1)) void startAmbience()
  }, [birthday.pending, birthday.busy, animation.snapshot, animation.busy, animation.blocked, animation.unlocked, ambientPlaying, ambientTick, startAmbience, player.isErrored, player.isAtQueueEnd, player.queueId, player._isQueueStopped])

  // retrying after error?
  useEffect(() => {
    if (player.isErrored && player.isPlaying) {
      handleStatus({ isErrored: false })
    }
  }, [handleStatus, player.isErrored, player.isPlaying])

  const foregroundScene = birthday.busy || !!transition || !!greetings.scene || !!animation.scene || animation.blocked || animation.busy
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
  const handingOff = transition?.phase === 'handoff' || transition?.phase === 'exiting'
  const presentedTracks = selectPresentation({ queue: rawQueue, player, preferences: roomPrefs?.queue, loading: transition?.phase === 'loading' || handingOff })
  const preparingItem = preparingQueueId === null ? undefined : rawQueue.entities[preparingQueueId]
  const preparedYouTube = preparingItem && preparingItem.isOptimistic !== true
    && preparingItem.source === 'YOUTUBE' && preparingItem.status === 'APPROVED' && preparingItem.externalId
    ? { mediaKey: preparingItem.queueId, videoId: preparingItem.externalId }
    : null
  let phase: string
  if (player._authority === 'PENDING') phase = 'Conectando el reproductor…'
  else if (player._authority === 'DENIED') phase = 'Esperando a que se libere la sala.'
  else if (player.isErrored) phase = 'Error'
  else if (transition) phase = { intro: 'Intro', voice: 'Voz', loading: 'Cargando', handoff: 'Iniciando canción', exiting: 'Fundido' }[transition.phase]
  else if (greetings.scene || animation.scene) phase = 'Voz'
  else if (animation.blocked || animation.busy || player._isBetweenTracks) phase = 'Preparando'
  else if (player.isAtQueueEnd || !queueItem) phase = 'Ambiente / espera'
  else phase = player.isPlaying ? 'Canción' : 'Pausa'
  const audioStatus = (animation.snapshot?.prefs.enabled || animation.snapshot?.greetingVoiceEnabled) && !animation.unlocked
    ? animation.needsGesture ? 'Esperando permiso de sonido' : animation.preparingAudio ? 'Preparando audio…' : 'Conectando audio…'
    : ''
  usePlayerDiagnostic('phase', phase, 'info')
  usePlayerDiagnostic('audio-status', audioStatus, 'info')
  usePlayerDiagnostic('greeting', greetings.error)
  usePlayerDiagnostic('animation', animation.error)
  const developmentTools = DevPlayerTools && (
    <React.Suspense fallback={null}>
      <DevPlayerTools
        key={player.queueId}
        phase={phase}
        diagnostics={[audioStatus, greetings.error, animation.error, uiError, player.isErrored && player.errorMessage].filter(Boolean) as string[]}
        canSeek={queueItem?.source === 'YOUTUBE' && !foregroundScene && !player.isAtQueueEnd && !player.isErrored}
        isPlaying={player.isPlaying && !birthday.busy}
        onSeek={target => mediaPlayerRef.current?.seekForDevelopment(target)}
      />
    </React.Suspense>
  )
  if (player._authority !== 'GRANTED') return (
    <>
      {player._authority === 'DENIED' && <div className={styles.authorityNotice} role='status'><h1>Ya hay un reproductor activo</h1></div>}
      {developmentTools}
    </>
  )
  const youtubeSong = queueItem?.source === 'YOUTUBE' && !player.isAtQueueEnd && !player._isQueueStopped
    && !foregroundScene && !showScene
  const showBranding = youtubeSong && !player.isErrored && !player._isFetching && !player._isBetweenTracks
    && !player._isPlayingNext && player._isReplayingQueueId === null
  const logoVisible = showBranding && prefs.playerDisplay.logo.enabled && !!resolvePlayerLogo(prefs.playerDisplay.logo, prefs.branding.logoSrc).still
  const turn = turnPlacement(prefs.playerDisplay, props, logoVisible, showBranding && prefs.playerDisplay.announcement.enabled && queueItem.requestIntent === 'LISTEN')
  const idleOverlay = (
    <PlayerTextOverlay
      queueItem={queueItem as QueueItem}
      nextQueueItem={nextQueueItem as QueueItem}
      isAtQueueEnd={player.isAtQueueEnd}
      isQueueEmpty={!queue.result.length}
      isErrored={player.isErrored}
      width={props.width}
      height={props.height}
      turnPlacement={turn}
    />
  )

  return (
    <>
      <Player
        ref={mediaPlayerRef}
        cdgAlpha={player.cdgAlpha}
        cdgSize={player.cdgSize}
        isPlaying={player.isPlaying && !birthday.busy}
        isVisible={!!queueItem && !player.isErrored && !player.isAtQueueEnd && !player._isBetweenTracks && !animation.busy && !animation.blocked
          && !(queueItem.source === 'YOUTUBE' && transition && !handingOff)}
        preparedYouTube={preparedYouTube}
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
        volume={transition && !handingOff ? 0 : player.volume}
        width={props.width}
        height={props.height}
      />
      {birthday.scene && <BirthdayScene key={birthday.scene.grant.event.id} grant={birthday.scene.grant} />}
      {showScene && !birthday.scene && (
        <PlayerTransitionScene
          background={background}
          playing={!!(transition || animation.scene || greetings.scene || animation.ambientPlaying || player.isPlaying || player._isPlayingNext)}
          sceneId={sceneId}
          exiting={transition?.phase === 'exiting'}
          onExited={handleVisualExit}
        >
          {birthday.pendingEvent
            ? (
                <div className={styles.authorityNotice} role='status'>
                  <h1>{`Cumpleaños de ${birthday.pendingEvent.name}`}</h1>
                  <p>Preparando la celebración…</p>
                </div>
              )
            : foregroundScene
              ? (
                  <PlayerTransitionPresentation
                    {...presentedTracks}
                    venueName={prefs.branding.name}
                    announcementActive={!!(animation.text || animation.scene || greetings.scene?.transition?.call)}
                    greetingIntro={!!greetings.intro}
                    greeting={greetings.active}
                    moderationTerms={prefs.moderation.terms}
                    onGreetingMounted={greetings.confirmMounted}
                  />
                )
              : idleOverlay}
        </PlayerTransitionScene>
      )}
      {(birthday.needsSound || birthday.needsVolume || (audioStatus && (animation.needsGesture || animation.error))) && (
        <div className={animationStyles.unlock}>
          {animation.needsGesture || birthday.needsSound
            ? (
                <>
                  <p>Activa el sonido</p>
                  <Button variant='primary' onClick={birthday.needsSound ? birthday.unlock : animation.unlock}>Permitir sonido</Button>
                </>
              )
            : animation.error ? <p role='status'>No se pudo activar el sonido.</p> : null}
          {animation.error && !animation.needsGesture && <Button onClick={animation.unlock}>Reintentar audio</Button>}
          {birthday.error && <p role='alert'>{birthday.error}</p>}
          {birthday.needsVolume && <p role='status'>Suba el volumen para iniciar el cumpleaños.</p>}
        </div>
      )}
      {!showScene && !birthday.scene && idleOverlay}
      {showBranding && <PlayerDisplayOverlay key={queueItem.queueId} branding={prefs.branding} settings={prefs.playerDisplay} viewport={props} intent={queueItem.requestIntent} isPlaying={player.isPlaying} />}
      {developmentTools}
      {roomPrefs?.qr?.isEnabled && !youtubeSong && (
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
