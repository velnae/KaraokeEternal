import { useEffect } from 'react'
import socket from 'lib/socket'
import store from 'store/store'
import { animationTime } from 'lib/animationApi'
import { requestAutomaticPlayerFullscreen } from 'lib/playerFullscreen'
import { PLAYER_CMD_FULLSCREEN } from 'shared/actionTypes'
import { FULLSCREEN_REQUEST_MS, type FullscreenCommand, type FullscreenResult } from 'shared/playerFullscreen'

export default function useRemoteFullscreen () {
  useEffect(() => {
    let alive = true
    const receive = (action: { type: string, payload?: FullscreenCommand }, acknowledge?: (result: FullscreenResult) => void) => {
      if (action.type !== PLAYER_CMD_FULLSCREEN || typeof acknowledge !== 'function') return
      const command = action.payload
      const current = () => {
        const state = store.getState()
        return alive && socket.connected && !!command && command.playerSocketId === socket.id
          && Number.isFinite(command.expiresAt) && command.expiresAt > animationTime()
          && command.expiresAt <= animationTime() + FULLSCREEN_REQUEST_MS * 2
          && state.user.isAdmin && state.user.roomId === command.roomId && state.player?._authority === 'GRANTED'
      }
      void requestAutomaticPlayerFullscreen(current).then(acknowledge).catch(() => acknowledge({ status: 'rejected' }))
    }
    socket.on('action', receive)
    return () => {
      alive = false
      socket.off('action', receive)
    }
  }, [])
}
