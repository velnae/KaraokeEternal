import { useEffect, useState } from 'react'
import { greetingRequest } from 'components/Greetings/api'
import socket from 'lib/socket'
import { QUEUE_PUSH } from 'shared/actionTypes'
import { GREETING_ANNOUNCEMENTS_CHANGED, type GreetingAnnouncement } from 'shared/greetings'
import { useConnection } from 'routes/Participant/useConnection'

export default function useGreetingAnnouncements (roomId: number, enabled: boolean, queueId: number) {
  const connected = useConnection()
  const [snapshot, setSnapshot] = useState<{ roomId: number, items: GreetingAnnouncement[] } | null>(null)

  useEffect(() => {
    setSnapshot(null)
    if (!enabled || !roomId || !connected) return

    let alive = true
    let revision = 0
    let retry: ReturnType<typeof setTimeout>
    const refresh = async () => {
      const request = ++revision
      clearTimeout(retry)
      try {
        const { announcements } = await greetingRequest('readAnnouncements')
        if (alive && request === revision && socket.connected) setSnapshot({ roomId, items: announcements ?? [] })
      } catch {
        if (alive && request === revision && socket.connected) {
          setSnapshot(null)
          retry = setTimeout(() => void refresh(), 3000)
        }
      }
    }
    const onAction = ({ type, payload }: { type: string, payload?: { roomId: number, greetingId?: number, reset?: boolean } }) => {
      if (type === QUEUE_PUSH) void refresh()
      if (type !== GREETING_ANNOUNCEMENTS_CHANGED || payload?.roomId !== roomId) return
      if (payload.reset) setSnapshot(null)
      else if (payload.greetingId !== undefined) setSnapshot(previous => previous && ({
        ...previous, items: previous.items.filter(item => item.greetingId !== payload.greetingId),
      }))
      void refresh()
    }
    const disconnect = () => {
      revision++
      clearTimeout(retry)
      setSnapshot(null)
    }
    socket.on('action', onAction)
    socket.on('disconnect', disconnect)
    void refresh()
    return () => {
      alive = false
      clearTimeout(retry)
      socket.off('action', onAction)
      socket.off('disconnect', disconnect)
    }
  }, [roomId, enabled, connected])

  return enabled && connected && snapshot?.roomId === roomId ? snapshot.items.find(item => item.queueId === queueId) : undefined
}
