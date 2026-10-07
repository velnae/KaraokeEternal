import { useSyncExternalStore } from 'react'
import socket from 'lib/socket'

const subscribe = (notify: () => void) => {
  socket.on('connect', notify)
  socket.on('disconnect', notify)
  return () => {
    socket.off('connect', notify)
    socket.off('disconnect', notify)
  }
}

export const useConnection = () => useSyncExternalStore(subscribe, () => socket.connected)
