import React from 'react'
import { Link } from 'react-router'
import { useAppDispatch } from 'store/hooks'
import { requestPlay, requestPlayNext } from 'store/modules/status'
import UpNow from './UpNow/UpNow'
import Icon from 'components/Icon/Icon'
import Button from 'components/Button/Button'
import type { QueueItem } from 'shared/types'
import styles from './PlayerTextOverlay.css'

interface PlayerTextOverlayProps {
  queueItem?: QueueItem
  nextQueueItem?: QueueItem
  isAtQueueEnd: boolean
  isQueueEmpty: boolean
  isErrored: boolean
  width: number
  height: number
}

const PlayerTextOverlay = ({ isQueueEmpty, isAtQueueEnd, isErrored, nextQueueItem, queueItem, width, height }: PlayerTextOverlayProps) => {
  const dispatch = useAppDispatch()
  let content

  if (isQueueEmpty || (isAtQueueEnd && !nextQueueItem)) {
    content = (
      <section className={styles.panel} role='status'>
        <Icon icon='MICROPHONE' size={48} />
        <h1>Sin canciones</h1>
        <Link to='/library' target='_blank' rel='noopener'>Buscar canciones</Link>
      </section>
    )
  } else if (!queueItem || (isAtQueueEnd && nextQueueItem)) {
    content = (
      <section className={styles.panel}>
        <p className={styles.singer} translate='no'>{nextQueueItem?.userDisplayName}</p>
        <h1 translate='no'>{nextQueueItem?.title || 'Listo para cantar'}</h1>
        <Button className={styles.playButton} icon='PLAY' onClick={() => dispatch(requestPlay())}>Reproducir</Button>
      </section>
    )
  } else if (isErrored) {
    content = (
      <section className={styles.panel} role='alert'>
        <Icon icon='ALERT_OUTLINE' size={44} />
        <h1>No se pudo reproducir</h1>
        <div className={styles.actions}>
          <Link to='/queue' target='_blank' rel='noopener'>Ver cola</Link>
          <Button className={styles.playButton} onClick={() => dispatch(requestPlayNext())}>Siguiente canción</Button>
        </div>
      </section>
    )
  } else {
    content = <UpNow queueItem={queueItem} />
  }

  return <div style={{ width, height }} className={styles.container}>{content}</div>
}

export default PlayerTextOverlay
