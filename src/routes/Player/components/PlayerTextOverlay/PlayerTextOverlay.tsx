import React from 'react'
import UpNow from './UpNow/UpNow'
import Icon from 'components/Icon/Icon'
import type { QueueItem } from 'shared/types'
import type { DisplayCorner } from 'shared/playerDisplay'
import styles from './PlayerTextOverlay.css'

interface PlayerTextOverlayProps {
  queueItem?: QueueItem
  nextQueueItem?: QueueItem
  isAtQueueEnd: boolean
  isQueueEmpty: boolean
  isErrored: boolean
  width: number
  height: number
  turnPlacement?: { position: DisplayCorner, maxWidth: number }
}

const PlayerTextOverlay = ({ isQueueEmpty, isAtQueueEnd, isErrored, nextQueueItem, queueItem, width, height, turnPlacement }: PlayerTextOverlayProps) => {
  let content

  if (isQueueEmpty || (isAtQueueEnd && !nextQueueItem)) {
    content = (
      <section className={styles.panel} role='status'>
        <Icon icon='MICROPHONE' size={48} />
        <h1>Sin canciones</h1>
      </section>
    )
  } else if (!queueItem || (isAtQueueEnd && nextQueueItem)) {
    content = (
      <section className={styles.panel}>
        <p className={styles.singer} translate='no'>{nextQueueItem?.userDisplayName}</p>
        <h1 translate='no'>{nextQueueItem?.title || 'Listo para cantar'}</h1>
      </section>
    )
  } else if (isErrored) {
    content = (
      <section className={styles.panel} role='alert'>
        <Icon icon='ALERT_OUTLINE' size={44} />
        <h1>No se pudo reproducir</h1>
        <p>Revise la canción desde la cola.</p>
      </section>
    )
  } else {
    content = <UpNow queueItem={queueItem} placement={turnPlacement} />
  }

  return <div style={{ width, height }} className={styles.container}>{content}</div>
}

export default PlayerTextOverlay
