import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import store from 'store/store'
import socket from 'lib/socket'
import { selectBirthdays } from 'store/modules/birthdays'
import { nextBirthday } from 'shared/playbackSequence'
import { birthdayTimeline, type BirthdayGrant, type BirthdayPhase } from 'shared/birthdays'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_STOP, PLAYER_CMD_REPLAY } from 'shared/actionTypes'
import useBirthdaySync from 'components/Birthdays/useBirthdaySync'
import { birthdayPlayerRequest } from 'components/Birthdays/api'
import type AnnouncementAudio from '../Animation/AnnouncementAudio'
import { BirthdayAudio } from './BirthdayAudio'
import { playerStatus } from '../../modules/player'

export default function useBirthdayPlayer (channel: AnnouncementAudio) {
  useBirthdaySync()
  const events = useAppSelector(selectBirthdays)
  const authority = useAppSelector(state => state.player._authority)
  const roomId = useAppSelector(state => state.user.roomId)
  const volume = useAppSelector(state => state.player.volume)
  const [scene, setScene] = useState<{ grant: BirthdayGrant, phase: BirthdayPhase } | null>(null)
  const [error, setError] = useState('')
  const [soundReady, setSoundReady] = useState(channel.ready)
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const activeAudio = useRef<BirthdayAudio | null>(null)
  const live = useRef(true)
  const candidate = nextBirthday(events)
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
  const attempt = useCallback(async (boundary: 'ended' | 'idle' | 'start', sourceQueueId: number, signal?: AbortSignal): Promise<'none' | 'waiting' | 'finished' | 'interrupted'> => {
    if (signal?.aborted) return 'interrupted'
    if (abort.current) return 'waiting'
    const controller = new AbortController()
    abort.current = controller
    const cancel = () => controller.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    let grant: BirthdayGrant | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    try {
      const requestedAt = performance.now()
      const response = await birthdayPlayerRequest({ operation: 'reserve', boundary, sourceQueueId, ready: channel.ready && store.getState().player.volume > 0 })
      if (!response) return 'none'
      if ('waiting' in response) return 'waiting'
      if (!('token' in response)) throw new Error('Reserva inválida.')
      grant = response
      if (live.current) setBusy(true)
      const progress = (operation: string, phase?: BirthdayPhase) => birthdayPlayerRequest({ operation, id: grant!.event.id, token: grant!.token, phase })
      const audio = new BirthdayAudio(channel.context!, false, grant.choreographyVersion)
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
      store.dispatch(playerStatus({ isAtQueueEnd: true }))
      await audio.prepare(grant.assets, controller.signal, grant.bedVolume)
      if (live.current) setError(grant.warning || audio.warning)
      const steps = birthdayTimeline(grant.assets, grant.choreographyVersion)
      for (const [index, step] of steps.entries()) {
        const { phase, asset } = step
        controller.signal.throwIfAborted()
        if (index > 0) await progress('phase', phase)
        if (!asset && phase !== 'prelude' && live.current) setScene({ grant, phase })
        const volume = store.getState().player.volume
        if (!asset) {
          audio.backgroundPhase(phase, volume, step.durationMs, controller.signal)
          if (phase === 'applause') {
            await progress(grant.warning?.includes('aplauso') ? 'skipApplause' : 'finish')
            return 'finished'
          }
          await audio.wait(step.durationMs, controller.signal)
          continue
        }
        if (phase === 'applause' && !audio.available(asset)) {
          await progress('skipApplause')
          return 'finished'
        }
        await audio.play(asset, volume, controller.signal, () => {
          if (live.current) setScene({ grant: grant!, phase })
          if (phase === 'intro') void progress('introStarted').catch(() => controller.abort())
        })
      }
      await progress('finish')
      return 'finished'
    } catch (failure) {
      if (grant) await birthdayPlayerRequest({ operation: 'interrupt', id: grant.event.id, token: grant.token }).catch(() => {})
      if (live.current) setError(failure instanceof Error ? failure.message : 'La celebración se interrumpió.')
      return 'interrupted'
    } finally {
      signal?.removeEventListener('abort', cancel)
      clearInterval(heartbeat)
      activeAudio.current?.stop()
      activeAudio.current = null
      if (abort.current === controller) abort.current = null
      if (live.current) {
        setScene(null)
        setBusy(false)
      }
    }
  }, [channel])
  return { attempt, scene, error, unlock, pendingEvent: candidate, pending: !!candidate, needsSound: !!candidate && !soundReady, needsVolume: candidate?.playback === 'scheduled' && volume <= 0, busy }
}
