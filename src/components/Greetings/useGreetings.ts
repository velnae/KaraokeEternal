import { useEffect, useRef, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import { type Greeting, type GreetingSnapshot } from 'shared/greetings'
import { greetingRequest } from './api'
import { useConnection } from 'routes/Participant/useConnection'

// One subscription per list, rather than one request loop per musical card.
export default function useGreetings (enabled = true) {
  const { roomId, userId } = useAppSelector(state => state.user)
  const connected = useConnection()
  const [value, setValue] = useState<{ roomId: number, userId: number, snapshot: GreetingSnapshot } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const revision = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    const token = ++generation.current
    const invalidate = () => {
      generation.current++
    }
    let alive = true
    let reading = false
    inFlight.current = false
    setBusy(false)
    setError('')
    setValue(null)
    if (!enabled || !roomId || !connected) return
    const refresh = async () => {
      if (reading || inFlight.current) return
      reading = true
      const version = revision.current
      try {
        const reply = await greetingRequest('read')
        if (alive && token === generation.current && version === revision.current && reply.payload) {
          setValue({ roomId, userId, snapshot: reply.payload })
          setError('')
        }
      } catch (error) {
        if (alive && token === generation.current && version === revision.current) setError((error as Error).message)
      } finally { reading = false }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 1500)
    return () => {
      alive = false
      invalidate()
      clearInterval(timer)
    }
  }, [enabled, roomId, userId, connected])

  const execute = async (operation: 'remove' | 'pause' | 'prepareAudio' | 'playback', payload: object) => {
    if (inFlight.current || !enabled || !connected) return
    const token = generation.current
    revision.current++
    inFlight.current = true
    setBusy(true)
    try {
      const reply = await greetingRequest(operation, payload)
      if (token === generation.current && reply.payload) {
        setValue({ roomId, userId, snapshot: reply.payload })
        setError('')
      }
    } catch (error) {
      if (token === generation.current) setError((error as Error).message)
    } finally {
      if (token === generation.current) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }
  const snapshot = enabled && value?.roomId === roomId && value.userId === userId ? value.snapshot : null
  const byQueue: Record<number, Greeting> = Object.fromEntries((snapshot?.items ?? []).map(item => [item.queueId, item]))
  return { snapshot, byQueue, error, busy: busy || !connected, execute }
}
