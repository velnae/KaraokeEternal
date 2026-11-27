import React, { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ensureState } from 'redux-optimistic-ui'
import socket from 'lib/socket'
import store from 'store/store'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { playerLeave, playerStatus, playerUpdate } from '../modules/player'
import { localPlay } from '../runtime/localPlay'
import PublicPlayerControls from './PublicPlayerControls'
import PlayerController from './PlayerController/PlayerController'

/** Acquire the room without mounting any media or idle automation. */
export default function PlayerStartup (props: { width: number, height: number }) {
  const dispatch = useAppDispatch()
  const authority = useAppSelector(s => s.player._authority)
  const loaded = useAppSelector(s => !!s.rooms.entities[s.user.roomId] && !ensureState(s.queue).isLoading)
  const [started, setStarted] = useState(false)
  const activated = useRef(false)
  useEffect(() => {
    if (started) return
    const pending = () => dispatch(playerUpdate({ _authority: 'PENDING' }))
    const claim = () => {
      pending()
      dispatch(playerStatus({ queueId: -1, isPlaying: false, isAtQueueEnd: false }))
    }
    socket.on('connect', claim)
    socket.on('disconnect', pending)
    if (socket.connected) claim()
    else pending()
    return () => {
      socket.off('connect', claim)
      socket.off('disconnect', pending)
      if (!activated.current && socket.connected) dispatch(playerLeave())
    }
  }, [dispatch, started])
  useEffect(() => {
    if (!started && authority === 'PENDING' && socket.connected) dispatch(playerStatus({ isPlaying: false, queueId: -1 }))
  }, [authority, started, dispatch])
  const start = () => {
    if (activated.current || !socket.connected || store.getState().player._authority !== 'GRANTED' || !loaded) return
    activated.current = true
    // Mount and bind the activation adapters before leaving the trusted click.
    flushSync(() => {
      dispatch(playerUpdate({ isPlaying: false, _isPlayingNext: false, _isReplayingQueueId: null, _isBetweenTracks: false, isErrored: false }))
      setStarted(true)
    })
    localPlay.start()
  }
  if (started) return <PlayerController {...props} />
  if (authority === 'DENIED') return <section role='status'><h1>Ya hay un reproductor activo</h1></section>
  if (!loaded || authority !== 'GRANTED') return <p role='status'>Preparando reproductor…</p>
  return <PublicPlayerControls showPlay onPlay={start} />
}
