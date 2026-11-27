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
import { animationRequest, syncAnimation } from 'lib/animationApi'
import { transitionRequest } from 'lib/transitionRequest'
import { ANIMATION_LIMITS, TRANSITION_INTRO_MS } from 'shared/animation'
import useKaraokeStart from '../Animation/useKaraokeStart'
import useKaraokeCues from '../Animation/useKaraokeCues'
import KaraokeMascot from 'components/Animation/KaraokeMascot'
import { KARAOKE_FADE_MS } from 'shared/karaokeStage'
import KaraokeCountdown from 'components/Animation/KaraokeCountdown'
import { karaokeCountdownSeconds, type KaraokeTurn } from 'shared/karaokeStart'
import { animationTime } from 'lib/animationApi'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY, PLAYER_EMIT_STATUS } from 'shared/actionTypes'
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

import { beginTransitionDiagnostic, type TransitionDiagnostic } from 'lib/playbackTrace'
import { planNormalTurn, compareTurnSelection, turnIdentity } from '../../runtime/turnPlan'
import { beginBrowserTurn, developmentExecutor } from '../../runtime/browserNormalTurn'
import { tracePlayback } from 'lib/playbackTrace'

type TransitionScene = { id: string, background: TransitionVideoBackground | null, phase: 'warmup' | 'preroll' | 'intro' | 'voice' | 'waiting' | 'loading' | 'handoff' | 'exiting' }
const PREROLL_MS = 1500
const WARMUP_MS = 5000

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
  const karaokeStart = useKaraokeStart()
  const karaokeCues = useKaraokeCues(animation.channel, animation.refreshReadiness, animation.markStopped)
  const karaokeCuesRef = useRef(karaokeCues)
  karaokeCuesRef.current = karaokeCues
  const karaokeStartRef = useRef(karaokeStart)
  karaokeStartRef.current = karaokeStart
  const releasedKaraoke = useRef<{ turn: KaraokeTurn, acknowledging: boolean } | null>(null)
  const [, tickCountdown] = useState(0)
  useEffect(() => {
    if (animation.snapshot?.karaokeTurn?.phase !== 'countdown') return
    const timer = setInterval(() => tickCountdown(value => value + 1), 100)
    return () => clearInterval(timer)
  }, [animation.snapshot?.karaokeTurn?.phase])
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
  const directed = useRef<ReturnType<typeof beginBrowserTurn> | null>(null)
  const diagnosticRef = useRef<TransitionDiagnostic | undefined>(undefined)
  const onBackgroundReady = useCallback((ready: boolean) => {
    diagnosticRef.current?.record('background-readiness', { state: ready ? 'ready' : 'pending' })
  }, [])
  const warmup = useRef<{ source: number, next: number | null, id: string, visual: Promise<TransitionVideoBackground | null | undefined> } | null>(null)
  const updateTransition = useCallback((value: TransitionScene | null) => {
    const previous = transitionRef.current
    if (previous?.phase !== value?.phase || previous?.id !== value?.id || previous?.background?.resource.id !== value?.background?.resource.id) {
      diagnosticRef.current?.record('transition-scene', { state: value?.phase ?? 'hidden', reason: value?.background ? 'background-selected' : 'no-background' })
      if (!value) diagnosticRef.current?.flush()
    }
    transitionRef.current = value
    if (mounted.current) setTransition(value)
  }, [])
  const greetingsRef = useRef(greetings)
  greetingsRef.current = greetings
  const animationRef = useRef(animation)
  animationRef.current = animation

  const dispatch = useAppDispatch()
  const resolveVisual = useCallback(async (sceneId: string, queueId: number | null) => {
    const diagnostic = diagnosticRef.current
    const began = diagnostic ? performance.now() : 0
    try {
      const owner = socket.id
      const { background } = await transitionRequest(() => animationRequest(TRANSITION_VIDEO_SCENE, { sceneId, queueId, finished: false }, ANIMATION_LIMITS.startMs), syncAnimation,
        () => socket.connected && socket.id === owner && (warmup.current?.id === sceneId || transitionRef.current?.id === sceneId))
      diagnostic?.record('background-reply', { queueId, state: background ? 'selected' : 'no-background', elapsedMs: performance.now() - began })
      return background
    } catch {
      diagnostic?.flag('background-request-failed', { queueId, elapsedMs: performance.now() - began })
      return undefined
    }
  }, [])
  const cancelWarmup = useCallback(() => {
    const pending = warmup.current
    if (!pending) return
    warmup.current = null
    setPreparingQueueId(null)
    if (transitionRef.current?.id === pending.id) updateTransition(null)
    if (socket.connected) void animationRequest(TRANSITION_VIDEO_SCENE, { sceneId: pending.id, finished: true }, 1000).catch(() => {})
  }, [updateTransition])
  const handleProgress = useCallback((source: number, remainingMs: number | null) => {
    const state = store.getState()
    const player = state.player
    if (player.queueId !== source || advancing.current) return
    if (remainingMs === null || remainingMs > WARMUP_MS || !player.isPlaying || !socket.connected || player._authority !== 'GRANTED') {
      cancelWarmup()
      return
    }
    const snapshot = animationRef.current.snapshot
    const prefs = state.rooms.entities[state.user.roomId]?.prefs
    if (remainingMs <= 0 || player._isReplayPlayback || (!prefs?.transitionVideo
      && !snapshot?.prefs.enabled && !snapshot?.greetingVoiceEnabled && !snapshot?.karaokeCallsEnabled
      && !snapshot?.listeningPresentationsEnabled && !birthdayRef.current.pending)) return
    const queue = getPlaybackQueue(state)
    const next = queue.result.slice(queue.result.indexOf(source) + 1).map(id => queue.entities[id]).find(item => item.status === 'APPROVED')
    if (warmup.current && warmup.current.next !== (next?.queueId ?? null)) cancelWarmup()
    if (!warmup.current && transitionRef.current) return
    if (!warmup.current) {
      diagnosticRef.current = beginTransitionDiagnostic(source, state.user.roomId)
      const id = crypto.randomUUID()
      const visual = resolveVisual(id, next?.queueId ?? null)
      warmup.current = { source, next: next?.queueId ?? null, id, visual }
      setPreparingQueueId(next?.source === 'YOUTUBE' ? next.queueId : null)
      updateTransition({ id, phase: 'warmup', background: backgroundRef.current })
      void visual.then((background): void => {
        const scene = transitionRef.current
        if (warmup.current?.id === id && scene?.id === id && background !== undefined) updateTransition({ ...scene, background })
        return undefined
      })
    }
    if (remainingMs <= PREROLL_MS && transitionRef.current?.phase === 'warmup' && transitionRef.current.id === warmup.current.id) {
      updateTransition({ ...transitionRef.current, phase: 'preroll' })
    }
  }, [cancelWarmup, resolveVisual, updateTransition])
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
    const release = releasedKaraoke.current
    const playing = store.getState().player
    const scene = transitionRef.current
    if (scene?.phase === 'loading' || scene?.phase === 'handoff') {
      diagnosticRef.current?.record('transition-incoming-playing', { queueId: playing.queueId })
      diagnosticRef.current?.flush()
    }
    if (!release && directed.current?.destination === playing.queueId) {
      directed.current.report({ type: 'playing' })
      if (!scene) dispatch(playerPlay())
      return
    }
    if (release?.turn.queueId === playing.queueId) {
      if (release.acknowledging) return
      release.acknowledging = true
      const version = animationRef.current.controlVersion()
      const stillPlaying = () => {
        const current = store.getState().player
        return mounted.current && socket.connected && animationRef.current.controlVersion() === version
          && current._authority === 'GRANTED' && current.queueId === playing.queueId && current._lastReplayTime === playing._lastReplayTime
      }
      if (directed.current?.destination === playing.queueId) directed.current.report({ type: 'playing' })
      else {
        if (scene) updateTransition({ ...scene, phase: 'exiting' })
        void animationRef.current.stopTransition(250)
        animationRef.current.channel.musicStarted()
      }
      void karaokeStartRef.current.played(release.turn).then((): void => {
        if (stillPlaying()) dispatch(playerPlay())
        return undefined
      }).catch(() => {
        if (stillPlaying()) dispatch(playerStatus({ isPlaying: false, _isBetweenTracks: true }))
      }).finally(() => {
        if (releasedKaraoke.current === release) releasedKaraoke.current = null
      })
      return
    }
    animationRef.current.channel.musicStarted()
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
    if (transition?.phase === 'exiting' && transitionRef.current === transition && directed.current) {
      directed.current.report({ type: 'exited' })
      return
    }
    if (transition?.phase === 'exiting' && transitionRef.current === transition) void finishTransition(0)
  }, [transition, finishTransition])

  useEffect(() => {
    const cancel = () => {
      directed.current?.cancel('stop')
      cancelWarmup()
      releasedKaraoke.current = null
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
  }, [roomId, updateTransition, dispatch, cancelWarmup])

  useEffect(() => {
    if (player._authority !== 'GRANTED') {
      directed.current?.cancel('authority-lost')
      cancelWarmup()
      releasedKaraoke.current = null
      setPreparingQueueId(null)
      updateTransition(null)
      void animationRef.current.stopTransition(30)
    }
  }, [player._authority, updateTransition, cancelWarmup])

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
    const timer = setTimeout(() => {
      diagnosticRef.current?.flag('incoming-media-start-timeout', { queueId: queueItem?.queueId })
      void finishTransition()
    }, 10000)
    return () => clearTimeout(timer)
  }, [transition, player.isPlaying, queueItem?.source, queueItem?.queueId, finishTransition, updateTransition])

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
    if (boundary !== 'ended' || warmup.current?.source !== before.queueId) cancelWarmup()
    let transitionStartedAt = performance.now()
    let retryHouseSelection = false
    let retryAfterBirthday = false
    const sourceId = before.queueId
    if (!warmup.current) diagnosticRef.current = boundary === 'idle' ? undefined : beginTransitionDiagnostic(sourceId, store.getState().user.roomId)
    const diagnostic = diagnosticRef.current
    const executor = developmentExecutor()
    let owned: ReturnType<typeof beginBrowserTurn> | undefined
    let promoted = false
    diagnostic?.record('transition-boundary', { state: boundary })
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
      const birthdayPending = birthdayRef.current.pending
      if (birthdayPending) {
        const scene = transitionRef.current
        if (scene && warmup.current?.id === scene.id) updateTransition({ ...scene, phase: 'intro' })
        await animationRef.current.stopAmbience()
        if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      }
      const celebration = birthdayPending ? await birthdayRef.current.attempt(boundary, sourceId) : 'none'
      if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      if (celebration === 'waiting') return
      if (celebration === 'finished') {
        dispatch(playerStatus({ isPlaying: true }))
        boundary = 'start'
        announce = true
        transitionStartedAt = performance.now()
      }
      const previous = ensureState(store.getState().queue).entities[sourceId]
      if (boundary === 'ended' && announce && previous?.isOptimistic !== true && previous?.requestIntent === 'SING' && previous.origin !== 'HOUSE') {
        await karaokeCuesRef.current.play({ queueId: sourceId, kind: 'ended', token: String(before._lastReplayTime) })
        if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
        transitionStartedAt = performance.now()
      }
      const held = store.getState().animation.snapshot?.karaokeTurn
      const heldItem = held ? ensureState(store.getState().queue).entities[held.queueId] : null
      const upcoming = heldItem?.isOptimistic !== true && heldItem?.status === 'APPROVED' ? heldItem : selection()
      const deadline = transitionStartedAt + 25000
      const connection = socket.id
      const turnValid = () => mounted.current && socket.connected && socket.id === connection && store.getState().player._authority === 'GRANTED'
        && store.getState().player.queueId === sourceId && controlVersion === animationRef.current.controlVersion() && performance.now() < deadline
        && (heldItem && heldItem === upcoming ? store.getState().animation.snapshot?.karaokeTurn?.queueId === upcoming.queueId : selection()?.queueId === upcoming?.queueId)
      // Socket actions are ordered. The server applies status synchronously before
      // the following permit request and validates authority again on that request.
      if (turnValid()) {
        dispatch(playerStatusCancel())
        const state = store.getState()
        const status = Object.fromEntries(Object.entries(state.player).filter(([key]) => !key.startsWith('_')))
        socket.timeout(3000).emit('action', { type: PLAYER_EMIT_STATUS, payload: { ...status, visualizer: state.playerVisualizer } }, () => {})
      }
      if (warmup.current && warmup.current.next !== (upcoming?.queueId ?? null)) cancelWarmup()
      const manualTurn = upcoming?.requestIntent === 'SING' && upcoming.origin !== 'HOUSE'
        ? await karaokeStartRef.current.begin(upcoming.queueId)
        : null
      if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      const prepared = warmup.current
      warmup.current = null
      setPreparingQueueId(upcoming?.source === 'YOUTUBE' ? upcoming.queueId : null)
      const callRequested = (animationRef.current.snapshot?.karaokeCallsEnabled && upcoming?.origin !== 'HOUSE' && upcoming?.requestIntent === 'SING')
        || (animationRef.current.snapshot?.listeningPresentationsEnabled && upcoming?.origin === 'PARTICIPANT' && upcoming?.requestIntent === 'LISTEN')
      const scene: TransitionScene | null = (announce || callRequested || manualTurn) && boundary !== 'idle' && (upcoming || animationRef.current.snapshot?.prefs.enabled)
        && (backgroundRef.current || store.getState().rooms.entities[store.getState().user.roomId]?.prefs?.transitionVideo?.mode === 'all'
          || animationRef.current.snapshot?.prefs.enabled || animationRef.current.snapshot?.greetingVoiceEnabled || callRequested || manualTurn)
        ? { id: prepared?.id ?? crypto.randomUUID(), background: transitionRef.current?.background ?? backgroundRef.current ?? animationRef.current.snapshot?.ambience?.background ?? null, phase: manualTurn?.presented ? 'waiting' : 'intro' }
        : null
      // Retain the current backdrop before releasing idle ambience or awaiting a new selection.
      let observedPlan: ReturnType<typeof planNormalTurn> | undefined
      if (executor !== 'legacy') {
        const state = store.getState()
        const snapshot = state.animation.snapshot
        observedPlan = planNormalTurn({ roomId: state.user.roomId, epoch: snapshot?.playerEpoch ?? null, source: sourceId,
          replayKey: before._lastReplayTime, boundary, queue: getPlaybackQueue(state), held: heldItem ?? null, announce,
          backdrop: !!backgroundRef.current || state.rooms.entities[state.user.roomId]?.prefs?.transitionVideo?.mode === 'all',
          animator: !!snapshot?.prefs.enabled, greetings: !!snapshot?.greetingVoiceEnabled,
          listeningPresentations: snapshot?.listeningPresentationsEnabled,
          karaokeCalls: snapshot?.karaokeCallsEnabled, manualKaraoke: manualTurn,
          ambience: !!snapshot?.prefs.ambienceEnabled && snapshot.prefs.ambienceVolume !== 0 })
        tracePlayback('v2-plan-observed', { diagnosticId: diagnostic?.diagnosticId, roomId: state.user.roomId, sourceQueueId: sourceId,
          queueId: observedPlan.destination, observedQueueId: upcoming?.queueId ?? null, turnIdentity: observedPlan.identity,
          state: compareTurnSelection(observedPlan, upcoming?.queueId ?? null, !!scene), reason: observedPlan.steps.join(',') || observedPlan.kind })
      }
      if (scene) updateTransition(scene)
      else if (prepared && transitionRef.current?.id === prepared.id) {
        updateTransition(null)
        void animationRequest(TRANSITION_VIDEO_SCENE, { sceneId: prepared.id, finished: true }, 1000).catch(() => {})
      }
      if (upcoming || boundary !== 'idle') await animationRef.current.stopAmbience()
      // A pause can arrive while the previous ambience is being released.
      if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      const waitForOperator = async (turn: KaraokeTurn, signal?: AbortSignal) => {
        if (!upcoming || turn.queueId !== upcoming.queueId || signal?.aborted) return false
        if (transitionRef.current) updateTransition({ ...transitionRef.current, phase: 'waiting' })
        const valid = () => {
          const state = store.getState()
          const item = ensureState(state.queue).entities[turn.queueId]
          return !signal?.aborted && mounted.current && socket.connected && controlVersion === animationRef.current.controlVersion()
            && state.player._authority === 'GRANTED' && (state.player.isPlaying || state.player._isPlayingNext)
            && item?.isOptimistic !== true && item?.status === 'APPROVED' && !birthdayRef.current.pending
            && state.rooms.entities[state.user.roomId]?.status !== 'closed'
        }
        const started = await karaokeStartRef.current.wait(turn, valid, async () => {
          if (store.getState().animation.snapshot?.karaokeTurn?.phase === 'waiting') await animationRef.current.keepTransition(before.queueId === -1 || before.queueId === upcoming.queueId ? null : before.queueId, upcoming.queueId)
        }, async (tick) => {
          if (tick.phase === 'countdown') {
            void animationRef.current.stopTransition(KARAOKE_FADE_MS)
            void karaokeCuesRef.current.play({ queueId: tick.queueId, kind: 'countdown', token: `${tick.runId}-${tick.revision}`, runId: tick.runId, revision: tick.revision })
          } else if (tick.phase === 'waiting' && tick.reminderAt && animationTime() >= tick.reminderAt) {
            await karaokeCuesRef.current.play({ queueId: tick.queueId, kind: 'reminder', token: `${tick.runId}-${tick.reminderAt}`, runId: tick.runId, revision: tick.revision })
          }
        }).catch(() => false)
        if (started) return valid()
        if (signal?.aborted) return false
        const pending = ensureState(store.getState().queue).entities[turn.queueId]
        if (birthdayRef.current.pending) {
          await animationRef.current.stopTransition(80)
          retryAfterBirthday = true
        } else if (mounted.current && socket.connected && controlVersion === animationRef.current.controlVersion()
          && (!pending || (pending.isOptimistic !== true && pending.status !== 'APPROVED'))) {
          await finishTransition()
          retryHouseSelection = true
        } else if (valid()) setTimeout(() => {
          if (mounted.current) retryAdvance(value => value + 1)
        }, 1000)
        return false
      }
      if (executor === 'v2' && observedPlan && upcoming && (observedPlan.kind === 'karaoke' || observedPlan.kind === 'listening' || (observedPlan.kind === 'normal' && scene))
        && observedPlan.destination === upcoming.queueId && observedPlan.scene === !!scene && turnValid()) {
        directed.current?.cancel('replaced')
        const valid = (signal: AbortSignal) => !signal.aborted && turnValid() && (!scene || transitionRef.current?.id === scene.id)
        owned = beginBrowserTurn(observedPlan, Math.max(1, deadline - performance.now()), {
          serverNow: animationTime,
          entry: async (signal) => {
            if (scene && valid(signal)) await karaokeCuesRef.current.play({ queueId: upcoming.queueId, kind: 'entry', token: manualTurn?.runId ?? scene.id })
          },
          operatorRelease: async (signal) => {
            if (!manualTurn || !await waitForOperator(manualTurn, signal)) return null
            await animationRef.current.stopTransition(KARAOKE_FADE_MS)
            const live = store.getState().animation.snapshot?.karaokeTurn
            return !signal.aborted && live?.phase === 'released' && live.runId === manualTurn.runId && live.queueId === upcoming.queueId ? live : null
          },
          backdrop: async (signal) => {
            if (!scene) return
            let visual = prepared ? await prepared.visual : undefined
            if (visual === undefined && valid(signal)) visual = await resolveVisual(scene.id, upcoming.queueId)
            if (visual !== undefined && valid(signal)) updateTransition({ ...transitionRef.current!, background: visual })
          },
          bed: async (signal) => {
            const grant = await animationRef.current.startTransition(boundary === 'ended' ? sourceId : null, upcoming.queueId, () => valid(signal))
            if (valid(signal) && !transitionRef.current!.background && grant?.background) updateTransition({ ...transitionRef.current!, background: grant.background })
          },
          presentation: async (signal) => {
            if (!valid(signal)) return true
            if (scene) updateTransition({ ...transitionRef.current!, phase: 'voice' })
            return greetingsRef.current.attempt(upcoming.queueId, deadline - performance.now(), diagnostic, !!callRequested, signal)
          },
          announcement: async (signal) => {
            if (!valid(signal)) return
            if (scene) updateTransition({ ...transitionRef.current!, phase: 'voice' })
            await animationRef.current.attempt(boundary, boundary === 'ended' ? sourceId : null, upcoming.queueId, diagnostic, () => valid(signal), deadline)
          },
          exit: () => {
            animationRef.current.channel.musicStarted()
            void animationRef.current.stopTransition(80).then((): void => {
              if (scene && directed.current === owned && transitionRef.current?.id === scene.id) {
                updateTransition({ ...transitionRef.current, phase: 'exiting' })
                if (!manualTurn) dispatch(playerPlay())
              }
              return undefined
            })
          },
          released: (reason) => {
            diagnostic?.record('v2-turn-released', { state: reason })
            if (directed.current !== owned) return
            directed.current = null
            if (reason !== 'finished') animationRef.current.abort(reason)
            if (scene && transitionRef.current?.id === scene.id) void finishTransition(0)
          },
        })
        directed.current = owned
        diagnostic?.record('v2-turn-executing', { queueId: upcoming.queueId })
        if (!await owned.handoff || owned.signal.aborted) return
      } else if (scene) {
        // A scene owns one choice across intro, speech and loading. Preview and
        // audio-permit renewals must not consume another position in the rotation.
        const beginBed = () => turnValid() ? animationRef.current.startTransition(boundary === 'ended' ? sourceId : null, upcoming?.queueId ?? null, turnValid) : null
        const firstVisual = prepared?.visual ?? resolveVisual(scene.id, upcoming?.queueId ?? null)
        const earlyBed = upcoming?.requestIntent !== 'SING' ? beginBed() : null
        let visual = await firstVisual
        // An unanswered warmup is not a choice of no video. Recover the same
        // scene (and rotation slot) instead of carrying an empty backdrop forward.
        if (prepared && visual === undefined && turnValid() && transitionRef.current?.id === scene.id) {
          visual = await resolveVisual(scene.id, upcoming?.queueId ?? null)
        }
        if (!mounted.current || controlVersion !== animationRef.current.controlVersion() || transitionRef.current?.id !== scene.id) return
        if (visual !== undefined) scene.background = visual
        updateTransition({ ...scene })
        if (upcoming?.requestIntent === 'SING' && !manualTurn?.presented && !callRequested) {
          await karaokeCuesRef.current.play({ queueId: upcoming.queueId, kind: 'entry', token: manualTurn?.runId ?? scene.id })
          if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
        }
        const grant = await (earlyBed ?? beginBed())
        if (!mounted.current || controlVersion !== animationRef.current.controlVersion() || transitionRef.current?.id !== scene.id) return
        if (!scene.background && grant?.background) {
          scene.background = grant.background
          updateTransition({ ...scene })
        }
        const now = performance.now()
        // A visual pre-roll does not play the bed and cannot replace its lead-in.
        const until = now + (manualTurn?.presented || upcoming?.requestIntent === 'SING' ? 0 : TRANSITION_INTRO_MS)
        while (performance.now() < until && mounted.current && controlVersion === animationRef.current.controlVersion() && transitionRef.current?.id === scene.id) {
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        if (!mounted.current || controlVersion !== animationRef.current.controlVersion() || transitionRef.current?.id !== scene.id) return
        updateTransition({ ...scene, phase: 'voice' })
      }
      const greeted = !owned && upcoming && upcoming.origin !== 'HOUSE' && !manualTurn?.presented && turnValid()
        ? await greetingsRef.current.attempt(upcoming.queueId, deadline - performance.now(), diagnostic, !!callRequested)
        : false
      if (!owned && !greeted && !manualTurn?.presented && announce && turnValid()) {
        await animationRef.current.attempt(boundary, boundary === 'ended' ? sourceId : null, upcoming?.queueId ?? null, diagnostic, turnValid, deadline)
      }
      if (!owned && manualTurn && !await waitForOperator(manualTurn)) return
      if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
      const current = store.getState().player
      if (!socket.connected || current._authority !== 'GRANTED' || current._isReplayingQueueId !== null
        || (animationRef.current.isBlocked() && !(upcoming && karaokeCuesRef.current.allowsMusic(upcoming.queueId)))) return
      // Read the current intent, never restore the pre-announcement pause state.
      if (!current.isPlaying && !current._isPlayingNext) return
      // An approval can arrive while a normal announcement is running.
      if (birthdayRef.current.pending) {
        // Keep the current picture until the celebration has its own scene.
        await animationRef.current.stopTransition(80)
        if (!mounted.current || controlVersion !== animationRef.current.controlVersion()) return
        const celebration = await birthdayRef.current.attempt(boundary, sourceId)
        if (celebration === 'waiting' || !mounted.current || controlVersion !== animationRef.current.controlVersion()) return
        if (celebration === 'finished') {
          dispatch(playerStatus({ isPlaying: true }))
          retryAfterBirthday = true
          return
        }
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
      if (owned && next?.queueId !== owned.destination) {
        retryHouseSelection = true
        return
      }
      if (observedPlan) tracePlayback('v2-plan-handoff', { diagnosticId: diagnostic?.diagnosticId, sourceQueueId: sourceId,
        turnIdentity: observedPlan.identity, queueId: observedPlan.destination, observedQueueId: next?.queueId ?? null,
        state: observedPlan.identity === turnIdentity(store.getState().user.roomId, store.getState().animation.snapshot?.playerEpoch ?? null,
          current.queueId, current._lastReplayTime, next?.queueId ?? null)
          ? 'match'
          : 'turn-changed' })
      if (!next) {
        await finishTransition()
        dispatch(playerStatus({ historyJSON: current.historyJSON, isAtQueueEnd: true, isErrored: false, mediaType: null, _isPlayingNext: false, _isBetweenTracks: false }))
        void animationRef.current.startAmbience()
        return
      }
      if (manualTurn?.queueId === next.queueId) releasedKaraoke.current = { turn: manualTurn, acknowledging: false }
      if (transitionRef.current) updateTransition({ ...transitionRef.current, phase: 'loading' })
      promoted = true
      dispatch(playerStatus({
        errorMessage: '', historyJSON: current.historyJSON, isAtQueueEnd: false, isErrored: false,
        isPlaying: true, isVideoKeyingEnabled: next.isVideoKeyingEnabled, mediaType: next.mediaType,
        position: 0, queueId: next.queueId,
        nextUserId: next.origin === 'PARTICIPANT' ? null : current.nextUserId,
        _isPlayingNext: false, _isBetweenTracks: false, _isReplayPlayback: false,
      }))
    } finally {
      if (owned && !promoted) owned.cancel('replaced')
      diagnostic?.flush()
      if (mounted.current) setPreparingQueueId(null)
      advancing.current = false
      // A command received during an idle probe must get a fresh transition,
      // including its greeting, after the previous async owner releases it.
      if (mounted.current && (retryHouseSelection || retryAfterBirthday || controlVersion !== animationRef.current.controlVersion())) retryAdvance(value => value + 1)
    }
  }, [dispatch, finishTransition, updateTransition, cancelWarmup, resolveVisual])

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
    if (transitionRef.current) diagnosticRef.current?.flag('transition-media-error', { queueId: queueItem?.queueId, state: diagnostic?.category })
    cancelWarmup()
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
  }, [dispatch, handleLoadNext, handleStatus, player._lastReplayTime, queueItem, updateTransition, cancelWarmup])

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
  }, [handleLoadNext, player.isPlaying, player.queueId, player._isPlayingNext, player._isBetweenTracks, player._authority, animation.busy, animation.blocked, advanceRevision])

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

  const musicBlocked = animation.blocked && !karaokeCues.allowsMusic(player.queueId)
  const preroll = transition?.phase === 'warmup' || transition?.phase === 'preroll' ? transition.phase : undefined
  const foregroundScene = birthday.busy || (!!transition && !preroll) || !!greetings.scene || !!animation.scene || musicBlocked || animation.busy
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
  const selectedTracks = selectPresentation({ queue: rawQueue, player, preferences: roomPrefs?.queue, loading: transition?.phase === 'loading' || handingOff })
  const startTurn = animation.snapshot?.karaokeTurn
  const heldTrack = startTurn ? rawQueue.entities[startTurn.queueId] : null
  const presentedTracks = heldTrack && heldTrack.isOptimistic !== true ? { ...selectedTracks, incoming: heldTrack } : selectedTracks
  const preparingItem = preparingQueueId === null ? undefined : rawQueue.entities[preparingQueueId]
  const preparedYouTube = preparingItem && preparingItem.isOptimistic !== true
    && preparingItem.source === 'YOUTUBE' && preparingItem.status === 'APPROVED' && preparingItem.externalId
    ? { mediaKey: preparingItem.queueId, videoId: preparingItem.externalId }
    : null
  let phase: string
  if (player._authority === 'PENDING') phase = 'Conectando el reproductor…'
  else if (player._authority === 'DENIED') phase = 'Esperando a que se libere la sala.'
  else if (player.isErrored) phase = 'Error'
  else if (transition) phase = { warmup: 'Canción', preroll: 'Intro', intro: 'Intro', voice: 'Voz', waiting: 'Esperando inicio de karaoke', loading: 'Cargando', handoff: 'Iniciando canción', exiting: 'Fundido' }[transition.phase]
  else if (greetings.scene || animation.scene) phase = 'Voz'
  else if (musicBlocked || animation.busy || player._isBetweenTracks) phase = 'Preparando'
  else if (player.isAtQueueEnd || !queueItem) phase = 'Ambiente / espera'
  else phase = player.isPlaying ? 'Canción' : 'Pausa'
  const audioStatus = (animation.snapshot?.prefs.enabled || animation.snapshot?.greetingVoiceEnabled || !!startTurn) && !animation.unlocked
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
        isPlaying={player.isPlaying && !birthday.busy && !(startTurn && startTurn.queueId === queueItem?.queueId && startTurn.phase !== 'released')}
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
        isPlaying={player.isPlaying && !birthday.busy && !(startTurn && startTurn.queueId === queueItem?.queueId && startTurn.phase !== 'released')}
        isVisible={!!queueItem && !player.isErrored && !player.isAtQueueEnd && !player._isBetweenTracks && !animation.busy && !musicBlocked
          && !(queueItem.source === 'YOUTUBE' && transition && !preroll && !handingOff)}
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
        onProgress={handleProgress}
        onStatus={handleStatus}
        rgTrackGain={queueItem ? queueItem.rgTrackGain : null}
        rgTrackPeak={queueItem ? queueItem.rgTrackPeak : null}
        source={queueItem?.source}
        visualizer={playerVisualizer}
        volume={transition && !preroll && !handingOff ? 0 : player.volume}
        width={props.width}
        height={props.height}
      />
      {birthday.scene && <BirthdayScene key={birthday.scene.grant.event.id} grant={birthday.scene.grant} phase={birthday.scene.phase} />}
      {(showScene || preroll) && (!birthday.scene || transition) && (
        <PlayerTransitionScene
          background={background}
          playing={!!(transition || animation.scene || greetings.scene || animation.ambientPlaying || player.isPlaying || player._isPlayingNext)}
          sceneId={transition?.id ?? sceneId}
          visibility={preroll}
          onBackgroundReady={process.env.NODE_ENV === 'development' ? onBackgroundReady : undefined}
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
            : foregroundScene || preroll
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
              : startTurn?.phase === 'countdown' ? null : idleOverlay}
          {transition?.phase === 'waiting' && startTurn?.phase === 'waiting' && !presentedTracks.incoming && <div className={styles.karaokeWaiting} role='status'>Prepárate para cantar</div>}
          {startTurn?.phase === 'countdown' && startTurn.endsAt !== null && <KaraokeCountdown seconds={karaokeCountdownSeconds(startTurn.endsAt, animationTime())} />}
          {(startTurn || presentedTracks.incoming?.requestIntent === 'SING') && <KaraokeMascot imageId={animation.snapshot?.karaokeStage?.mascotImageId ?? prefs.playerDisplay.logo.animatedImageId ?? prefs.playerDisplay.logo.staticImageId} fallback={prefs.branding.logoSrc} countdown={startTurn?.phase === 'countdown'} />}
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
