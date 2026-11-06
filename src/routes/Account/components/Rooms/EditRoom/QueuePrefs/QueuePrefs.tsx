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
          <div className={styles.title}>Configuración de la cola de reproducción</div>
        </div>
      )}
    >
      <div className={styles.content}>
        <NumberField
          id='queue-max-pending'
          label='Máximo de solicitudes pendientes por participante'
          description='Incluye las solicitudes por aprobar y las próximas canciones aprobadas.'
          {...QUEUE_PREF_LIMITS.maxPendingPerParticipant}
          value={queue.maxPendingPerParticipant}
          onChange={value => handleSetQueuePrefs({ maxPendingPerParticipant: value })}
        />

        <p>Los turnos equitativos atienden una canción por persona. Los pedidos nuevos se incorporan detrás de quienes esperan.</p>

        <NumberField
          id='queue-house-tracks'
          label='Máximo de canciones de la casa entre turnos'
          description='Se intercalan solo con 1–2 pedidos y menos de 10 minutos de espera. Con más demanda se atiende a los clientes. Sin pedidos, continúa la lista de la casa. Use 0 para no intercalar.'
          min={0}
          max={1}
          value={Math.min(1, queue.houseTracksBeforeParticipant)}
          onChange={value => handleSetQueuePrefs({ houseTracksBeforeParticipant: value })}
        />

        <div className={styles.field}>
          <label htmlFor='queue-approval-mode'>Modo de aprobación</label>
          <select
            id='queue-approval-mode'
            value={queue.approvalMode}
            onChange={event => handleSetQueuePrefs({ approvalMode: event.currentTarget.value as ApprovalMode })}
          >
            {APPROVAL_MODES.map(mode => <option value={mode} key={mode}>{mode === 'AUTO' ? 'Automática' : 'Manual'}</option>)}
          </select>
          <small>En modo manual, un operador debe aprobar cada solicitud antes de reproducirla.</small>
        </div>

        <div className={styles.field}>
          <label htmlFor='queue-rotation-mode'>Orden de reproducción</label>
          <select
            id='queue-rotation-mode'
            value={queue.rotationMode}
            onChange={event => handleSetQueuePrefs({ rotationMode: event.currentTarget.value as RotationMode })}
          >
            {ROTATION_MODES.map(mode => <option value={mode} key={mode}>{mode === 'FAIR' ? 'Turnos equitativos' : 'Orden de llegada'}</option>)}
          </select>
          <small>Los turnos equitativos alternan participantes; el orden de llegada sigue las solicitudes recibidas.</small>
        </div>
      </div>
    </Accordion>
  )
}

export default QueuePrefs
