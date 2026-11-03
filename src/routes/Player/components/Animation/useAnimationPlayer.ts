import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureState } from 'redux-optimistic-ui'
import store from 'store/store'
import { useAppSelector } from 'store/hooks'
import socket from 'lib/socket'
import { animationRequest, animationTime, fetchPreparedAnimationClips, syncAnimation } from 'lib/animationApi'
import {
  ANIMATION_CANCEL, ANIMATION_EVENT, ANIMATION_READY, ANIMATION_RESERVE,
  ANIMATION_AUTO, ANIMATION_AMBIENCE, ANIMATION_AMBIENCE_STOP, ANIMATION_AMBIENCE_STARTED,
  animationContext, interventionAssets, type Intervention, type AmbienceGrant, type AnimationSnapshot,
} from 'shared/animation'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY, PLAYER_EMIT_STATUS } from 'shared/actionTypes'
import { playerStatusCancel, playerUpdate } from '../../modules/player'
import AnnouncementAudio from './AnnouncementAudio'
import { hasLocalPlaybackProof } from './playbackFence'

const voiceRequested = (snapshot?: AnimationSnapshot | null) => !!snapshot && (snapshot.prefs.enabled || snapshot.greetingVoiceEnabled === true)

function audioOwnerKey () {
  const state = store.getState()
  const snapshot = state.animation.snapshot
  return socket.connected && state.player._authority === 'GRANTED' && snapshot?.roomId === state.user.roomId
    ? `${state.user.roomId}:${snapshot.playerEpoch}:${socket.id}`
    : null
}

export default function useAnimationPlayer () {
  const snapshot = useAppSelector(state => state.animation.snapshot)
  const needsVoice = voiceRequested(snapshot)
  const authority = useAppSelector(state => state.player._authority)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [needsGesture, setNeedsGesture] = useState(false)
  const [preparingAudio, setPreparingAudio] = useState(false)
  const [preparationRetry, retryPreparation] = useState(0)
  const [availabilityVersion, retryActivation] = useState(0)
  const roomId = useAppSelector(state => state.user.roomId)
  const connected = useAppSelector(state => state.animation.connected)
  const isPlaying = useAppSelector(state => state.player.isPlaying)
  const [, tick] = useState(0)
  const audio = useRef(new AnnouncementAudio())
  const version = useRef(0)
  const running = useRef(false)
  const mounted = useRef(true)
  const attempted = useRef(new Set<string>())
  const grantRef = useRef<Intervention | null>(null)
  const locallySettled = useRef(new Set<string>())
  const ambientRun = useRef<{ grant: AmbienceGrant, completion: Promise<'ENDED' | 'STOPPED'> } | null>(null)
  const ambientStarting = useRef(false)
  const ambientSettled = useRef<Promise<void> | null>(null)
  const ambientRenewing = useRef(false)
  const ambientVersion = useRef(0)
  const ambientRetryAt = useRef(0)
  const ambientCursor = useRef({ clipId: '', offsetMs: 0 })
  const ambientUse = useRef<{ clipId: string, id: string } | null>(null)
  const [ambientPlaying, setAmbientPlaying] = useState(false)
  const preparedOwner = useRef<string | null>(null)
  const preparationVersion = useRef(0)
  const idleAttemptAt = useRef(0)
  const idleSignal = useRef<string | null | undefined>(null)
  const idleTick = Math.floor(animationTime() / 10000)

  const publishReadiness = useCallback(async () => {
    const owner = audioOwnerKey()
    if (!mounted.current || !owner || preparedOwner.current !== owner || !voiceRequested(store.getState().animation.snapshot)) return
    const ready = audio.current.ready
    try {
      await animationRequest(ANIMATION_READY, { audioUnlocked: ready, readyClips: ready ? [...audio.current.buffers.keys()] : [] })
      if (mounted.current && owner === audioOwnerKey()) {
        setUnlocked(ready && audio.current.ready)
        if (audio.current.ready) setNeedsGesture(false)
        if (ready) setError('')
      }
    } catch (error) {
      if (mounted.current && owner === audioOwnerKey()) setError((error as Error).message)
    }
  }, [])

  const resumeAudio = useCallback(() => {
    const owner = audioOwnerKey()
    if (!owner || !mounted.current || !voiceRequested(store.getState().animation.snapshot)) return
    if (audio.current.ready && store.getState().animation.snapshot?.audioUnlocked && preparedOwner.current === owner) return
    // Called synchronously by the local click/keydown, before network requests.
    const resumed = audio.current.resume()
    if (audio.current.ready) setNeedsGesture(false)
    void resumed.then(publishReadiness).catch(() => {
      if (mounted.current && owner === audioOwnerKey()) setNeedsGesture(!audio.current.ready)
    })
  }, [publishReadiness])

  const abort = useCallback(() => {
    ambientUse.current = null
    version.current++
    ambientVersion.current++
    audio.current.stop()
  }, [])

  useEffect(() => {
    mounted.current = true
    const channel = audio.current
    channel.onUnavailable = () => {
      if (!mounted.current) return
      setUnlocked(false)
      retryActivation(value => value + 1)
      if (socket.connected && store.getState().player._authority === 'GRANTED') {
        void animationRequest(ANIMATION_READY, { audioUnlocked: false, readyClips: [] }).catch(() => {})
      }
    }
    channel.onAvailable = () => {
      setNeedsGesture(false)
      void publishReadiness()
    }
    const disconnect = () => {
      abort()
      setUnlocked(false)
      preparedOwner.current = null
    }
    const reconnect = () => {
      // Rejoin the existing authority election even if playback is idle and
      // no periodic media event would otherwise publish a fresh status.
      store.dispatch(playerUpdate({ _authority: 'PENDING' }))
    }
    const commands = (action: { type: string }) => {
      if ([PLAYER_CMD_NEXT, PLAYER_CMD_REPLAY, PLAYER_CMD_PAUSE, PLAYER_CMD_PLAY].includes(action.type)) {
        abort()
        ambientCursor.current = { clipId: '', offsetMs: 0 }
      }
    }
    const watch = store.subscribe(() => {
      const current = store.getState().animation.snapshot
      const player = store.getState().player
      if (!current?.prefs.enabled || !current.prefs.automation || !current.prefs.ambienceEnabled || current.session?.status !== 'OPEN'
        || (player && !player.isAtQueueEnd && player.queueId !== -1)) ambientUse.current = null
      const grant = grantRef.current
      if (current) audio.current.volume(ambientRun.current ? current.prefs.ambienceVolume ?? 0.2 : current.prefs.volume)
      if (current) audio.current.bedVolume(Math.min(current.prefs.ambienceVolume ?? 0.2, current.prefs.volume * 0.4))
      if (grant && (!current?.prefs.enabled || current.prefs.volume === 0
        || current.playerEpoch !== grant.playerEpoch || current.active?.interventionId !== grant.interventionId || current.active?.stopRequestedAt)) audio.current.stop()
      const ambient = ambientRun.current?.grant
      if (ambient && (!current?.prefs.enabled || !current.prefs.automation || !current.prefs.ambienceEnabled || current.prefs.ambienceVolume === 0
        || current.session?.status !== 'OPEN' || current.playerEpoch !== ambient.playerEpoch
        || current.ambience?.id !== ambient.id || (current.active?.status === 'PENDING' && audio.current.buffers.has(current.active.clipChecksum)
          && current.active.durationMs <= (current.voiceBudgetRemainingMs ?? 120000)))) audio.current.stop()
    })
    socket.on('disconnect', disconnect)
    socket.on('connect', reconnect)
    socket.on('action', commands)
    window.addEventListener('pagehide', abort)
    void syncAnimation().catch(() => {})
    const timer = setInterval(() => tick(value => value + 1), 250)
    return () => {
      mounted.current = false
      channel.onUnavailable = null
      channel.onAvailable = null
      abort()
      channel.close()
      watch()
      clearInterval(timer)
      socket.off('disconnect', disconnect)
      socket.off('connect', reconnect)
      socket.off('action', commands)
      window.removeEventListener('pagehide', abort)
    }
  }, [abort, publishReadiness])

  useEffect(() => {
    if (authority !== 'GRANTED') {
      abort()
      setUnlocked(false)
      preparedOwner.current = null
    }
  }, [authority, abort])

  const lastFinishedAt = snapshot?.history[0]?.finishedAt
  useEffect(() => {
    const owner = audioOwnerKey()
    const token = ++preparationVersion.current
    if (!owner || !needsVoice) {
      preparedOwner.current = null
      setUnlocked(false)
      setPreparingAudio(false)
      return
    }
    let alive = true
    setPreparingAudio(true)
    setError('')
    const current = () => alive && mounted.current && token === preparationVersion.current && owner === audioOwnerKey()
    void fetchPreparedAnimationClips().then(async (clips): Promise<void> => {
      if (!current()) return undefined
      await audio.current.prepare(clips)
      if (current()) {
        preparedOwner.current = owner
        await publishReadiness()
      }
      return undefined
    }).catch((error) => { if (current()) setError(error.message) }).finally(() => {
      if (current()) setPreparingAudio(false)
    })
    return () => {
      alive = false
    }
  }, [snapshot?.catalogVersion, snapshot?.active?.interventionId, snapshot?.ambience?.clip.id, lastFinishedAt, snapshot?.prefs.profile, snapshot?.playerEpoch, needsVoice, authority, roomId, connected, preparationRetry, publishReadiness])

  useEffect(() => {
    if (needsVoice && authority === 'GRANTED' && connected) resumeAudio()
  }, [needsVoice, snapshot?.playerEpoch, authority, roomId, connected, isPlaying, availabilityVersion, resumeAudio])

  useEffect(() => {
    const gesture = (event: Event) => {
      if (event.isTrusted) resumeAudio()
    }
    const foreground = () => {
      if (document.visibilityState === 'visible' && voiceRequested(store.getState().animation.snapshot)) resumeAudio()
    }
    document.addEventListener('click', gesture, true)
    document.addEventListener('keydown', gesture, true)
    document.addEventListener('visibilitychange', foreground)
    return () => {
      document.removeEventListener('click', gesture, true)
      document.removeEventListener('keydown', gesture, true)
      document.removeEventListener('visibilitychange', foreground)
    }
  }, [resumeAudio])

  const unlock = () => {
    resumeAudio()
    if (error) retryPreparation(value => value + 1)
  }

  const waitingForVoiceBudget = snapshot?.active?.status === 'PENDING' && snapshot.active.durationMs > (snapshot.voiceBudgetRemainingMs ?? 120000)
  useEffect(() => {
    if (waitingForVoiceBudget && socket.connected) {
      // Refresh the rolling budget as history ages, even when no other room
      // event would push a new snapshot. This never authorizes playback itself.
      void syncAnimation().catch(() => {})
    }
  }, [waitingForVoiceBudget, idleTick])

  const stopAmbience = useCallback(async () => {
    if (!ambientRun.current && !ambientStarting.current) return
    ambientVersion.current++
    audio.current.stop()
    await ambientSettled.current
  }, [])

  const startAmbience = useCallback(async () => {
    const state = store.getState()
    const current = state.animation.snapshot
    if (running.current || ambientRun.current || ambientStarting.current || Date.now() < ambientRetryAt.current || !socket.connected || !audio.current.ready
      || state.player._authority !== 'GRANTED' || !current?.prefs.enabled || !current.prefs.automation || !current.prefs.ambienceEnabled
      || current.session?.status !== 'OPEN' || state.player.isErrored
      || !(state.player.isAtQueueEnd || state.player.queueId === -1)
      || (current.active && (current.active.status !== 'PENDING' || (audio.current.buffers.has(current.active.clipChecksum)
        && current.active.durationMs <= (current.voiceBudgetRemainingMs ?? 120000))))) return
    ambientStarting.current = true
    let settle: () => void = () => {}
    ambientSettled.current = new Promise<void>((resolve) => {
      settle = resolve
    })
    ambientRetryAt.current = Date.now() + 1000
    const generation = ambientVersion.current
    let grant: AmbienceGrant | undefined
    let startedAt = 0
    try {
      const cursor = ambientUse.current ? ambientCursor.current : { clipId: '', offsetMs: 0 }
      const reply = await animationRequest(ANIMATION_AMBIENCE, { playerEpoch: current.playerEpoch, ...cursor }, 1000)
      grant = reply.ambience
      const fresh = store.getState()
      if (!grant) return
      if (!mounted.current || ambientVersion.current !== generation || !socket.connected || running.current
        || fresh.player._authority !== 'GRANTED' || fresh.player.isErrored || !(fresh.player.isAtQueueEnd || fresh.player.queueId === -1)
        || !audio.current.buffers.has(grant.clip.checksum) || animationTime() + grant.durationMs > grant.until) return
      startedAt = performance.now()
      const completion = audio.current.play(grant.clip.checksum, current.prefs.ambienceVolume ?? 0.2,
        { offsetMs: grant.offsetMs, durationMs: grant.until - animationTime() - 500, renewable: true, loop: grant.clip.loop !== false && !grant.rotate })
      ambientRun.current = { grant, completion }
      if (ambientUse.current?.clipId !== grant.clip.id) ambientUse.current = { clipId: grant.clip.id, id: crypto.randomUUID() }
      try {
        await animationRequest(ANIMATION_AMBIENCE_STARTED, { id: grant.id, runId: ambientUse.current.id }, 1000)
      } catch { audio.current.stop() }
      setAmbientPlaying(true)
      const outcome = await completion
      // An idle announcement probe can briefly stop ambience without emitting
      // anything. Keep the same usage episode until real speech/music or disable.
      const decodedMs = Math.round(audio.current.buffers.get(grant.clip.checksum)!.duration * 1000)
      const length = Math.min(grant.clip.durationMs, decodedMs)
      const endedGrant = ambientRun.current?.grant ?? grant
      ambientCursor.current = { clipId: grant.clip.id, offsetMs: outcome === 'ENDED' && (endedGrant.rotate || grant.clip.loop === false)
        ? grant.clip.durationMs
        : (grant.offsetMs + performance.now() - startedAt) % length }
    } catch (error) {
      if (mounted.current) setError((error as Error).message)
    } finally {
      if (grant && socket.connected) await animationRequest(ANIMATION_AMBIENCE_STOP, { id: grant.id }, 1000).catch(() => {})
      ambientRun.current = null
      ambientStarting.current = false
      if (mounted.current) setAmbientPlaying(false)
      settle()
      ambientSettled.current = null
    }
  }, [])

  const ambientTick = Math.floor(animationTime() / 1000)
  useEffect(() => {
    const run = ambientRun.current
    if (!run || ambientRenewing.current || run.grant.until - animationTime() > 3000) return
    ambientRenewing.current = true
    void animationRequest(ANIMATION_AMBIENCE, { playerEpoch: run.grant.playerEpoch, renewId: run.grant.id }, 1000).then((reply): void => {
      if (ambientRun.current !== run) return undefined
      if (!reply.ambience || !audio.current.renewAmbience(reply.ambience.until - animationTime() - 500, reply.ambience.clip.loop !== false && !reply.ambience.rotate)) audio.current.stop()
      else run.grant = reply.ambience
      return undefined
    }).catch(() => { if (ambientRun.current === run) audio.current.stop() }).finally(() => {
      ambientRenewing.current = false
    })
  }, [ambientPlaying, ambientTick])

  const attempt = useCallback(async (boundary: 'ended' | 'idle' | 'start', sourceQueueId: number | null, expectedNextQueueId: number | null) => {
    const state = store.getState()
    const current = state.animation.snapshot
    const active = current?.active
    const automatic = !active && current?.prefs.automation && current.session && !state.player._isReplayPlayback
    if (running.current || !socket.connected || state.player._authority !== 'GRANTED' || !current?.prefs.enabled
      || current.prefs.volume <= 0 || (!automatic && active?.status !== 'PENDING')
      || !audio.current.ready || (active && !audio.current.buffers.has(active.clipChecksum))
      || (active && active.durationMs > (current.voiceBudgetRemainingMs ?? 120000))) return
    if (automatic && boundary === 'idle' && Date.now() - idleAttemptAt.current < 10000 && idleSignal.current === current.pendingEventJSON) return
    if (automatic && boundary === 'idle') {
      idleAttemptAt.current = Date.now()
      idleSignal.current = current.pendingEventJSON
    }
    running.current = true
    setBusy(true)
    const generation = version.current
    let began = 0
    let grant: Intervention | undefined
    let started = false
    try {
      if (automatic && boundary === 'idle') {
        const room = state.rooms.entities[state.user.roomId]
        const probe = await animationRequest(ANIMATION_AUTO, {
          probeOnly: true, playerEpoch: current.playerEpoch, controlVersion: current.controlVersion,
          contextKey: animationContext(ensureState(state.queue), room?.prefs?.queue), transitionId: crypto.randomUUID(),
          boundary, sourceQueueId, expectedNextQueueId, replay: state.player._isReplayPlayback,
        }, 1000)
        if (!probe.eligible) return
      }
      began = performance.now()
      await stopAmbience()
      // Flush the boundary before reserving. Periodic status is throttled and
      // may still describe the preceding (now ended) song as occupying the room.
      store.dispatch(playerStatusCancel())
      const playerStatus = Object.fromEntries(Object.entries(state.player).filter(([key]) => !key.startsWith('_')))
      await animationRequest(PLAYER_EMIT_STATUS, { ...playerStatus, visualizer: state.playerVisualizer }, 1000)
      const refreshed = store.getState()
      const room = refreshed.rooms.entities[refreshed.user.roomId]
      const contextKey = animationContext(ensureState(refreshed.queue), room?.prefs?.queue)
      const remaining = 1000 - (performance.now() - began)
      if (remaining <= 0 || generation !== version.current) throw new Error('La pausa cambió antes de reservar')
      const reply = await animationRequest(automatic ? ANIMATION_AUTO : ANIMATION_RESERVE, {
        interventionId: active?.interventionId, playerEpoch: current.playerEpoch, controlVersion: current.controlVersion,
        contextKey, transitionId: crypto.randomUUID(), boundary, sourceQueueId, expectedNextQueueId, replay: state.player._isReplayPlayback,
      }, Math.floor(remaining))
      grant = reply.grant
      if (!grant) return
      grantRef.current = grant
      const latest = store.getState()
      const latestSnapshot = latest.animation.snapshot
      const latestContext = animationContext(ensureState(latest.queue), latest.rooms.entities[latest.user.roomId]?.prefs?.queue)
      const storageKey = `animation-started:${grant.interventionId}`
      if (!mounted.current || generation !== version.current || performance.now() - began >= 1000
        || !socket.connected || latest.player._authority !== 'GRANTED' || !latestSnapshot?.prefs.enabled
        || latestSnapshot.prefs.volume <= 0 || latestSnapshot.active?.stopRequestedAt
        || latestSnapshot.playerEpoch !== grant.playerEpoch || latestSnapshot.active?.interventionId !== grant.interventionId
        || latestContext !== grant.contextKey || animationTime() >= grant.startBefore!
        || attempted.current.has(grant.interventionId) || sessionStorage.getItem(storageKey)) {
        await animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: 'NOT_STARTED' })
        return
      }
      sessionStorage.setItem(storageKey, '1')
      attempted.current.add(grant.interventionId)
      const assets = interventionAssets(grant)
      ambientUse.current = null
      const completion = audio.current.play(assets[0].checksum, latestSnapshot.prefs.volume)
      started = true
      setText(assets.length === 1 || assets[0].kind === 'voice' ? grant.displayText : '')
      // The audio has actually been scheduled on a running context, not merely reserved.
      try {
        await animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: 'STARTED' }, 1000)
      } catch { audio.current.stop() }
      let outcome = await completion
      for (const asset of assets.slice(1)) {
        const latest = store.getState().animation.snapshot
        if (outcome !== 'ENDED' || version.current !== generation || !socket.connected || latest?.active?.stopRequestedAt || latest?.active?.interventionId !== grant.interventionId) {
          outcome = 'STOPPED'
          break
        }
        const effectCompletion = audio.current.play(asset.checksum, latest.prefs.volume)
        if (asset.kind === 'voice') setText(grant.displayText)
        try {
          await animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: 'ASSET_STARTED', clipId: asset.id }, 1000)
        } catch { audio.current.stop() }
        outcome = await effectCompletion
      }
      setText('')
      await animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: outcome })
    } catch (error) {
      audio.current.stop()
      if (mounted.current) setError((error as Error).message)
      if (grant && !started && socket.connected) {
        void animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: 'NOT_STARTED' }).catch(() => {})
      } else if (!grant && active && socket.connected) {
        // A lost reservation response may have been persisted. Revoke this ID,
        // never replay the command on reconnect or with a fresh ID.
        void animationRequest(ANIMATION_CANCEL, { interventionId: active.interventionId }).catch(() => {})
      }
    } finally {
      if (grant || active) locallySettled.current.add((grant ?? active)!.interventionId)
      grantRef.current = null
      running.current = false
      if (mounted.current) {
        setBusy(false)
        setText('')
      }
    }
  }, [stopAmbience])

  // This tab knows it has stopped (or never started). A successor does not,
  // and must keep respecting the persisted fence until confirmation/expiry.
  const isBlocked = useCallback(() => {
    const current = store.getState().animation.snapshot
    const fenced = current?.history.find(item => item.leaseUntil === current.blockedUntil)
    const locallySafe = hasLocalPlaybackProof(fenced, socket.id, locallySettled.current)
    const foreignAmbience = !!current?.ambience && current.ambience.ownerSocketId !== socket.id && current.ambience.until > animationTime()
    return (!!current && current.blockedUntil > animationTime() && !locallySafe) || foreignAmbience
  }, [])
  const blocked = isBlocked()
  const markStopped = useCallback((id: string) => {
    locallySettled.current.add(id)
  }, [])
  return { busy, blocked, text, error, unlocked, needsGesture, preparingAudio, unlock, attempt, abort, snapshot, stopAmbience, startAmbience, ambientPlaying, controlVersion: () => version.current,
    idleTick, ambientTick, channel: audio.current, refreshReadiness: publishReadiness, markStopped, isBlocked }
}
