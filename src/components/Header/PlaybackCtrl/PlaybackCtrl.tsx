import React, { useState } from 'react'
import { useAppDispatch, useAppSelector } from 'store/hooks'
import { Link, useLocation } from 'react-router'
import clsx from 'clsx'
import screenfull from 'screenfull'
import { requestOptions, requestPause, requestPlay, requestPlayNext, requestVolume } from 'store/modules/status'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import VolumeSlider from './VolumeSlider/VolumeSlider'
import NoPlayer from './NoPlayer/NoPlayer'
import DisplayCtrl from './DisplayCtrl/DisplayCtrl'
import styles from './PlaybackCtrl.css'
import { PlaybackOptions } from 'shared/types'

const handleFullscreen = () => {
  if (screenfull.isEnabled) {
    const el = document.getElementById('player-fs-container')
    screenfull.request(el)
  }
}

const PlaybackCtrl = () => {
  const [isDisplayCtrlVisible, setDisplayCtrlVisible] = useState(false)
  const location = useLocation()
  const isPlayer = location.pathname.replace(/\/$/, '').endsWith('/player')

  const isAdmin = useAppSelector(state => state.user.isAdmin)
  const isInRoom = useAppSelector(state => state.user.roomId !== null)
  const roomName = useAppSelector(state => state.rooms.entities[state.user.roomId]?.name)
  const status = useAppSelector(state => state.status)

  const dispatch = useAppDispatch()
  const handleOptions = (opts: PlaybackOptions) => dispatch(requestOptions(opts))
  const handlePause = () => dispatch(requestPause())
  const handlePlay = () => dispatch(requestPlay())
  const handlePlayNext = () => dispatch(requestPlayNext())
  const handleVolume = (val: number) => dispatch(requestVolume(val))

  const toggleDisplayCtrl = () => {
    setDisplayCtrlVisible(!isDisplayCtrlVisible)
  }

  if (!status.isPlayerPresent) {
    return (isAdmin && isInRoom) ? <NoPlayer /> : null
  }

  return (
    <div className={styles.container} role='toolbar' aria-label='Controles de reproducción'>
      <div className={styles.context}>
        {isPlayer && <Link to='/queue' className={styles.back} aria-label='Volver a la cola'><Icon icon='CHEVRON_LEFT' size={24} /></Link>}
        <div>
          <strong translate='no'>{roomName || 'Reproductor'}</strong>
          <span>{status.isAtQueueEnd || status.queueId < 0 ? 'En espera' : status.isPlaying ? 'Reproduciendo' : 'En pausa'}</span>
        </div>
      </div>
      <div className={styles.transport}>
        <Button
          className={clsx(styles.btn, status.isPlaying ? styles.pause : styles.play)}
          icon={status.isPlaying ? 'PAUSE' : 'PLAY'}
          onClick={status.isPlaying ? handlePause : handlePlay}
          aria-label={status.isPlaying ? 'Pausar' : 'Reproducir'}
        />

        <Button
          className={clsx(styles.btn, styles.next)}
          icon='PLAY_NEXT'
          onClick={handlePlayNext}
          aria-label='Reproducir siguiente canción'
        />
      </div>

      <div className={styles.volume}>
        <VolumeSlider
          volume={status.volume}
          onVolumeChange={handleVolume}
        />
        <output aria-label='Nivel de volumen'>{`${Math.round(status.volume * 100)}%`}</output>
      </div>

      <div className={styles.viewActions}>
        <Button
          className={clsx(styles.btn, styles.displayCtrl)}
          icon='TUNE'
          onClick={toggleDisplayCtrl}
          size={24}
          aria-label='Opciones de pantalla'
          aria-expanded={isDisplayCtrlVisible}
        />

        {isPlayer && screenfull.isEnabled && (
          <Button
            className={clsx(styles.btn, styles.fullscreen)}
            icon='FULLSCREEN'
            onClick={handleFullscreen}
            aria-label='Activar pantalla completa'
          />
        )}
      </div>

      {isDisplayCtrlVisible && (
        <DisplayCtrl
          cdgAlpha={status.cdgAlpha}
          cdgSize={status.cdgSize}
          isVideoKeyingEnabled={status.isVideoKeyingEnabled}
          isVisualizerEnabled={status.visualizer.isEnabled}
          isWebGLSupported={status.isWebGLSupported}
          mediaType={status.mediaType}
          mp4Alpha={status.mp4Alpha}
          onClose={toggleDisplayCtrl}
          onRequestOptions={handleOptions}
          sensitivity={status.visualizer.sensitivity}
          visualizerPresetName={status.visualizer.presetName}
        />
      )}
    </div>
  )
}

export default PlaybackCtrl
