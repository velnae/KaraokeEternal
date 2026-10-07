import React from 'react'
import { Link } from 'react-router'
import { useAppSelector } from 'store/hooks'
import Icon from 'components/Icon/Icon'
import styles from './NoPlayer.css'

const NoPlayer = () => {
  const roomName = useAppSelector(state => state.rooms.entities[state.user.roomId]?.name)
  return (
    <div className={styles.container}>
      <div className={styles.context}>
        <strong translate='no'>{roomName || 'Sala'}</strong>
        <span>Sin reproductor</span>
      </div>
      <Link to='/player' target='_blank' rel='noopener' className={styles.launch}>
        <Icon icon='TELEVISION_PLAY' size={22} />
        Abrir reproductor
      </Link>
    </div>
  )
}

export default NoPlayer
