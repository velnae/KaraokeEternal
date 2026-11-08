import { useEffect } from 'react'
import socket from 'lib/socket'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { BIRTHDAY_STATE, BIRTHDAY_SYNC } from 'shared/birthdays'
import type { BirthdaySyncReply } from './api'

export default function useBirthdaySync () {
  const roomId = useAppSelector(state => state.user.roomId)
  const dispatch = useAppDispatch()
  useEffect(() => {
    if (!roomId) return
    let active = true
    const sync = () => {
      void socket.timeout(5000).emitWithAck('action', { type: BIRTHDAY_SYNC }).then((reply: BirthdaySyncReply): void => {
        if (active && reply.payload?.roomId === roomId) dispatch({ type: BIRTHDAY_STATE, payload: reply.payload })
        return undefined
      }).catch(() => {})
    }
    sync()
    socket.on('connect', sync)
    return () => {
      active = false
      socket.off('connect', sync)
    }
  }, [roomId, dispatch])
}
