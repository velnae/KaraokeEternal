import React from 'react'
import { Link } from 'react-router'
import styles from './NoPlayer.css'

const NoPlayer = () => (
  <div className={styles.container}>
    <p className={styles.msg}>
      No hay un reproductor en la sala (
      <Link to='/player' target='_blank' replace>Iniciar reproductor</Link>
      )
    </p>
  </div>
)

export default NoPlayer
