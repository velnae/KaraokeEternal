import React from 'react'
import Button from 'components/Button/Button'
import { callStatusLabels, type CallJob, type CallPart } from 'shared/karaokeCalls'
import styles from './KaraokeCallPilot.css'

export default function CallPreparationList ({ jobs, cancel, listen }: { jobs: CallJob[], cancel: (id: string) => Promise<void>, listen: (part: CallPart) => void }) {
  return (
    <ul className={styles.list}>
      {jobs.map(item => (
        <li className={styles.item} key={item.id}>
          <strong>{`${({ intro: 'Introducción', table: 'Voz de mesa', hybrid: 'Llamado híbrido', reference: 'Frase completa', fallback: 'Llamado básico', source: 'Voz reutilizable', compose: 'Presentación' })[item.operation]} · ${callStatusLabels[item.status]}`}</strong>
          <p translate='no'>{item.text}</p>
          {item.outdated && <p className={styles.warning}>Desactualizado: cambiaron los datos. Prepare una nueva versión.</p>}
          {item.error && <p className={styles.error} role='alert'>{item.error}</p>}
          <div className={styles.actions}>
            {item.result && <Button onClick={() => listen(item.result!)} aria-label={`Escuchar ${item.operation === 'reference' ? 'frase completa' : item.operation === 'hybrid' ? 'llamado híbrido' : item.result.title}`}>Escuchar</Button>}
            {['queued', 'generating', 'preparing'].includes(item.status) && <Button onClick={() => void cancel(item.id)}>Cancelar preparación</Button>}
            {item.status === 'ready' && !item.result && <span className={styles.hint}>Vista previa retirada del historial.</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}
