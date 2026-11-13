import React from 'react'
import { Link } from 'react-router'
import useGreetings from 'components/Greetings/useGreetings'
import GreetingPlaybackControls from 'components/Greetings/GreetingPlaybackControls'
import styles from './GreetingVoiceSettings.css'

export default function GreetingRoomSettings () {
  const greetings = useGreetings()
  return (
    <section className={styles.panel} aria-label='Saludos de esta sala'>
      <header className={styles.heading}>
        <h2>Saludos</h2>
        <Link to='/admin/settings/audio-providers?use=greetings'>Configurar voz</Link>
      </header>
      <div className={styles.preparation}>
        <h3>Preparación de saludos en esta sala</h3>
        <label className={styles.check}>
          <input type='checkbox' checked={greetings.snapshot?.audioEnabled ?? false} disabled={!greetings.snapshot || greetings.busy} onChange={event => void greetings.execute('prepareAudio', { enabled: event.target.checked })} />
          Preparar voz mientras los pedidos esperan
        </label>
        {(!greetings.snapshot || greetings.busy) && <p role='status'>{greetings.busy ? 'Esperando la confirmación del servidor…' : 'Conectando con la sala…'}</p>}
        {greetings.error && <p className={styles.error} role='alert'>{greetings.error}</p>}
      </div>
      <GreetingPlaybackControls snapshot={greetings.snapshot} busy={greetings.busy} save={(settings, version) => void greetings.execute('playback', { settings, version })} />
    </section>
  )
}
