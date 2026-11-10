import { useCallback, useEffect, useRef, useState } from 'react'
import store from 'store/store'
import { useAppSelector } from 'store/hooks'
import socket from 'lib/socket'
import { greetingRequest } from 'components/Greetings/api'
import { greetingDuration, type Greeting, type GreetingAsset, type GreetingGrant, type GreetingPerformer } from 'shared/greetings'
import { ANIMATION_EVENT, ambienceBedVolume } from 'shared/animation'
import { animationRequest, animationTime } from 'lib/animationApi'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY, PLAYER_EMIT_STATUS } from 'shared/actionTypes'
import { playerStatusCancel } from '../../modules/player'
import { getPlaybackQueue } from 'routes/Queue/selectors/getRoundRobinQueue'
import GreetingCommitGate from './GreetingCommitGate'
import type AnnouncementAudio from './AnnouncementAudio'
import { ensureState } from 'redux-optimistic-ui'
import { tracePlayback } from 'lib/playbackTrace'

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)))
function upcoming () {
  const state = store.getState()
  const ordered = getPlaybackQueue(state)
  return ordered.result.slice(ordered.result.indexOf(state.player.queueId) + 1).find(id => ordered.entities[id].status === 'APPROVED')
}

export default function useGreetingPlayer (channel: AnnouncementAudio, refreshReadiness: () => Promise<void>, markStopped: (id: string) => void) {
  const [active, setActive] = useState<Greeting | null>(null)
  const [intro, setIntro] = useState('')
  const [scene, setScene] = useState<GreetingGrant | null>(null)
  const [performer, setPerformer] = useState<GreetingPerformer | null>(null)
  const [error, setError] = useState('')
  const version = useRef(0)
  const mounted = useRef(false)
  const running = useRef(false)
  const checkActive = useRef<(() => void) | null>(null)
  const commit = useRef(new GreetingCommitGate())
  const roomId = useAppSelector(state => state.user.roomId)
  const authority = useAppSelector(state => state.player._authority)
  const queue = useAppSelector(state => state.queue)
  const queueId = useAppSelector(state => state.player.queueId)
  const enabled = useAppSelector(state => !!(state.animation.snapshot?.greetingVoiceEnabled || state.animation.snapshot?.karaokeCallsEnabled || state.animation.snapshot?.listeningPresentationsEnabled))
  const confirmMounted = useCallback((node: HTMLElement | null) => {
    if (node?.isConnected) commit.current.confirm(Number(node.dataset.greetingId))
  }, [])

  useEffect(() => {
    mounted.current = true
    const gate = commit.current
    const stop = () => {
      version.current++
      gate.cancel()
      if (running.current) channel.stop()
      if (mounted.current) {
        setActive(null)
        setIntro('')
        setScene(null)
      }
    }
    const command = (action: { type: string }) => {
      if ([PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY].includes(action.type)) stop()
    }
    const unsubscribe = store.subscribe(() => checkActive.current?.())
    socket.on('disconnect', stop)
    socket.on('action', command)
    window.addEventListener('pagehide', stop)
    return () => {
      mounted.current = false
      stop()
      unsubscribe()
      socket.off('disconnect', stop)
      socket.off('action', command)
      window.removeEventListener('pagehide', stop)
    }
  }, [channel])

  useEffect(() => {
    if (!enabled || authority !== 'GRANTED') return
    let alive = true
    let loading = false
    const preload = async () => {
      if (loading || running.current || !socket.connected) return
      const next = upcoming()
      if (!next) return
      loading = true
      try {
        const { preparation } = await greetingRequest('prepare', { queueId: next })
        if (!alive || running.current || upcoming() !== next) return
        await channel.prepareGreetingAssets(preparation?.assets ?? [], () => alive && upcoming() === next)
        if (alive) await refreshReadiness()
      } catch { /* Missing or late preparation falls back to visual delivery. */ } finally { loading = false }
    }
    void preload()
    const timer = setInterval(() => void preload(), 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [enabled, authority, roomId, queue, queueId, channel, refreshReadiness])

  const attempt = useCallback(async (expectedQueueId: number, remainingMs = 25000): Promise<boolean> => {
    if (running.current) return false
    const generation = version.current
    let grant: GreetingGrant | undefined
    let deadline = performance.now() + Math.max(0, Math.min(25000, remainingMs))
    let done = false
    let interrupted = false
    let scheduled = false
    let visualStarted = false
    let rendered = false
    let voiceCompleted = false
    let readUntil = 0
    let visualSince = 0
    const ownsBed = !channel.hasBed
    const valid = () => {
      const state = store.getState()
      const item = ensureState(state.queue).entities[expectedQueueId]
      const sameCall = !grant?.transition?.call || (item && 'userDisplayName' in item && item.userDisplayName === grant.performer.name
        && item.title === grant.performer.title && (item.tableLabelSnapshot ?? null) === grant.performer.tableLabel && item.requestIntent === grant.performer.requestIntent)
      return mounted.current && !interrupted && generation === version.current && socket.connected && state.player._authority === 'GRANTED'
        && (state.player.isPlaying || state.player._isPlayingNext)
        && state.rooms.entities[state.user.roomId]?.status !== 'closed' && sameCall && performance.now() < deadline && upcoming() === expectedQueueId
    }
    const voiceValid = () => {
      const current = store.getState().animation.snapshot
      const intervention = grant?.transition?.intervention
      const call = grant?.transition?.call
      let allowed = current?.greetingVoiceEnabled
      if (call && !call.kind) allowed = current?.karaokeCallsEnabled && current.karaokeCallsRevision === call.revision
      if (call?.kind === 'listening') allowed = current?.prefs.enabled && (scheduled || (current.listeningPresentationsEnabled && current.karaokeCallsRevision === call.revision))
      if (grant?.transition?.assets.some(asset => asset.role === 'greeting')) allowed = allowed && current?.greetingVoiceEnabled
      return valid() && channel.ready && !!intervention && allowed && current!.prefs.volume > 0
        && current!.playerEpoch === intervention.playerEpoch && current!.active?.interventionId === intervention.interventionId && !current!.active.stopRequestedAt
    }
    const audioEvent = (event: 'STARTED' | 'ASSET_STARTED' | 'ENDED' | 'STOPPED' | 'NOT_STARTED', clipId?: string) => {
      const intervention = grant!.transition!.intervention
      return animationRequest(ANIMATION_EVENT, { interventionId: intervention.interventionId, playerEpoch: intervention.playerEpoch, event, clipId }, 1000)
    }
    let bedStarted = false
    const play = async (asset: GreetingAsset, first: boolean, onStarted?: () => Promise<void>) => {
      const duration = (channel.buffers.get(asset.checksum)?.duration ?? Infinity) * 1000
      if (!voiceValid() || duration + 250 > deadline - performance.now()) throw new Error('La voz no puede comenzar dentro de esta pausa')
      if (first && animationTime() >= grant!.transition!.intervention.startBefore!) throw new Error('La autorización de inicio venció')
      const current = store.getState().animation.snapshot!
      const completion = channel.play(asset.checksum, current.prefs.volume)
      scheduled = true
      const bed = grant!.transition!.assets.find(item => item.role === 'bed')
      if (first && bed && ownsBed) {
        try {
          void channel.playBed(bed.checksum, ambienceBedVolume(current.prefs), deadline - performance.now() - 100, bed.loop !== false)
          bedStarted = true
        } catch { /* Voice remains usable without an optional background bed. */ }
      }
      await audioEvent(first ? 'STARTED' : 'ASSET_STARTED', first ? undefined : asset.id)
      if (first && bedStarted) await audioEvent('ASSET_STARTED', bed!.id)
      await onStarted?.()
      if (await completion !== 'ENDED') throw new Error('La voz fue interrumpida')
    }
    const show = async (voiced: boolean) => {
      const item = grant!.items[0]
      if (!item) return
      setIntro('')
      if (!rendered) {
        const committed = commit.current.wait(item.greetingId)
        setActive(item)
        if (!await committed || !valid()) throw new Error('No se pudo preparar la tarjeta del saludo')
        rendered = true
      }
      await greetingRequest('start', { turnKey: grant!.turnKey, greetingId: item.greetingId, voiced })
      visualStarted = true
      visualSince = performance.now()
      readUntil = visualSince + (voiced ? grant!.displayMs : greetingDuration(item))
    }
    try {
      if (!valid()) return false
      running.current = true
      setError('')
      store.dispatch(playerStatusCancel())
      const state = store.getState()
      const status = Object.fromEntries(Object.entries(state.player).filter(([key]) => !key.startsWith('_')))
      const flush = await socket.timeout(1500).emitWithAck('action', { type: PLAYER_EMIT_STATUS, payload: { ...status, visualizer: state.playerVisualizer } })
      if (flush.error || !valid()) return false
      if (enabled && !channel.ready) {
        // The trusted Play gesture may still be resuming the already-preloaded
        // context. Bound this handshake; never wait for TTS or force a new gesture.
        await Promise.race([channel.resume().catch(() => {}), delay(400)])
      }
      if (channel.ready) await refreshReadiness()
      if (!valid()) return false
      // A completed server job is not proof that this browser has decoded it.
      // Join in-flight preloading before reserving, inside the existing deadline.
      if (enabled && channel.ready) {
        const { preparation } = await greetingRequest('prepare', { queueId: expectedQueueId })
        if (!valid()) return false
        const voiceMs = preparation?.call?.assets.find(asset => asset.role === 'call')?.durationMs ?? 3000
        const waitMs = Math.max(0, Math.min(4000, deadline - performance.now() - voiceMs - 2250))
        let preparing = true
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          if (waitMs > 0) await Promise.race([
            channel.prepareGreetingAssets(preparation?.assets ?? [], () => preparing && valid(), true),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs) }),
          ])
        } finally {
          preparing = false
          clearTimeout(timer)
        }
        tracePlayback('turn-audio-prepared', { roomId, queueId: expectedQueueId, remainingMs: Math.max(0, deadline - performance.now()) })
      }
      if (!valid()) return false
      const reply = await greetingRequest('reserve', { queueId: expectedQueueId, audioReady: channel.ready, readyClips: channel.readyChecksums, remainingMs: Math.max(0, deadline - performance.now()) })
      if (!reply.grant) return false
      grant = reply.grant
      setScene(grant)
      deadline = Math.min(deadline, performance.now() + Math.max(0, Math.min(25000, grant.until - animationTime())))
      setPerformer(grant.performer)
      checkActive.current = () => {
        if (!valid() || (scheduled && !voiceValid())) channel.stop()
      }
      const monitor = async () => {
        while (!done && valid()) {
          await delay(300)
          if (done || !valid()) break
          if (!grant!.items.length) continue
          const fresh = (await greetingRequest('read')).payload!
          if (done) break
          const item = fresh.items.find(item => item.greetingId === grant!.items[0].greetingId)
          if (fresh.paused || !item || !['RESERVED', 'DISPLAYING'].includes(item.status)) {
            interrupted = true
            channel.stop()
            commit.current.cancel()
            break
          }
        }
        if (!done && !valid()) channel.stop()
      }
      void monitor().catch(() => {
        if (!done) {
          interrupted = true
          channel.stop()
          commit.current.cancel()
        }
      })

      if (grant.transition) {
        try {
          const intervention = grant.transition.intervention
          const key = `greeting-started:${intervention.interventionId}`
          if (sessionStorage.getItem(key)) throw new Error('Esta lectura ya se inició')
          sessionStorage.setItem(key, '1')
          const greeting = grant.transition.assets.find(asset => asset.role === 'greeting')
          const foreground = grant.transition.assets.filter(asset => asset.role !== 'bed')
          for (const [index, asset] of foreground.entries()) {
            if (asset.role === 'intro') setIntro(asset.displayText)
            if ((asset.role === 'call' && !greeting) || asset.role === 'greeting') await show(!!greeting)
            const onStarted = asset.role === 'greeting'
              ? async () => { await greetingRequest('audioStarted', { turnKey: grant!.turnKey, greetingId: grant!.items[0].greetingId }) }
              : undefined
            await play(asset, index === 0, onStarted)
          }
          voiceCompleted = true
          if (greeting) void greetingRequest('audioEnded', { turnKey: grant.turnKey, greetingId: grant.items[0].greetingId }).catch(() => {})
        } catch (error) {
          channel.stopForeground()
          if (ownsBed) await channel.stopBed(30)
          if (!valid()) throw error
          if (grant.items.length) {
            if (!visualStarted) await show(false)
            await greetingRequest('audioFailed', { turnKey: grant.turnKey, greetingId: grant.items[0].greetingId, reason: (error as Error).message })
            readUntil = visualSince + greetingDuration(grant.items[0])
          }
          setError('La voz no pudo completarse. La información se conserva en pantalla.')
        }
      } else await show(false)
      while (valid() && performance.now() < readUntil) await delay(Math.min(200, readUntil - performance.now()))
      if (valid()) {
        if (ownsBed) await channel.stopBed(250)
        if (valid() && grant.items.length) void greetingRequest('end', { turnKey: grant.turnKey, greetingId: grant.items[0].greetingId }).catch(() => {})
      }
    } catch (error) {
      if (mounted.current && generation === version.current && !interrupted) setError(`Saludo no completado: ${(error as Error).message}. La música continúa.`)
    } finally {
      done = true
      checkActive.current = null
      commit.current.cancel()
      if (grant?.transition) {
        channel.stopForeground()
        if (ownsBed) await channel.stopBed(30)
        markStopped(grant.transition.intervention.interventionId)
        if (socket.connected) await audioEvent(valid() && voiceCompleted ? 'ENDED' : scheduled ? 'STOPPED' : 'NOT_STARTED').catch(() => {})
      }
      if (grant && socket.connected) await greetingRequest('finish', { turnKey: grant.turnKey }).catch(() => {})
      running.current = false
      if (mounted.current) {
        setActive(null)
        setIntro('')
        setPerformer(null)
        setScene(null)
      }
    }
    return !!grant
  }, [channel, markStopped, refreshReadiness, enabled, roomId])
  return { active, intro, scene, performer, error, attempt, confirmMounted, busy: running.current }
}
