import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import store from 'store/store'
import socket from 'lib/socket'
import { selectBirthdays } from 'store/modules/birthdays'
import { nextBirthday } from 'shared/playbackSequence'
import type { BirthdayGrant, BirthdayPhase } from 'shared/birthdays'
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
  const attempt = useCallback(async (boundary: 'ended' | 'idle' | 'start', sourceQueueId: number): Promise<'none' | 'waiting' | 'finished' | 'interrupted'> => {
    if (abort.current) return 'waiting'
    const controller = new AbortController()
    abort.current = controller
    let grant: BirthdayGrant | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    try {
      const requestedAt = performance.now()
      const response = await birthdayPlayerRequest({ operation: 'reserve', boundary, sourceQueueId, ready: channel.ready && store.getState().player.volume > 0 })
      if (!response) return 'none'
      if ('waiting' in response) return 'waiting'
      if (!('token' in response)) throw new Error('Reserva inválida.')
      grant = response
      const progress = (operation: string, phase?: BirthdayPhase) => birthdayPlayerRequest({ operation, id: grant!.event.id, token: grant!.token, phase })
      const audio = new BirthdayAudio(channel.context!)
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
      if (live.current) {
        setError('')
        setScene({ grant, phase: 'intro' })
      }
      await audio.prepare(grant.assets, controller.signal)
      for (const phase of ['intro', 'greeting', 'music'] as const) {
        controller.signal.throwIfAborted()
        if (phase !== 'intro') await progress('phase', phase)
        if (live.current) setScene({ grant, phase })
        const asset = grant.assets.find(item => item.kind === phase)
        if (!asset) throw new Error('Falta un audio de la celebración.')
        const volume = store.getState().player.volume
        await audio.play(asset, volume, controller.signal)
      }
      await progress('finish')
      return 'finished'
    } catch (failure) {
      if (grant) await birthdayPlayerRequest({ operation: 'interrupt', id: grant.event.id, token: grant.token }).catch(() => {})
      if (live.current) setError(failure instanceof Error ? failure.message : 'La celebración se interrumpió.')
      return 'interrupted'
    } finally {
      clearInterval(heartbeat)
      activeAudio.current = null
      if (abort.current === controller) abort.current = null
      if (live.current) setScene(null)
    }
  }, [channel])
  return { attempt, scene, error, unlock, pendingEvent: candidate, pending: !!candidate, needsSound: !!candidate && !soundReady, needsVolume: candidate?.playback === 'scheduled' && volume <= 0, busy: !!scene }
}
