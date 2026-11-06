import React, { useId, useState } from 'react'
import { Link } from 'react-router'
import Button from 'components/Button/Button'
import useCallPilot from 'components/Animation/useCallPilot'
import PrivateCallAudio from 'components/Animation/PrivateCallAudio'
import { callStatusLabels, type CallPart } from 'shared/karaokeCalls'
import styles from 'components/Animation/KaraokeCallPilot.css'

export default function TableVoice ({ roomId, tableId }: { roomId: number, tableId: number }) {
  const { snapshot, busy, error, notice, submit, unavailable } = useCallPilot(roomId)
  const voice = snapshot?.tables.find(item => item.tableId === tableId)
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? voice?.spokenText ?? ''
  const [listening, setListening] = useState<CallPart | null>(null)
  const id = useId()
  const latest = snapshot?.jobs.find(item => item.operation === 'table' && item.tableId === tableId)
  const pending = latest && ['queued', 'generating', 'preparing'].includes(latest.status)
  let help = unavailable || 'Generar usa Gemini. Escuchar es privado y reutiliza el archivo guardado.'
  if (!voice && !unavailable) help = 'La mesa no está activa o ya no está disponible.'
  if (pending) help = 'La voz se está preparando. Puede cerrar esta ventana y volver después.'
  if (busy) help = 'Enviando la preparación…'
  return (
    <section className={styles.panel} aria-label='Voz de la mesa'>
      <p className={styles.hint}>Prepare el fragmento de esta mesa para los llamados de karaoke.</p>
      {snapshot && <p>{`Voz actual: ${snapshot.voice.config.voice} · ${snapshot.voice.config.model}`}</p>}
      <Link to='/admin/settings/animator?view=greeting-voice'>Ver perfil compartido de Gemini</Link>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (voice) void submit(`tables/${tableId}/voice/generate`, { text, revision: voice.revision, regenerate: !!voice.part }).then((ok): void => {
            if (ok) setDraft(null)
            return undefined
          })
        }}
      >
        <label className={styles.field}>
          Texto de la mesa
          <textarea rows={2} maxLength={100} required value={text} onChange={event => setDraft(event.target.value)} />
        </label>
        <div className={styles.actions}>
          <Button type='submit' variant='primary' disabled={busy || !!pending || !!unavailable || !voice} aria-describedby={`${id}-help`}>{voice?.part ? 'Regenerar voz' : 'Generar voz'}</Button>
          {voice?.part && <Button onClick={() => setListening(voice.part!)}>Escuchar voz de mesa</Button>}
        </div>
        <p id={`${id}-help`} className={styles.hint}>{help}</p>
      </form>
      {voice?.outdated && <p className={styles.warning}>Desactualizado. Genere la voz con el texto y perfil actuales.</p>}
      {latest && <p role='status'>{`${callStatusLabels[latest.status]}${latest.error ? `: ${latest.error}` : ''}`}</p>}
      {error && <p role='alert' className={styles.error}>{error}</p>}
      {notice && <p role='status' className={styles.notice}>{notice}</p>}
      {listening && <PrivateCallAudio key={`${roomId}-${listening.id}`} roomId={roomId} part={listening} onClose={() => setListening(null)} />}
    </section>
  )
}
