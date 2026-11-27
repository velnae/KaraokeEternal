import React from 'react'
import clsx from 'clsx'
import { Link } from 'react-router'
import { useAppSelector } from 'store/hooks'
import Icon from 'components/Icon/Icon'
import styles from './NoPlayer.css'
import RemotePlayerControls from '../RemotePlayerControls'

const NoPlayer = ({ iconOnly = false, remoteControls = true, children }: { iconOnly?: boolean, remoteControls?: boolean, children?: React.ReactNode }) => {
  const roomName = useAppSelector(state => state.rooms.entities[state.user.roomId]?.name)
  return (
    <div className={styles.container}>
      <div className={styles.context}>
        <strong translate='no'>{roomName || 'Sala'}</strong>
        <span>Sin reproductor</span>
      </div>
      <div className={styles.actions}>
        {children}
        <Link to='/player' target='_blank' rel='noopener' className={clsx(styles.launch, iconOnly && styles.iconOnly)} aria-label='Abrir reproductor'>
          <Icon icon='TELEVISION_PLAY' size={18} />
          {!iconOnly && 'Abrir reproductor'}
        </Link>
        {remoteControls && <RemotePlayerControls available={false} />}
      </div>
    </div>
  )
}

export default NoPlayer
