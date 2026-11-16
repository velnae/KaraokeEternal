import React from 'react'
import styles from './KaraokeCountdown.css'

export default function KaraokeCountdown ({ seconds }: { seconds: number }) {
  return (
    <div className={styles.overlay} aria-label='Cuenta regresiva de karaoke' role='status' aria-live='polite' aria-atomic='true'>
      <div className={styles.disc} key={seconds} data-last={seconds <= 1}>
        <span>{Math.max(1, seconds)}</span>
      </div>
    </div>
  )
}
