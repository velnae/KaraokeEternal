import { useEffect, useRef, useState } from 'react'
import socket from 'lib/socket'
import store from 'store/store'
import { animationTime } from 'lib/animationApi'
import { requestAutomaticPlayerFullscreen } from 'lib/playerFullscreen'
import { PLAYER_CMD_CLOSE, PLAYER_CMD_FULLSCREEN, PLAYER_LEAVE } from 'shared/actionTypes'
import { PLAYER_WINDOW_REQUEST_MS, type PlayerWindowCommand, type PlayerWindowResult } from 'shared/playerWindow'
import { playerUpdate } from './modules/player'

export default function useRemotePlayerControls () {
  const [closed, setClosed] = useState(false)
  const [released, setReleased] = useState(false)
  const closing = useRef(false)
  useEffect(() => {
    let alive = true
    const receive = (action: { type: typeof PLAYER_CMD_CLOSE | typeof PLAYER_CMD_FULLSCREEN, payload?: PlayerWindowCommand }
      | { type: typeof PLAYER_LEAVE, payload?: { socketId: string } }, acknowledge?: (result: PlayerWindowResult | { status: 'closing' }) => void) => {
      if (action.type === PLAYER_LEAVE) {
        if (alive && closing.current && action.payload?.socketId === socket.id) setReleased(true)
        return
      }
      if (![PLAYER_CMD_FULLSCREEN, PLAYER_CMD_CLOSE].includes(action.type) || typeof acknowledge !== 'function') return
      const command = action.payload
      const current = () => {
        const state = store.getState()
        return alive && !closing.current && socket.connected && !!command && command.playerSocketId === socket.id
          && Number.isFinite(command.expiresAt) && command.expiresAt > animationTime()
          && command.expiresAt <= animationTime() + PLAYER_WINDOW_REQUEST_MS * 2
          && state.user.isAdmin && state.user.roomId === command.roomId && state.player?._authority === 'GRANTED'
      }
      if (action.type === PLAYER_CMD_CLOSE) {
        if (!current()) return acknowledge({ status: 'changed' })
        closing.current = true
        acknowledge({ status: 'closing' })
        setClosed(true)
        return
      }
      void requestAutomaticPlayerFullscreen(current).then(acknowledge).catch(() => acknowledge({ status: 'rejected' }))
    }
    socket.on('action', receive)
    return () => {
      alive = false
      socket.off('action', receive)
    }
  }, [])
  useEffect(() => {
    if (!closed) return
    // PlayerView has removed PlayerController: its normal cleanup emits LEAVE
    // and stops music/voice. Clear intent only after that unmount.
    store.dispatch(playerUpdate({
      isPlaying: false, queueId: -1, position: 0, isAtQueueEnd: false,
      _isFetching: false, _isPlayingNext: false, _isReplayingQueueId: null,
      _isBetweenTracks: false, _isReplayPlayback: false,
    }))
  }, [closed])
  useEffect(() => {
    if (!closed || !released) return
    // Wait for the server's departure notice before unloading: HTTP polling can
    // otherwise lose the LEAVE packet and keep the room occupied until timeout.
    const timer = window.setTimeout(() => window.close(), 0)
    return () => window.clearTimeout(timer)
  }, [closed, released])
  return closed
}
