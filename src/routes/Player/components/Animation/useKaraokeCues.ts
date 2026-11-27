import { useCallback, useEffect, useRef } from 'react'
import store from 'store/store'
import socket from 'lib/socket'
import { animationPlaybackEvent, animationRequest, animationTime } from 'lib/animationApi'
import { ANIMATION_EVENT, type Intervention } from 'shared/animation'
import { KARAOKE_CUE, karaokeCountdownTail, karaokeCueSegment, type KaraokeCueClip, type KaraokeCueContext } from 'shared/karaokeStage'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY, PLAYER_EMIT_STATUS } from 'shared/actionTypes'
import type AnnouncementAudio from './AnnouncementAudio'
import { tracePlayback } from 'lib/playbackTrace'
import { ensureState } from 'redux-optimistic-ui'

export default function useKaraokeCues (channel: AnnouncementAudio, refreshReadiness: () => Promise<void>, markStopped: (id: string) => void) {
  const version = useRef(0)
  const mounted = useRef(false)
  const running = useRef(false)
  const active = useRef<Intervention | null>(null)
  const attempts = useRef(new Set<string>())
  const warming = useRef<{ key: string, done: Promise<void> } | null>(null)
  const countdownAsset = useRef<{ queueId: number, id: string, checksum: string } | null>(null)
  const prepare = useCallback(async (queueId: number) => {
    const state = store.getState()
    const key = `${socket.id}:${state.user.roomId}:${queueId}:${state.animation.snapshot?.karaokeBackgroundRevision}`
    if (warming.current?.key === key) return warming.current.done
    const load = async () => {
      const reply = await animationRequest(KARAOKE_CUE, { operation: 'prepare', queueId })
      if (!mounted.current || !socket.connected || warming.current?.key !== key) return
      const assets = reply.karaokeCue?.assets ?? []
      const countdown = assets.find(asset => asset.id === reply.payload?.karaokeStage?.countdownEffectId)
      countdownAsset.current = countdown ? { queueId, id: countdown.id, checksum: countdown.checksum } : null
      channel.karaokeQueueId = queueId
      await channel.prepare(assets, 'karaoke')
      if (mounted.current && warming.current?.key === key) await refreshReadiness()
    }
    const done = load().finally(() => {
      if (warming.current?.key === key) warming.current = null
    })
    warming.current = { key, done }
    return done
  }, [channel, refreshReadiness])

  useEffect(() => {
    mounted.current = true
    const stop = () => {
      version.current++
      if (active.current) {
        active.current = null
        channel.stopForeground('karaoke-cue-cancelled')
      }
    }
    const command = (action: { type: string }) => {
      if ([PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY].includes(action.type)) stop()
    }
    const watch = store.subscribe(() => {
      const grant = active.current
      if (!grant) return
      const state = store.getState()
      const snapshot = state.animation.snapshot
      const cue: KaraokeCueContext = JSON.parse(grant.karaokeCueJSON!)
      const turn = snapshot?.karaokeTurn
      const item = ensureState(state.queue).entities[cue.queueId]
      const tail = cue.kind === 'countdown' && (karaokeCountdownTail(cue, turn)
        || (!turn && state.player.queueId === cue.queueId && state.player.isPlaying && item?.isOptimistic !== true && item && ['APPROVED', 'PLAYING'].includes(item.status)))
      if (state.player._authority !== 'GRANTED' || snapshot?.playerEpoch !== grant.playerEpoch || snapshot?.active?.interventionId !== grant.interventionId
        || snapshot.active.stopRequestedAt || snapshot.prefs.volume <= 0
        || ((cue.kind === 'reminder' || cue.kind === 'countdown') && !tail
          && (!turn || turn.runId !== cue.runId || turn.revision !== cue.revision || turn.phase !== (cue.kind === 'reminder' ? 'waiting' : 'countdown')))) stop()
    })
    socket.on('action', command)
    socket.on('disconnect', stop)
    window.addEventListener('pagehide', stop)
    return () => {
      mounted.current = false
      stop()
      watch()
      socket.off('action', command)
      socket.off('disconnect', stop)
      window.removeEventListener('pagehide', stop)
    }
  }, [channel])

  const play = useCallback(async (cue: KaraokeCueContext) => {
    const key = `${cue.queueId}:${cue.kind}:${cue.token}`
    const remainingMs = () => {
      const turn = store.getState().animation.snapshot?.karaokeTurn
      return cue.kind === 'countdown' && turn?.endsAt ? turn.endsAt - animationTime() : undefined
    }
    if (running.current || !socket.connected || !channel.ready) {
      tracePlayback('karaoke-cue-skipped', { queueId: cue.queueId, state: cue.kind, reason: running.current ? 'channel-busy' : !socket.connected ? 'disconnected' : 'audio-locked', remainingMs: remainingMs() })
      return
    }
    if (cue.kind !== 'reminder' && attempts.current.has(key)) return
    if (attempts.current.size > 100) attempts.current.clear()
    if (cue.kind !== 'reminder') attempts.current.add(key)
    running.current = true
    tracePlayback('karaoke-cue-request', { queueId: cue.queueId, state: cue.kind })
    const epoch = version.current
    let grant: Intervention | undefined
    let started = false
    let ended = false
    let ducked = false
    const valid = () => mounted.current && epoch === version.current && socket.connected && store.getState().player._authority === 'GRANTED'
    try {
      if (cue.kind !== 'countdown') {
        await prepare(cue.queueId)
        if (!valid()) return
        const state = store.getState()
        const status = Object.fromEntries(Object.entries(state.player).filter(([key]) => !key.startsWith('_')))
        await animationRequest(PLAYER_EMIT_STATUS, { ...status, visualizer: state.playerVisualizer })
      }
      if (!valid()) return
      if (cue.kind === 'countdown' && warming.current) {
        // If approval came during the prefetch, wait for just its effect,
        // leaving time for the reservation round trip, never delaying music.
        while (warming.current && valid() && (remainingMs() ?? 0) > 950) {
          const turn = store.getState().animation.snapshot?.karaokeTurn
          const id = store.getState().animation.snapshot?.karaokeStage?.countdownEffectId
          const asset = countdownAsset.current
          if (!id || turn?.runId !== cue.runId || turn.revision !== cue.revision || turn.phase !== 'countdown') return
          if (asset?.queueId === cue.queueId && asset.id === id && channel.buffers.has(asset.checksum)) break
          await new Promise(resolve => setTimeout(resolve, 40))
        }
      }
      if (!valid()) return
      const reply = await animationRequest(KARAOKE_CUE, { operation: 'reserve', ...cue,
        ...(cue.kind === 'countdown' && { readyClips: channel.readyChecksums }) })
      grant = reply.grant
      const turn = store.getState().animation.snapshot?.karaokeTurn
      const changed = !valid() || (cue.kind === 'countdown' && (turn?.phase !== 'countdown' || turn.runId !== cue.runId || turn.revision !== cue.revision))
      if (!grant || changed || animationTime() >= grant.startBefore!) {
        tracePlayback('karaoke-cue-skipped', { queueId: cue.queueId, state: cue.kind, reason: !grant ? reply.cueOmission ?? 'not-granted' : changed ? 'turn-changed' : 'deadline-expired', remainingMs: remainingMs() })
        return
      }
      active.current = grant
      const assets = JSON.parse(grant.sequenceJSON!) as KaraokeCueClip[]
      if (cue.kind === 'reminder') {
        channel.duckBed(true)
        ducked = true
      }
      for (const [index, asset] of assets.entries()) {
        if (!valid()) return
        const volume = asset.volume ?? store.getState().animation.snapshot?.prefs.volume ?? 0.5
        const completion = channel.play(asset.checksum, volume, karaokeCueSegment(asset))
        started = true
        await animationPlaybackEvent(grant, index === 0 ? 'STARTED' : 'ASSET_STARTED', index === 0 ? undefined : asset.id)
        if (await completion !== 'ENDED' || !valid()) return
      }
      ended = true
    } catch {
      tracePlayback('karaoke-cue-skipped', { queueId: cue.queueId, state: cue.kind, reason: 'preparation-or-playback' })
    } finally {
      if (active.current === grant && grant) {
        active.current = null
        channel.stopForeground('karaoke-cue-finished')
      }
      if (ducked) channel.duckBed(false)
      if (grant) {
        markStopped(grant.interventionId)
        if (socket.connected) await animationRequest(ANIMATION_EVENT, { interventionId: grant.interventionId, playerEpoch: grant.playerEpoch, event: ended ? 'ENDED' : started ? 'STOPPED' : 'NOT_STARTED' }).catch(() => {})
      }
      running.current = false
    }
  }, [channel, markStopped, prepare])
  const allowsMusic = (queueId: number) => {
    const grant = active.current
    const state = store.getState()
    const snapshot = state.animation.snapshot
    if (!grant?.karaokeCueJSON || state.player._authority !== 'GRANTED' || grant.ownerSocketId !== socket.id
      || snapshot?.playerEpoch !== grant.playerEpoch || snapshot.active?.interventionId !== grant.interventionId
      || snapshot.active.status !== 'PLAYING' || snapshot.active.stopRequestedAt || animationTime() >= grant.leaseUntil!
      || (snapshot.ambience && snapshot.ambience.ownerSocketId !== socket.id && snapshot.ambience.until > animationTime())) return false
    const cue: KaraokeCueContext = JSON.parse(grant.karaokeCueJSON)
    const item = ensureState(state.queue).entities[queueId]
    const playing = !snapshot.karaokeTurn && state.player.queueId === queueId && state.player.isPlaying
      && item?.isOptimistic !== true && item && ['APPROVED', 'PLAYING'].includes(item.status)
    return cue.kind === 'countdown' && cue.queueId === queueId && (karaokeCountdownTail(cue, snapshot.karaokeTurn) || !!playing)
  }
  return { play, prepare, allowsMusic }
}
