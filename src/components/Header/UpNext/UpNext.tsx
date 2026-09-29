import React from 'react'
import clsx from 'clsx'
import { formatSeconds } from 'lib/dateTime'
import styles from './UpNext.css'

interface UpNextProps {
  isUpNow: boolean
  isUpNext: boolean
  wait?: number
}

const UpNext = (props: UpNextProps) => {
  if (props.isUpNow) {
    return (
      <div className={clsx(styles.container, styles.upNow)}>
        <p className={styles.msg}>
          Es su turno
          {' '}
          <strong>ahora</strong>
        </p>
      </div>
    )
  }

  if (props.isUpNext) {
    return (
      <div className={clsx(styles.container, styles.upNext)}>
        <p className={styles.msg}>
          Su turno es el
          {' '}
          <strong>siguiente</strong>
          {props.wait ? ` en ${formatSeconds(props.wait, true)}` : ''}
        </p>
      </div>
    )
  }

  if (props.wait) {
    return (
      <div className={clsx(styles.container, styles.inQueue)}>
        <p className={styles.msg}>
          Su turno es en
          {' '}
          {formatSeconds(props.wait, true)}
        </p>
      </div>
    )
  }

  return null
}

export default UpNext
