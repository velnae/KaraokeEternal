import React from 'react'
import { Link } from 'react-router'
import { useAppSelector } from 'store/hooks'
import Icon from 'components/Icon/Icon'
import styles from './NoPlayer.css'
import RemotePlayerControls from '../RemotePlayerControls'

const NoPlayer = ({ remoteControls = true }: { remoteControls?: boolean }) => {
  const roomName = useAppSelector(state => state.rooms.entities[state.user.roomId]?.name)
  return (
    <div className={styles.container}>
      <div className={styles.context}>
        <strong translate='no'>{roomName || 'Sala'}</strong>
        <span>Sin reproductor</span>
      </div>
      <div className={styles.actions}>
        <Link to='/player' target='_blank' rel='noopener' className={styles.launch}>
          <Icon icon='TELEVISION_PLAY' size={22} />
          Abrir reproductor
        </Link>
        {remoteControls && <RemotePlayerControls available={false} />}
      </div>
    </div>
  )
}

export default NoPlayer
