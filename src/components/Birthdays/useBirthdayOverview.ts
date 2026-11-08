import { useCallback, useEffect, useState } from 'react'
import { useAppSelector } from 'store/hooks'
import type { BirthdayOverview } from 'shared/birthdays'
import { birthdayApi } from './api'

export default function useBirthdayOverview () {
  const { roomId, isAdmin } = useAppSelector(state => state.user)
  const [overview, setOverview] = useState<BirthdayOverview | null>(null)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion(value => value + 1), [])
  useEffect(() => {
    setOverview(null)
  }, [roomId])
  useEffect(() => {
    if (!roomId || !isAdmin) {
      setError('Seleccione una sala para gestionar cumpleaños.')
      return
    }
    let live = true
    let working = false
    const load = async () => {
      if (working) return
      working = true
      try {
        const value = await birthdayApi.get<BirthdayOverview>('')
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
  }, [roomId, isAdmin, version])
  return { overview, error, refresh }
}
