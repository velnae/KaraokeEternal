import React, { useEffect, useRef } from 'react'
import { useAppSelector } from 'store/hooks'
import { ensureState } from 'redux-optimistic-ui'
import { Link } from 'react-router'
import getRoundRobinQueue from '../selectors/getRoundRobinQueue'
import QueueList from '../components/QueueList/QueueList'
import Spinner from 'components/Spinner/Spinner'
import TextOverlay from 'components/TextOverlay/TextOverlay'
import styles from './QueueView.css'

const QueueView = () => {
  const { innerWidth, innerHeight, headerHeight, footerHeight } = useAppSelector(state => state.ui)
  const isInRoom = useAppSelector(state => !!state.user.roomId)
  const isLoading = useAppSelector(state => ensureState(state.queue).isLoading)
  const queue = useAppSelector(getRoundRobinQueue)
  const rawQueue = useAppSelector(state => ensureState(state.queue))
  const queueId = useAppSelector(state => state.status.queueId)
  const user = useAppSelector(state => state.user)
  const containerRef = useRef<HTMLDivElement>(null)
  const initialScrollDone = useRef(false)

  // ensure current song is in view on first mount only
  useEffect(() => {
    if (initialScrollDone.current || isLoading) return
    const current = containerRef.current?.querySelector<HTMLElement>(`[data-queue-id="${queueId}"]`)
    if (!current) return
    current.scrollIntoView({ block: 'nearest' })
    initialScrollDone.current = true
  }, [queueId, isLoading])

  return (
    <div
      className={styles.container}
      ref={containerRef}
      style={{
        paddingTop: headerHeight,
        paddingBottom: footerHeight + 32,
        scrollPaddingTop: headerHeight + 16,
        scrollPaddingBottom: footerHeight + 32,
        width: innerWidth,
        height: innerHeight,
      }}
    >
      {!isInRoom && (
        <TextOverlay>
          <h1>Entre a una sala</h1>
          <p>
            <Link to='/account'>Inicie sesión en una sala</Link>
            {' '}
            para agregar canciones a la cola de reproducción.
          </p>
        </TextOverlay>
      )}

      {isLoading && <Spinner />}

      {!isLoading && queue.result.length === 0 && !rawQueue.result.some((queuedId) => {
        const item = rawQueue.entities[queuedId]
        return item.isOptimistic !== true && (
          (user.isAdmin && item.status === 'PENDING_APPROVAL')
          || (item.userId === user.userId && ['PENDING_APPROVAL', 'REJECTED'].includes(item.status))
        )
      }) && (
        <TextOverlay>
          <h1>La cola de reproducción está vacía</h1>
          <p>
            Seleccione una canción de la
            {' '}
            <Link to='/library'>biblioteca</Link>
            {' '}
            para agregarla a la cola de reproducción.
          </p>
        </TextOverlay>
      )}

      <QueueList />
    </div>
  )
}

export default QueueView
