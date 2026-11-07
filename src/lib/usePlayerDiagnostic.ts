import { useEffect, useRef } from 'react'
import { useAppSelector } from 'store/hooks'

type Level = 'info' | 'warn'

export function logPlayerDiagnostic (source: string, message: string, roomId: number | null, queueId?: number, level: Level = 'warn') {
  console[level](`[player] ${source}`, { timestamp: new Date().toISOString(), source, message, roomId, queueId })
}

// Record changes, not render/heartbeat frequency. Clearing the message allows
// a later occurrence to be reported again, including in production.
export default function usePlayerDiagnostic (source: string, message: string | null | undefined, level: Level = 'warn') {
  const roomId = useAppSelector(state => state.user.roomId)
  const queueId = useAppSelector(state => state.player?.queueId)
  const previous = useRef('')
  useEffect(() => {
    const key = message ? JSON.stringify([source, message, roomId]) : ''
    if (previous.current === key) return
    previous.current = key
    if (message) logPlayerDiagnostic(source, message, roomId, queueId, level)
  }, [source, message, roomId, queueId, level])
}
