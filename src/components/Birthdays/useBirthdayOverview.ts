import { useCallback, useEffect, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import type { BirthdayOverview, BirthdayQueueOverview } from 'shared/birthdays'
import { canOperate } from 'shared/permissions'
import { birthdayApi } from './api'

export default function useBirthdayOverview () {
  const allowed = useAppSelector(state => state.user.isAdmin)
  return useOverview<BirthdayOverview>('', allowed)
}

export function useBirthdayQueueOverview () {
  const user = useAppSelector(state => state.user)
  return useOverview<BirthdayOverview | BirthdayQueueOverview>(user.isAdmin ? '' : 'queue', canOperate(user))
}

function useOverview<T> (path: string, allowed: boolean) {
  const roomId = useAppSelector(state => state.user.roomId)
  const [overview, setOverview] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion(value => value + 1), [])
  useEffect(() => {
    setOverview(null)
  }, [roomId, path, allowed])
  useEffect(() => {
    if (!roomId || !allowed) {
      setError('Seleccione una sala para gestionar cumpleaños.')
      return
    }
    let live = true
    let working = false
    const load = async () => {
      if (working) return
      working = true
      try {
        const value = await birthdayApi.get<T>(path)
        if (live) {
          setOverview(value)
          setError('')
        }
      } catch (failure) {
        if (live) setError((failure as Error).message)
      } finally { working = false }
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [roomId, allowed, path, version])
  return { overview, error, refresh }
}
