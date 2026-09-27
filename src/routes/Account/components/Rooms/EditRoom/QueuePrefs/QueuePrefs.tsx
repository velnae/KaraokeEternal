import React from 'react'
import Accordion from 'components/Accordion/Accordion'
import Icon from 'components/Icon/Icon'
import type { IRoomPrefs } from 'shared/types'
import type { ApprovalMode, QueuePrefs as QueueSettings, RotationMode } from 'shared/queueRules'
import {
  APPROVAL_MODES,
  normalizeQueuePrefs,
  QUEUE_PREF_LIMITS,
  ROTATION_MODES,
} from 'shared/queueRules'
import styles from './QueuePrefs.css'

interface QueuePrefsProps {
  prefs: Partial<IRoomPrefs>
  onChange: (prefs: Partial<IRoomPrefs>) => void
}

interface NumberFieldProps {
  description: string
  id: string
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  value: number
}

const NumberField = ({ description, id, label, max, min, onChange, value }: NumberFieldProps) => {
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const candidate = event.currentTarget.valueAsNumber
    if (!Number.isInteger(candidate)) return
    onChange(Math.min(max, Math.max(min, candidate)))
  }

  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        aria-describedby={`${id}-description`}
        id={id}
        max={max}
        min={min}
        onChange={handleChange}
        step={1}
        type='number'
        value={value}
      />
      <small id={`${id}-description`}>{description}</small>
    </div>
  )
}

const QueuePrefs = ({ onChange, prefs = {} }: QueuePrefsProps) => {
  const queue = normalizeQueuePrefs(prefs.queue)

  const handleSetQueuePrefs = (update: Partial<QueueSettings>) => {
    onChange({
      ...prefs,
      queue: {
        ...queue,
        ...update,
      },
    })
  }

  return (
    <Accordion
      headingComponent={(
        <div className={styles.heading}>
          <Icon icon='TUNE' />
          <div className={styles.title}>Queue Settings</div>
        </div>
      )}
    >
      <div className={styles.content}>
        <NumberField
          id='queue-max-pending'
          label='Maximum pending requests per participant'
          description='Includes requests awaiting approval and approved upcoming requests.'
          {...QUEUE_PREF_LIMITS.maxPendingPerParticipant}
          value={queue.maxPendingPerParticipant}
          onChange={value => handleSetQueuePrefs({ maxPendingPerParticipant: value })}
        />

        <NumberField
          id='queue-max-songs-round'
          label='Songs per participant turn'
          description='Applies to Fair rotation. FIFO always follows request order.'
          {...QUEUE_PREF_LIMITS.maxSongsPerParticipantRound}
          value={queue.maxSongsPerParticipantRound}
          onChange={value => handleSetQueuePrefs({ maxSongsPerParticipantRound: value })}
        />

        <NumberField
          id='queue-house-tracks'
          label='House tracks between participant turns'
          description='Set to 0 to disable automatic house-track interleaving.'
          {...QUEUE_PREF_LIMITS.houseTracksBeforeParticipant}
          value={queue.houseTracksBeforeParticipant}
          onChange={value => handleSetQueuePrefs({ houseTracksBeforeParticipant: value })}
        />

        <div className={styles.field}>
          <label htmlFor='queue-approval-mode'>Approval mode</label>
          <select
            id='queue-approval-mode'
            value={queue.approvalMode}
            onChange={event => handleSetQueuePrefs({ approvalMode: event.currentTarget.value as ApprovalMode })}
          >
            {APPROVAL_MODES.map(mode => <option value={mode} key={mode}>{mode === 'AUTO' ? 'Automatic' : 'Manual'}</option>)}
          </select>
          <small>Manual requests must be approved by an operator before playback.</small>
        </div>

        <div className={styles.field}>
          <label htmlFor='queue-rotation-mode'>Rotation mode</label>
          <select
            id='queue-rotation-mode'
            value={queue.rotationMode}
            onChange={event => handleSetQueuePrefs({ rotationMode: event.currentTarget.value as RotationMode })}
          >
            {ROTATION_MODES.map(mode => <option value={mode} key={mode}>{mode === 'FAIR' ? 'Fair rotation' : 'First in, first out'}</option>)}
          </select>
          <small>Fair rotation alternates participants; FIFO follows request creation order.</small>
        </div>
      </div>
    </Accordion>
  )
}

export default QueuePrefs
