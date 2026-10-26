import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureState } from 'redux-optimistic-ui'
import store from 'store/store'
import { useAppSelector } from 'store/hooks'
import socket from 'lib/socket'
import { animationRequest, animationTime, fetchAnimationClips, syncAnimation } from 'lib/animationApi'
import {
  ANIMATION_CANCEL, ANIMATION_EVENT, ANIMATION_READY, ANIMATION_RESERVE,
  animationContext, type Intervention,
} from 'shared/animation'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY, PLAYER_EMIT_STATUS } from 'shared/actionTypes'
import { playerStatusCancel, playerUpdate } from '../../modules/player'
import AnnouncementAudio from './AnnouncementAudio'
import { hasLocalPlaybackProof } from './playbackFence'

export default function useAnimationPlayer () {
  const snapshot = useAppSelector(state => state.animation.snapshot)
  const authority = useAppSelector(state => state.player._authority)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [, tick] = useState(0)
  const audio = useRef(new AnnouncementAudio())
  const version = useRef(0)
  const running = useRef(false)
  const mounted = useRef(true)
  const attempted = useRef(new Set<string>())
  const grantRef = useRef<Intervention | null>(null)
  const locallySettled = useRef(new Set<string>())

  const abort = useCallback(() => {
    version.current++
    audio.current.stop()
  }, [])

  useEffect(() => {
    mounted.current = true
    const channel = audio.current
    channel.onUnavailable = () => {
      if (!mounted.current) return
      setUnlocked(false)
      if (socket.connected && store.getState().player._authority === 'GRANTED') {
        void animationRequest(ANIMATION_READY, { audioUnlocked: false, readyClips: [] }).catch(() => {})
      }
    }
    const disconnect = () => {
      abort()
      setUnlocked(false)
    }
    const reconnect = () => {
      // Rejoin the existing authority election even if playback is idle and
      // no periodic media event would otherwise publish a fresh status.
      store.dispatch(playerUpdate({ _authority: 'PENDING' }))
    }
    const commands = (action: { type: string }) => {
      if ([PLAYER_CMD_NEXT, PLAYER_CMD_REPLAY, PLAYER_CMD_PAUSE, PLAYER_CMD_PLAY].includes(action.type)) abort()
    }
    const watch = store.subscribe(() => {
      const current = store.getState().animation.snapshot
      const grant = grantRef.current
      if (current) audio.current.volume(current.prefs.volume)
      if (grant && (!current?.prefs.enabled || current.microphoneOccupied || current.prefs.volume === 0
        || current.playerEpoch !== grant.playerEpoch || current.active?.interventionId !== grant.interventionId || current.active?.stopRequestedAt)) audio.current.stop()
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
      abort()
      channel.close()
      watch()
      clearInterval(timer)
      socket.off('disconnect', disconnect)
      socket.off('connect', reconnect)
      socket.off('action', commands)
      window.removeEventListener('pagehide', abort)
    }
  }, [abort])

  useEffect(() => {
    if (authority !== 'GRANTED') {
      abort()
      setUnlocked(false)
    }
  }, [authority, abort])

  const unlock = async () => {
    setError('')
    try {
      // Resume within the user gesture; fetching the manifest comes afterwards.
      await audio.current.unlock([])
      const clips = await fetchAnimationClips()
      const hashes = await audio.current.unlock(clips)
      if (!mounted.current) return
      await syncAnimation()
      await animationRequest(ANIMATION_READY, { audioUnlocked: true, readyClips: hashes })
      setUnlocked(true)
    } catch (error) { if (mounted.current) setError((error as Error).message) }
  }

  const attempt = useCallback(async (boundary: 'ended' | 'idle', sourceQueueId: number | null, expectedNextQueueId: number | null) => {
    const state = store.getState()
    const current = state.animation.snapshot
    const active = current?.active
    if (running.current || !socket.connected || state.player._authority !== 'GRANTED' || !current?.prefs.enabled
      || current.microphoneOccupied || current.prefs.volume <= 0 || active?.status !== 'PENDING'
      || !audio.current.ready || !audio.current.buffers.has(active.clipChecksum)) return
    running.current = true
    setBusy(true)
    const generation = version.current
    const began = performance.now()
    let grant: Intervention | undefined
    let started = false
    try {
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
      const reply = await animationRequest(ANIMATION_RESERVE, {
        interventionId: active.interventionId, playerEpoch: current.playerEpoch, controlVersion: current.controlVersion,
        contextKey, transitionId: crypto.randomUUID(), boundary, sourceQueueId, expectedNextQueueId,
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
        || latestSnapshot.microphoneOccupied || latestSnapshot.prefs.volume <= 0 || latestSnapshot.active?.stopRequestedAt
        || latestSnapshot.playerEpoch !== grant.playerEpoch || latestSnapshot.active?.interventionId !== grant.interventionId
        || latestContext !== grant.contextKey || animationTime() >= grant.startBefore!
        || attempted.current.has(grant.interventionId) || sessionStorage.getItem(storageKey)) {
        await animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: 'NOT_STARTED' })
        return
      }
      sessionStorage.setItem(storageKey, '1')
      attempted.current.add(grant.interventionId)
      const completion = audio.current.play(grant.clipChecksum, latestSnapshot.prefs.volume)
      started = true
      setText(grant.displayText)
      // The audio has actually been scheduled on a running context, not merely reserved.
      try {
        await animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: 'STARTED' }, 1000)
      } catch { audio.current.stop() }
      const outcome = await completion
      setText('')
      await animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: outcome })
    } catch (error) {
      audio.current.stop()
      if (mounted.current) setError((error as Error).message)
      if (grant && !started && socket.connected) {
        void animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: 'NOT_STARTED' }).catch(() => {})
      } else if (!grant && socket.connected) {
        // A lost reservation response may have been persisted. Revoke this ID,
        // never replay the command on reconnect or with a fresh ID.
        void animationRequest(ANIMATION_CANCEL, { interventionId: active.interventionId }).catch(() => {})
      }
    } finally {
      locallySettled.current.add(active.interventionId)
      grantRef.current = null
      running.current = false
      if (mounted.current) {
        setBusy(false)
        setText('')
      }
    }
  }, [])

  // This tab knows it has stopped (or never started). A successor does not,
  // and must keep respecting the persisted fence until confirmation/expiry.
  const fenced = snapshot?.history.find(item => item.leaseUntil === snapshot.blockedUntil)
  const locallySafe = hasLocalPlaybackProof(fenced, socket.id, locallySettled.current)
  const blocked = !!snapshot && snapshot.blockedUntil > animationTime() && !locallySafe
  return { busy, blocked, text, error, unlocked, unlock, attempt, abort, snapshot }
}
