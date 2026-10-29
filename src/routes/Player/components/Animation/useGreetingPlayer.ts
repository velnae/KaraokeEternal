import { useCallback, useEffect, useRef, useState } from 'react'
import store from 'store/store'
import socket from 'lib/socket'
import { greetingRequest } from 'components/Greetings/api'
import { greetingDuration, type Greeting } from 'shared/greetings'
import { PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY, PLAYER_EMIT_STATUS } from 'shared/actionTypes'
import { playerStatusCancel } from '../../modules/player'
import getRoundRobinQueue from 'routes/Queue/selectors/getRoundRobinQueue'
import GreetingCommitGate from './GreetingCommitGate'

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export default function useGreetingPlayer () {
  const [active, setActive] = useState<Greeting | null>(null)
  const [error, setError] = useState('')
  const version = useRef(0)
  const mounted = useRef(false)
  const commit = useRef(new GreetingCommitGate())
  const confirmMounted = useCallback((node: HTMLElement | null) => {
    if (node?.isConnected) commit.current.confirm(Number(node.dataset.greetingId))
  }, [])
  useEffect(() => {
    mounted.current = true
    const gate = commit.current
    const stop = () => {
      version.current++
      gate.cancel()
      if (mounted.current) setActive(null)
    }
    const command = (action: { type: string }) => {
      if ([PLAYER_CMD_NEXT, PLAYER_CMD_PAUSE, PLAYER_CMD_PLAY, PLAYER_CMD_REPLAY].includes(action.type)) stop()
    }
    socket.on('disconnect', stop)
    socket.on('action', command)
    window.addEventListener('pagehide', stop)
    return () => {
      mounted.current = false
      stop()
      socket.off('disconnect', stop)
      socket.off('action', command)
      window.removeEventListener('pagehide', stop)
    }
  }, [])

  const attempt = useCallback(async (queueId: number): Promise<boolean> => {
    const generation = version.current
    let reserved = false
    let turnKey: number | undefined
    const valid = () => {
      const state = store.getState()
      if (!mounted.current || generation !== version.current || !socket.connected || state.player._authority !== 'GRANTED'
        || state.animation.snapshot?.microphoneOccupied) return false
      if (state.rooms.entities[state.user.roomId]?.status === 'closed') return false
      const ordered = getRoundRobinQueue({ ...state, status: { ...state.status, queueId: state.player.queueId, historyJSON: state.player.historyJSON, nextUserId: state.player.nextUserId } })
      return ordered.result.slice(ordered.result.indexOf(state.player.queueId) + 1).find(id => ordered.entities[id].status === 'APPROVED') === queueId
    }
    try {
      if (!valid()) return false
      setError('')
      store.dispatch(playerStatusCancel())
      const state = store.getState()
      const status = Object.fromEntries(Object.entries(state.player).filter(([key]) => !key.startsWith('_')))
      const flush = await socket.timeout(1500).emitWithAck('action', { type: PLAYER_EMIT_STATUS, payload: { ...status, visualizer: state.playerVisualizer } })
      if (flush.error || !valid()) return false
      const { grant } = await greetingRequest('reserve', { queueId })
      if (!grant) return false
      reserved = true
      turnKey = grant.turnKey
      for (const item of grant.items) {
        if (!valid() || Date.now() >= grant.until) break
        const snapshot = (await greetingRequest('read')).payload!
        if (snapshot.paused) break
        if (snapshot.items.find(row => row.greetingId === item.greetingId)?.status !== 'RESERVED') continue
        if (!valid()) break
        const rendered = commit.current.wait(item.greetingId)
        setActive(item)
        // Acknowledge the exact card committed by React, not a browser paint.
        // Background tabs suspend animation frames while music must keep flowing.
        const committed = await rendered
        if (!valid()) break
        if (!committed) throw new Error('No se pudo preparar la tarjeta del saludo')
        await greetingRequest('start', { turnKey: grant.turnKey, greetingId: item.greetingId })
        const end = Date.now() + greetingDuration(item)
        let removed = false
        while (Date.now() < end && valid() && Date.now() < grant.until) {
          await delay(Math.min(400, end - Date.now()))
          if (!valid()) break
          const fresh = (await greetingRequest('read')).payload!
          if (fresh.paused || fresh.items.find(row => row.greetingId === item.greetingId)?.status !== 'DISPLAYING') {
            removed = true
            break
          }
        }
        if (mounted.current) setActive(null)
        if (!valid()) break
        if (!removed) await greetingRequest('end', { turnKey: grant.turnKey, greetingId: item.greetingId })
      }
    } catch (error) {
      if (mounted.current && generation === version.current) setError(`Saludo no completado: ${(error as Error).message}. La música continúa.`)
    } finally {
      commit.current.cancel()
      if (mounted.current) setActive(null)
      if (reserved && socket.connected) await greetingRequest('finish', { turnKey }).catch(() => {})
    }
    return reserved
  }, [])
  return { active, error, attempt, confirmMounted }
}
