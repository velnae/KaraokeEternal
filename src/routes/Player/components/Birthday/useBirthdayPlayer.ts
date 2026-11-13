import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import store from 'store/store'
import socket from 'lib/socket'
import { selectBirthdays } from 'store/modules/birthdays'
import { nextBirthday } from 'shared/playbackSequence'
import { birthdaySequence, type BirthdayGrant, type BirthdayPhase } from 'shared/birthdays'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_REPLAY, PLAYER_EMIT_STATUS } from 'shared/actionTypes'
import useBirthdaySync from 'components/Birthdays/useBirthdaySync'
import { birthdayPlayerRequest } from 'components/Birthdays/api'
import type AnnouncementAudio from '../Animation/AnnouncementAudio'
import { BirthdayAudio } from './BirthdayAudio'
import { playerStatus, playerStatusCancel } from '../../modules/player'
import { animationRequest } from 'lib/animationApi'
import { resolveEventScene } from 'shared/eventScenes'
import SceneRun from '../Animation/SceneRun'
import type { SceneCue } from 'shared/eventScenes'
import type { BirthdayAsset } from 'shared/birthdays'

export default function useBirthdayPlayer (channel: AnnouncementAudio) {
  useBirthdaySync()
  const events = useAppSelector(selectBirthdays)
  const authority = useAppSelector(state => state.player._authority)
  const roomId = useAppSelector(state => state.user.roomId)
  const volume = useAppSelector(state => state.player.volume)
  const [scene, setScene] = useState<{ grant: BirthdayGrant, phase: BirthdayPhase, startedAt?: number, run?: SceneRun | null } | null>(null)
  const [error, setError] = useState('')
  const [soundReady, setSoundReady] = useState(channel.ready)
  const abort = useRef<AbortController | null>(null)
  const activeAudio = useRef<BirthdayAudio | null>(null)
  const live = useRef(true)
  const prepared = useRef<{ id: string, assets: BirthdayGrant['assets'], ambience?: BirthdayGrant['ambience'], extraAudio?: BirthdayGrant['extraAudio'], audio: BirthdayAudio } | null>(null)
  const candidate = nextBirthday(events)
  useEffect(() => {
    if (!candidate?.id || candidate.preparation !== 'ready' || !channel.context || authority !== 'GRANTED') return
    const controller = new AbortController()
    void birthdayPlayerRequest({ operation: 'prepare' }).then(async (reply): Promise<void> => {
      if (!reply || !('assets' in reply) || !('id' in reply)) return undefined
      const audio = new BirthdayAudio(channel.context!)
      await audio.prepare([...reply.assets, ...(reply.ambience ? [reply.ambience] : []), ...(reply.extraAudio ?? []).map(item => item.asset)], controller.signal)
      if (!controller.signal.aborted) prepared.current = { id: reply.id, assets: reply.assets, ambience: reply.ambience, extraAudio: reply.extraAudio, audio }
      return undefined
    }).catch(() => {})
    return () => controller.abort()
  }, [candidate?.id, candidate?.preparation, authority, channel])
  useEffect(() => {
    activeAudio.current?.volume(volume)
  }, [volume])
  useEffect(() => {
    live.current = true
    const stop = () => abort.current?.abort()
    const command = ({ type }: { type: string }) => {
      if ([PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_REPLAY].includes(type)) stop()
    }
    socket.on('disconnect', stop)
    socket.on('action', command)
    return () => {
      live.current = false
      stop()
      socket.off('disconnect', stop)
      socket.off('action', command)
    }
  }, [roomId])
  useEffect(() => {
    if (authority !== 'GRANTED') abort.current?.abort()
  }, [authority])
  useEffect(() => {
    const context = channel.context
    const update = () => setSoundReady(channel.ready)
    context?.addEventListener('statechange', update)
    return () => context?.removeEventListener('statechange', update)
  }, [channel, soundReady])
  const unlock = () => {
    void channel.resume().then((): void => {
      setSoundReady(channel.ready)
      setError('')
      return undefined
    }).catch(() => {
      setSoundReady(false)
      setError('No se pudo activar el sonido. Vuelva a intentarlo en el reproductor.')
    })
  }
  const attempt = useCallback(async (boundary: 'ended' | 'idle' | 'start' | 'tail', sourceQueueId: number, run?: SceneRun): Promise<'none' | 'waiting' | 'finished' | 'interrupted'> => {
    if (abort.current) return 'waiting'
    const controller = new AbortController()
    abort.current = controller
    let grant: BirthdayGrant | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let background: Promise<void> | undefined
    try {
      if (boundary === 'tail') {
        store.dispatch(playerStatusCancel())
        const state = store.getState()
        const status = Object.fromEntries(Object.entries(state.player).filter(([key]) => !key.startsWith('_')))
        await animationRequest(PLAYER_EMIT_STATUS, { ...status, visualizer: state.playerVisualizer }, 3000)
        controller.signal.throwIfAborted()
      }
      const requestedAt = performance.now()
      const response = await birthdayPlayerRequest({ operation: 'reserve', boundary, sourceQueueId, ready: channel.ready && store.getState().player.volume > 0 })
      if (!response) return 'none'
      if ('waiting' in response) return 'waiting'
      if (!('token' in response)) throw new Error('Reserva inválida.')
      grant = response
      const progress = (operation: string, phase?: BirthdayPhase) => birthdayPlayerRequest({ operation, id: grant!.event.id, token: grant!.token, phase })
      const cached = prepared.current
      const audio = cached?.id === grant.event.id && JSON.stringify([cached.assets, cached.ambience, cached.extraAudio]) === JSON.stringify([grant.assets, grant.ambience, grant.extraAudio]) ? cached.audio : new BirthdayAudio(channel.context!)
      prepared.current = null
      audio.permitFor(response.remainingMs - (performance.now() - requestedAt) - 100)
      activeAudio.current = audio
      heartbeat = setInterval(() => {
        const sentAt = performance.now()
        void progress('heartbeat').then((receipt): void => {
          if (abort.current !== controller || controller.signal.aborted) return
          if (!receipt || !('remainingMs' in receipt)) throw new Error('Permiso de audio no confirmado.')
          audio.permitFor(receipt.remainingMs - (performance.now() - sentAt) - 100)
          return undefined
        }).catch(() => controller.abort())
      }, 4000)
      controller.signal.throwIfAborted()
      channel.stop()
      if (boundary !== 'tail') store.dispatch(playerStatus({ isAtQueueEnd: true }))
      if (live.current) {
        setError('')
        setScene({ grant, phase: 'intro' })
      }
      if (audio !== cached?.audio) await audio.prepare([...grant.assets, ...(grant.ambience ? [grant.ambience] : []), ...(grant.extraAudio ?? []).map(item => item.asset)], controller.signal)
      const sceneRun = grant.scene ? run ?? new SceneRun(grant.scene, sourceQueueId, null, store.getState().player._lastReplayTime) : null
      if (sceneRun && boundary !== 'tail') sceneRun.end()
      if (sceneRun) Object.assign(sceneRun.resources, grant.resources ?? Object.fromEntries(grant.assets.map(asset => [asset.kind === 'video' ? 'background' : asset.kind, asset])))
      if (sceneRun && grant.scene) {
        for (const cue of grant.scene.cues.filter(cue => cue.lane === 'voice')) {
          const asset = cue.binding === 'resource' ? grant.extraAudio?.find(item => item.cueId === cue.id)?.asset : grant.assets.find(asset => asset.kind === cue.slot)
          if (asset) sceneRun.resources[cue.id] = { ...asset, durationMs: audio.durationMs(asset) }
        }
        sceneRun.installAudio([])
      }
      const timeline = grant.scene && sceneRun ? resolveEventScene(grant.scene, sceneRun.resources, sceneRun.mediaEndMs()) : null
      if (sceneRun && grant.scene!.startOffsetMs > 0) await sceneRun.until(sceneRun.startedAt)
      if (sceneRun && grant.ambience) {
        const ambience = grant.ambience
        const cue = grant.scene?.cues.find(cue => cue.lane === 'ambience' && cue.enabled !== false)
        background = (async () => {
          if (!await sceneRun.wait(cue, undefined, () => !controller.signal.aborted)) return
          await audio.playBackground(ambience, store.getState().player.volume, controller.signal, cue?.durationMs ?? Math.max(0, grant!.event.durationMs - (performance.now() - sceneRun.startedAt)),
            (cue?.volume ?? 1) * (store.getState().animation.snapshot?.prefs.ambienceVolume ?? 0.2), cue?.fadeMs ?? 0)
        })().catch(() => {})
      }
      let previousAt = sceneRun?.startedAt ?? performance.now()
      const sequence: Array<{ cue?: SceneCue, asset?: BirthdayAsset }> = timeline
        ? timeline.filter(cue => cue.lane === 'voice').sort((a, b) => a.startMs - b.startMs).map(cue => ({ cue, asset: cue.binding === 'resource' ? grant!.extraAudio?.find(item => item.cueId === cue.id)?.asset : grant!.assets.find(asset => asset.kind === cue.slot) }))
        : birthdaySequence(grant.assets).map(asset => ({ asset }))
      let currentPhase: BirthdayPhase = 'intro'
      for (const item of sequence) {
        const asset = item.asset
        if (!asset) throw new Error('Falta un audio de la escena. Revise sus recursos.')
        const phase = item.cue?.binding === 'resource' ? undefined : asset.kind as BirthdayPhase
        controller.signal.throwIfAborted()
        if (sceneRun) await sceneRun.wait(item.cue, previousAt, () => !controller.signal.aborted)
        if (phase) await progress('phase', phase)
        if (phase) currentPhase = phase
        if (live.current) setScene({ grant, phase: currentPhase, startedAt: sceneRun?.startedAt, run: sceneRun })
        const volume = store.getState().player.volume
        await audio.play(asset, volume, controller.signal, (durationMs) => {
          if (item.cue) sceneRun?.startCue(item.cue.id, durationMs)
          if (phase === 'intro') void progress('introStarted').catch(() => controller.abort())
        }, item.cue?.fadeMs ?? 0, item.cue?.volume ?? 1)
        if (item.cue) sceneRun?.endCue(item.cue.id)
        previousAt = performance.now()
      }
      await progress('finish')
      return 'finished'
    } catch (failure) {
      if (grant) await birthdayPlayerRequest({ operation: 'interrupt', id: grant.event.id, token: grant.token }).catch(() => {})
      if (live.current) setError(failure instanceof Error ? failure.message : 'La celebración se interrumpió.')
      return 'interrupted'
    } finally {
      clearInterval(heartbeat)
      controller.abort()
      await background
      activeAudio.current?.stopBackground()
      activeAudio.current = null
      if (abort.current === controller) abort.current = null
      if (live.current) setScene(null)
    }
  }, [channel])
  return { attempt, scene, error, unlock, pendingEvent: candidate, pending: !!candidate, needsSound: !!candidate && !soundReady, needsVolume: candidate?.playback === 'scheduled' && volume <= 0, busy: !!scene }
}
