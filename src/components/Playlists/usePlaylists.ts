import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import HttpApi from 'lib/HttpApi'
import type { PlaylistSnapshot } from 'shared/playlists'

const api = new HttpApi()
type Result = PlaylistSnapshot & { createdPlaylistId?: number }
export function usePlaylists (poll = false) {
  const roomId = useAppSelector(state => state.user.roomId)
  const [data, setData] = useState<Result | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const sequence = useRef(0)
  const invalidate = useCallback(() => {
    sequence.current++
  }, [])
  const prefix = `rooms/${roomId}/playlists`
  const load = useCallback(async () => {
    const current = ++sequence.current
    try {
      const result = await api.get<Result>(prefix)
      if (current === sequence.current) {
        setData(result)
        setError('')
      }
    } catch (error) { if (current === sequence.current) setError((error as Error).message) }
  }, [prefix])
  useEffect(() => {
    if (roomId) void load()
    const timer = poll
      ? setInterval(() => {
          if (!pending.current && roomId) void load()
        }, 3000)
      : null
    return () => {
      invalidate()
      if (timer) clearInterval(timer)
    }
  }, [roomId, load, poll, invalidate])
  const run = async (method: string, suffix: string, body?: object): Promise<Result | null> => {
    if (pending.current) return null
    pending.current = true
    const current = ++sequence.current
    setBusy(true)
    setError('')
    try {
      const result = await api.request<Result>(method, prefix + suffix, body ? { body } : {})
      if (current === sequence.current) setData(result)
      return result
    } catch (error) {
      if (current === sequence.current) setError((error as Error).message)
      return null
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { roomId, data, busy, error, load, run }
}
