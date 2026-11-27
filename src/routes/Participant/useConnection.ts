import { useSyncExternalStore } from 'react'
import socket from 'lib/socket'

let reconnecting = false
socket.on('connect_error', () => { reconnecting = socket.active })
socket.on('disconnect', () => { reconnecting = socket.active })
socket.on('connect', () => { reconnecting = false })

const subscribe = (notify: () => void) => {
  socket.on('connect', notify)
  socket.on('disconnect', notify)
  socket.on('connect_error', notify)
  return () => {
    socket.off('connect', notify)
    socket.off('disconnect', notify)
    socket.off('connect_error', notify)
  }
}

export const useConnection = () => useSyncExternalStore(subscribe, () => socket.connected)
export const useConnectionStatus = () => useSyncExternalStore(subscribe, () => socket.connected ? 'connected' : reconnecting ? 'reconnecting' : 'connecting')
