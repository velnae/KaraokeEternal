import React, { useState, useEffect, useRef } from 'react'
import type { DisplayCorner } from 'shared/playerDisplay'
import { CSSTransition } from 'react-transition-group'
import PlayerAvatar from '../../PlayerAvatar'
import type { QueueItem } from 'shared/types'
import styles from './UpNow.css'

interface UpNowProps {
  queueItem: QueueItem
  placement?: { position: DisplayCorner, maxWidth: number }
}

const UpNow = ({ queueItem, placement }: UpNowProps) => {
  const [show, setShow] = useState(false)
  const timeoutID = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (timeoutID.current) {
      clearTimeout(timeoutID.current)
    }

    requestAnimationFrame(() => {
      setShow(true)
    })

    timeoutID.current = setTimeout(() => {
      setShow(false)
    }, 5000)

    // Cleanup the timeout when component unmounts or queueItem changes
    return () => {
      if (timeoutID.current) {
        clearTimeout(timeoutID.current)
      }
    }
  }, [queueItem.queueId])

  return (
    <CSSTransition
      nodeRef={nodeRef}
      in={show}
      timeout={500}
      classNames={{
        enterActive: styles.enterActive,
        enterDone: styles.enterDone,
        exitActive: styles.exitActive,
      }}
    >
      <div ref={nodeRef} className={styles.container} data-position={placement?.position ?? 'top-right'} style={{ maxWidth: placement?.maxWidth }} translate='no'>
        <div className={styles.innerContainer} data-listening={queueItem.origin === 'PARTICIPANT' && queueItem.requestIntent === 'LISTEN'}>
          {queueItem.origin === 'PARTICIPANT' && <PlayerAvatar src={queueItem.userAvatarUrl} light={queueItem.requestIntent === 'LISTEN'} className={styles.userImage} />}
          <div className={styles.user}>
            <small>{queueItem.origin === 'HOUSE' ? 'Música de la casa' : queueItem.requestIntent === 'SING' ? 'Karaoke' : 'Pedido musical'}</small>
            {queueItem.origin !== 'HOUSE' && queueItem.userDisplayName}
            {queueItem.origin !== 'HOUSE' && queueItem.tableLabelSnapshot && <small>{queueItem.tableLabelSnapshot}</small>}
          </div>
        </div>
      </div>
    </CSSTransition>
  )
}

export default UpNow
