import React, { useEffect, useState } from 'react'
import screenfull from 'screenfull'
import combinedReducer from 'store/reducers'
import { useAppSelector, useAppDispatch } from 'store/hooks'
import playerReducer, { sliceInjectNoOp } from '../modules/player'
import playerVisualizerReducer from '../modules/playerVisualizer'
import PlayerController from '../components/PlayerController/PlayerController'
import { fetchCurrentRoom } from 'store/modules/rooms'
import styles from './PlayerView.css'

const PlayerView = () => {
  const { innerWidth, innerHeight, headerHeight } = useAppSelector(state => state.ui)
  const [isFullscreen, setFullscreen] = useState(screenfull.isFullscreen)
  const viewportHeight = Math.max(0, innerHeight - headerHeight)
  const playerHeight = isFullscreen ? innerHeight : viewportHeight
  const dispatch = useAppDispatch()

  // @todo: find better place for this?
  if (!useAppSelector(state => state.player)) {
    combinedReducer.inject({ reducerPath: 'player', reducer: playerReducer })
    combinedReducer.inject({ reducerPath: 'playerVisualizer', reducer: playerVisualizerReducer })
    dispatch(sliceInjectNoOp()) // update store with new slices
  }

  // once per mount
  useEffect(() => {
    dispatch(fetchCurrentRoom())
  }, [dispatch])

  // set page title
  useEffect(() => {
    const fullscreen = screenfull
    if (!fullscreen.isEnabled) return
    const onChange = () => setFullscreen(fullscreen.isFullscreen)
    fullscreen.on('change', onChange)
    return () => fullscreen.off('change', onChange)
  }, [])

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Karaoke Eternal | Reproductor'
    return () => {
      document.title = previousTitle
    }
  }, [])

  return (
    <div style={{ overflow: 'hidden' }}>
      <div
        id='player-fs-container'
        className={styles.container}
        style={{
          top: isFullscreen ? 0 : headerHeight,
          width: innerWidth,
          height: playerHeight,
          overflow: 'hidden',
        }}
      >
        <PlayerController
          width={innerWidth}
          height={playerHeight}
        />
      </div>
    </div>
  )
}

export default PlayerView
