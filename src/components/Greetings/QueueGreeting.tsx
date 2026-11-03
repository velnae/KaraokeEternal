import React from 'react'
import Button from 'components/Button/Button'
import { greetingLabels, greetingAudioLabels, greetingVoiceLabels, type Greeting } from 'shared/greetings'
import styles from './Greetings.css'

export default function QueueGreeting ({ greeting, paused, busy, onRemove, descriptionId }: {
  greeting: Greeting
  paused?: boolean
  busy: boolean
  onRemove?: () => void
  descriptionId?: string
}) {
  const pending = greeting.status === 'QUEUED' || greeting.status === 'RESERVED'
  const removed = greeting.status === 'REMOVED' || greeting.status === 'CANCELLED'
  const failed = greeting.status === 'SKIPPED' || greeting.status === 'INTERRUPTED'
  const canRemove = !!onRemove && (pending || greeting.status === 'DISPLAYING')
  return (
    <div className={styles.inline} role='group' aria-label='Saludo' data-greeting-id={greeting.greetingId} data-greeting-status={greeting.status}>
      <div className={styles.inlineText}>
        {removed
          ? <span className={styles.secondary}>{`Saludo ${greetingLabels[greeting.status].toLowerCase()}`}</span>
          : (
              <>
                <span className={styles.greetingLabel}>Saludo</span>
                <p translate='no'>{`${greeting.recipient ? `Para ${greeting.recipient}: ` : ''}${greeting.message}`}</p>
                {failed && greeting.reason
                  ? (
                      <details className={styles.outcome}>
                        <summary>{greetingLabels[greeting.status]}</summary>
                        <p>{greeting.reason}</p>
                      </details>
                    )
                  : !pending && <span className={styles.delivery} role='status'>{greetingLabels[greeting.status]}</span>}
                {pending && paused && <span className={styles.notice}>Saludos pausados</span>}
                {pending && greeting.audio && !greeting.playback && (
                  <div className={styles.audio} data-audio-status={greeting.audio.status}>
                    <span role='status'>{greetingAudioLabels[greeting.audio.status]}</span>
                    {greeting.audio.reason && (
                      <details className={styles.outcome}>
                        <summary>Detalle de la voz</summary>
                        <p>{greeting.audio.reason}</p>
                      </details>
                    )}
                  </div>
                )}
                {greeting.playback && (
                  <div className={styles.audio} data-voice-status={greeting.playback.status}>
                    <span role='status'>{greetingVoiceLabels[greeting.playback.status]}</span>
                    {greeting.playback.reason && <p className={styles.voiceReason}>{greeting.playback.reason}</p>}
                  </div>
                )}
              </>
            )}
      </div>
      {canRemove && <Button className={styles.remove} disabled={busy} aria-busy={busy} aria-describedby={descriptionId} onClick={onRemove}>{greeting.status === 'DISPLAYING' ? 'Retirar saludo' : 'Quitar saludo'}</Button>}
    </div>
  )
}
