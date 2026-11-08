import React from 'react'
import { birthdayLabels, type PublicBirthday } from 'shared/birthdays'
import { formatSeconds } from 'lib/dateTime'
import styles from './Birthdays.css'

export default function BirthdayQueueItem ({ event }: { event: PublicBirthday }) {
  return (
    <article className={styles.queued} data-birthday-id={event.id}>
      <strong>{`🎂 Cumpleaños de ${event.name}`}</strong>
      <span>{event.playback === 'playing' && event.phase ? birthdayLabels[event.phase] : 'Siguiente'}</span>
      <span>{formatSeconds(Math.ceil(event.durationMs / 1000))}</span>
    </article>
  )
}
