import React, { useId, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import { callContinuation, callStatusLabels, type CallPart } from 'shared/karaokeCalls'
import useCallPilot from './useCallPilot'
import PrivateCallAudio from './PrivateCallAudio'
import styles from './KaraokeCallPilot.css'
import AutomaticCallControls from './AutomaticCallControls'
import ListeningTemplateManager from './ListeningTemplateManager'

export default function KaraokeCallPilot ({ roomId }: { roomId: number }) {
  const { snapshot, error, busy, notice, submit, cancel, configure, refresh, unavailable } = useCallPilot(roomId)
  const id = useId()
  const [introTitle, setIntroTitle] = useState('Vamos con el karaoke')
  const [introText, setIntroText] = useState('¡Vamos con el karaoke!')
  const [editing, setEditing] = useState<CallPart | null>(null)
  const [introId, setIntroId] = useState('')
  const [tableId, setTableId] = useState('')
  const [performer, setPerformer] = useState('')
  const [song, setSong] = useState('')
  const [mode, setMode] = useState<'hybrid' | 'reference'>('hybrid')
  const [listening, setListening] = useState<CallPart | null>(null)
  const intro = snapshot?.intros.find(item => item.id === introId && item.profileKey === snapshot.profileKey)
  const table = snapshot?.tables.find(item => String(item.tableId) === tableId)
  let transcript = ''
  let reason = unavailable
  try {
    if (!intro) reason ||= 'Seleccione una introducción disponible con la voz actual.'
    else if (!table?.part || table.outdated) reason ||= 'Prepare la voz de la mesa en Salas y mesas.'
    else if (!performer.trim() || !song.trim()) reason ||= 'Ingrese cantante y canción para preparar la prueba.'
    else {
      transcript = `${intro.text} ${table.part.text} ${callContinuation(performer, song)}`
      if ([...transcript].length > 220) reason ||= 'Acorte el texto: el llamado completo admite hasta 220 caracteres.'
    }
  } catch (err) { reason ||= (err as Error).message }
  return (
    <section className={styles.panel} aria-label='Llamados de karaoke'>
      <header className={styles.heading}>
        <h2>Llamados de karaoke</h2>
        <p>Configure los llamados automáticos y pruebe las voces en privado.</p>
      </header>
      {snapshot && <AutomaticCallControls snapshot={snapshot} busy={busy} configure={configure} submit={submit} listen={setListening} />}
      <div className={styles.profile}>
        <strong>{snapshot ? `Voz de Gemini: ${snapshot.voice.config.voice}` : 'Cargando perfil…'}</strong>
        {snapshot && <p>{snapshot.voice.config.model}</p>}
        <p>Introducción, mesa y presentación comparten el perfil de Gemini y sus límites de generación.</p>
        <Link to='?view=greeting-voice'>Ver ajustes de voz</Link>
        {unavailable && <p className={styles.warning} role='status'>{unavailable}</p>}
      </div>
      {error && <p className={styles.error} role='alert'>{error}</p>}
      {notice && <p className={styles.notice} role='status'>{notice}</p>}
      {snapshot?.automation && (
        <ListeningTemplateManager
          key={roomId}
          roomId={roomId}
          templates={snapshot.automation.listeningTemplates ?? []}
          unavailable={unavailable}
          refresh={refresh}
          listen={setListening}
        />
      )}
      <section className={styles.section} aria-labelledby={`${id}-intros`}>
        <h3 id={`${id}-intros`}>Introducciones para cantar</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit('karaoke-calls/intros', { title: introTitle, text: introText, ...(editing ? { previousId: editing.id, regenerate: true } : {}) }).then((ok): void => {
              if (ok) setEditing(null)
              return undefined
            })
          }}
        >
          <label className={styles.field}>
            Nombre de la introducción
            <input value={introTitle} maxLength={80} onChange={event => setIntroTitle(event.target.value)} required />
          </label>
          <label className={styles.field}>
            Texto de introducción
            <textarea value={introText} maxLength={100} onChange={event => setIntroText(event.target.value)} required rows={2} />
          </label>
          <div className={styles.actions}>
            <Button type='submit' variant='primary' disabled={busy || !!unavailable} aria-describedby={`${id}-intro-help`}>{editing ? 'Regenerar introducción' : 'Generar introducción'}</Button>
            {editing && <Button onClick={() => setEditing(null)}>Cancelar edición</Button>}
          </div>
          <p className={styles.hint} id={`${id}-intro-help`}>{busy ? 'Enviando la preparación…' : unavailable || 'Generar consume una solicitud de Gemini. Escuchar reutiliza el audio guardado.'}</p>
        </form>
        <ul className={styles.list}>
          {snapshot?.intros.map(item => (
            <li className={styles.item} key={item.id}>
              <strong>{item.title}</strong>
              <p translate='no'>{item.text}</p>
              <p className={styles.hint}>{`${(item.durationMs / 1000).toFixed(1)} s${item.profileKey !== snapshot.profileKey ? ' · Desactualizado: cambió el perfil de voz' : ''}`}</p>
              <div className={styles.actions}>
                <Button onClick={() => setListening(item)} aria-label={`Escuchar ${item.title}`}>Escuchar</Button>
                <Button onClick={() => {
                  setEditing(item)
                  setIntroTitle(item.title)
                  setIntroText(item.text)
                }}
                >
                  Editar introducción
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className={styles.section} aria-labelledby={`${id}-test`}>
        <h3 id={`${id}-test`}>Probar llamado</h3>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit('karaoke-calls/previews', { introId, tableId: Number(tableId), performer, song, mode })
          }}
        >
          <div className={styles.grid}>
            <label className={styles.field}>
              Introducción
              <select aria-label='Introducción' value={introId} onChange={event => setIntroId(event.target.value)} required>
                <option value=''>Seleccione una introducción</option>
                {snapshot?.intros.filter(item => item.profileKey === snapshot.profileKey).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              Mesa
              <select aria-label='Mesa' value={tableId} onChange={event => setTableId(event.target.value)} required>
                <option value=''>Seleccione una mesa</option>
                {snapshot?.tables.map(item => <option key={item.tableId} value={item.tableId}>{`Mesa ${item.code}${!item.part || item.outdated ? ' — preparar voz' : ''}`}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              Cantante
              <input value={performer} onChange={event => setPerformer(event.target.value)} maxLength={60} required />
            </label>
            <label className={styles.field}>
              Canción
              <input value={song} onChange={event => setSong(event.target.value)} maxLength={140} required />
            </label>
          </div>
          <Link to='/admin/rooms'>Preparar voces en Salas y mesas</Link>
          <label className={styles.field}>
            Tipo de prueba
            <select aria-label='Tipo de prueba' value={mode} onChange={event => setMode(event.target.value as 'hybrid' | 'reference')}>
              <option value='hybrid'>Híbrido: introducción + mesa + presentación</option>
              <option value='reference'>Referencia: frase completa con Gemini</option>
            </select>
          </label>
          {transcript && <p className={styles.transcript} translate='no'>{transcript}</p>}
          <Button type='submit' variant='primary' disabled={busy || !!reason} aria-describedby={`${id}-test-help`}>Preparar prueba</Button>
          <p className={styles.hint} id={`${id}-test-help`}>{busy ? 'Enviando la preparación…' : reason || 'La prueba queda guardada para comparar. El audio completo debe durar como máximo 10 segundos.'}</p>
        </form>
      </section>
      {listening && <PrivateCallAudio key={`${roomId}-${listening.id}`} roomId={roomId} part={listening} onClose={() => setListening(null)} />}
      <section className={styles.section} aria-labelledby={`${id}-results`}>
        <h3 id={`${id}-results`}>Preparaciones recientes</h3>
        {snapshot && !snapshot.jobs.length && <p className={styles.hint}>Genere una introducción para comenzar.</p>}
        <ul className={styles.list}>
          {snapshot?.jobs.map(item => (
            <li className={styles.item} key={item.id}>
              <strong>{`${({ intro: 'Introducción', table: 'Voz de mesa', hybrid: 'Llamado híbrido', reference: 'Frase completa', fallback: 'Llamado básico', source: 'Voz reutilizable', compose: 'Presentación' })[item.operation]} · ${callStatusLabels[item.status]}`}</strong>
              <p translate='no'>{item.text}</p>
              {item.outdated && <p className={styles.warning}>Desactualizado: cambiaron los datos o el perfil. Prepare una nueva versión.</p>}
              {item.error && <p className={styles.error}>{item.error}</p>}
              <small>{`Gemini: ${(item.providerMs / 1000).toFixed(1)} s · Preparación: ${(item.preparationMs / 1000).toFixed(1)} s${item.result ? ` · Audio: ${(item.result.durationMs / 1000).toFixed(1)} s` : ''}`}</small>
              <div className={styles.actions}>
                {item.result && <Button onClick={() => setListening(item.result!)} aria-label={`Escuchar ${item.operation === 'reference' ? 'frase completa' : item.operation === 'hybrid' ? 'llamado híbrido' : item.result.title}`}>Escuchar</Button>}
                {['queued', 'generating', 'preparing'].includes(item.status) && <Button onClick={() => void cancel(item.id)}>Cancelar preparación</Button>}
                {item.status === 'ready' && !item.result && <span className={styles.hint}>Vista previa retirada del historial.</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
