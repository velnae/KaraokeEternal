import React, { useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import type { CallPart } from 'shared/karaokeCalls'
import useCallPilot from './useCallPilot'
import ListeningTemplateManager from './ListeningTemplateManager'
import PrivateCallAudio from './PrivateCallAudio'
import CallHistory from './CallHistory'
import styles from './KaraokeCallPilot.css'

export default function ListeningCallSettings ({ roomId }: { roomId: number }) {
  const { snapshot, error, busy, notice, configure, submit, refresh, unavailable } = useCallPilot(roomId)
  const [listening, setListening] = useState<CallPart | null>(null)
  const automatic = snapshot?.automation
  return (
    <section className={styles.panel} aria-label='Presentaciones para escuchar'>
      {error && <p className={styles.error} role='alert'>{error}</p>}
      {notice && <p role='status'>{notice}</p>}
      {!automatic && <p role='status'>{unavailable}</p>}
      {error && <Button onClick={() => void refresh()}>Reintentar</Button>}
      {automatic && (
        <>
          <label className={styles.switch}>
            <input
              type='checkbox'
              role='switch'
              aria-label='Presentar pedidos para escuchar'
              checked={!!automatic.controls.listeningEnabled}
              disabled={busy}
              onChange={event => void configure({ ...automatic.controls, listeningEnabled: event.target.checked })}
            />
            Presentar pedidos para escuchar
          </label>
          {(automatic.listeningMessage || automatic.message) && <p role='status' className={styles.warning}>{automatic.listeningMessage || automatic.message}</p>}
          <div className={styles.actions}>
            <Link to='/admin/settings/audio-providers?use=calls'>Ajustes de voz</Link>
            <Link to='/admin/rooms'>Voces de las mesas</Link>
          </div>
          <ListeningTemplateManager roomId={roomId} templates={automatic.listeningTemplates ?? []} unavailable={unavailable} refresh={refresh} listen={setListening} />
          <details className={styles.requestDetails}>
            <summary>{`Pedidos para escuchar (${automatic.listeningRequests?.length ?? 0})`}</summary>
            <CallHistory items={automatic.listeningRequests ?? []} kind='listening' busy={busy} canPrepare={!unavailable} submit={submit} listen={setListening} />
          </details>
        </>
      )}
      {listening && <PrivateCallAudio key={listening.id} roomId={roomId} part={listening} onClose={() => setListening(null)} />}
    </section>
  )
}
