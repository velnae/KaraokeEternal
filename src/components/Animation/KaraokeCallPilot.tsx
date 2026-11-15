import React, { useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import Button from 'components/Button/Button'
import type { CallPart } from 'shared/karaokeCalls'
import useCallPilot from './useCallPilot'
import PrivateCallAudio from './PrivateCallAudio'
import AutomaticCallControls from './AutomaticCallControls'
import CallHistory from './CallHistory'
import CallPreparationList from './CallPreparationList'
import useKaraokeBackgrounds from './useKaraokeBackgrounds'
import KaraokeBackgroundSettings from './KaraokeBackgroundSettings'
import KaraokeCallPreview from './KaraokeCallPreview'
import styles from './KaraokeCallPilot.css'
import adminStyles from 'components/Admin/Admin.css'

export default function KaraokeCallPilot ({ roomId }: { roomId: number }) {
  const { snapshot, error, busy, notice, submit, cancel, configure, refresh, unavailable } = useCallPilot(roomId)
  const backgrounds = useKaraokeBackgrounds(roomId)
  const [params] = useSearchParams()
  const settings = params.get('view') === 'settings'
  const id = useId()
  const [preview, setPreview] = useState(false)
  const previewOpener = useRef<HTMLElement | null>(null)
  const [introTitle, setIntroTitle] = useState('Vamos con el karaoke')
  const [introText, setIntroText] = useState('¡Vamos con el karaoke!')
  const [editing, setEditing] = useState<CallPart | null>(null)
  const [listening, setListening] = useState<CallPart | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const controls = snapshot?.automation?.controls
  const audio = listening && <PrivateCallAudio key={`${roomId}-${listening.id}`} roomId={roomId} part={listening} onClose={() => setListening(null)} />
  const feedback = (
    <>
      {error && <p className={styles.error} role='alert'>{error}</p>}
      {notice && <p className={styles.notice} role='status'>{notice}</p>}
    </>
  )
  return (
    <section className={styles.panel} aria-label='Llamados de karaoke'>
      <nav className={adminStyles.tabs} aria-label='Secciones de karaoke'>
        <Link to='?view=history' aria-current={!settings ? 'page' : undefined}>Historial</Link>
        <Link to='?view=settings' aria-current={settings ? 'page' : undefined}>Configuración</Link>
      </nav>
      {!preview && feedback}
      {!snapshot && <p role='status'>{unavailable}</p>}
      {error && !preview && <Button onClick={() => void refresh()}>Reintentar</Button>}
      {!settings && snapshot && <CallHistory items={snapshot.automation?.requests ?? []} kind='singing' busy={busy} canPrepare={!unavailable && !!controls?.enabled} submit={submit} listen={setListening} />}
      {settings && (
        <>
          <Button
            onClick={(event) => {
              previewOpener.current = event.currentTarget
              setListening(null)
              setPreview(true)
            }}
          >
            Previsualizar llamado
          </Button>
          {snapshot && <AutomaticCallControls snapshot={snapshot} busy={busy} configure={configure} submit={submit} />}
          <section className={styles.section} aria-labelledby={`${id}-intros`}>
            <div className={styles.templateHeading}>
              <h3 id={`${id}-intros`}>Introducciones para cantar</h3>
              {!!controls?.introIds.length && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setSelectionError('')
                    void configure({ ...controls, introIds: [] })
                  }}
                >
                  Usar todas
                </Button>
              )}
            </div>
            {selectionError && <p className={styles.warning} role='alert'>{selectionError}</p>}
            <ul className={styles.list}>
              {snapshot?.intros.map(item => (
                <li className={styles.item} key={item.id}>
                  <label className={styles.switch}>
                    <input
                      type='checkbox'
                      aria-label={`Usar ${item.title}`}
                      disabled={busy || !controls}
                      checked={!!controls && (!controls.introIds.length || controls.introIds.includes(item.variantId))}
                      onChange={(event) => {
                        if (!controls) return
                        const active = controls.introIds.length ? controls.introIds : snapshot.intros.map(value => value.variantId)
                        const introIds = event.target.checked ? [...active, item.variantId] : active.filter(value => value !== item.variantId)
                        if (!introIds.length) {
                          setSelectionError('Mantenga al menos una introducción activa.')
                          return
                        }
                        setSelectionError('')
                        void configure({ ...controls, introIds })
                      }}
                    />
                    <strong>{item.title}</strong>
                  </label>
                  <p translate='no'>{item.text}</p>
                  <div className={styles.actions}>
                    <Button onClick={() => setListening(item)} aria-label={`Escuchar ${item.title}`}>Escuchar</Button>
                    <Button
                      onClick={() => {
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
            {snapshot && !snapshot.intros.length && <p>Agregue una introducción o prepare las plantillas de la sala.</p>}
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
                <Button type='submit' variant='primary' disabled={busy || !!unavailable} aria-describedby={unavailable ? `${id}-intro-help` : undefined}>{editing ? 'Regenerar introducción' : 'Generar introducción'}</Button>
                {editing && <Button onClick={() => setEditing(null)}>Cancelar edición</Button>}
              </div>
              {unavailable && (
                <p className={styles.warning} id={`${id}-intro-help`}>
                  {unavailable}
                  {' '}
                  <Link to='/admin/settings/audio-providers?use=calls'>Revisar voz</Link>
                </p>
              )}
            </form>
          </section>
          <KaraokeBackgroundSettings state={backgrounds} />
          <details className={styles.requestDetails}>
            <summary>Preparaciones de recursos</summary>
            <CallPreparationList jobs={snapshot?.jobs.filter(item => item.operation !== 'hybrid' && item.operation !== 'reference') ?? []} cancel={cancel} listen={setListening} />
          </details>
          <div className={styles.actions}><Link to='/admin/settings/animator?view=names'>Gestionar nombres</Link></div>
        </>
      )}
      {!preview && audio}
      {preview && (
        <KaraokeCallPreview
          roomId={roomId}
          snapshot={snapshot}
          backgrounds={backgrounds.overview}
          unavailable={unavailable}
          refresh={refresh}
          cancel={cancel}
          onClose={() => {
            setListening(null)
            setPreview(false)
            requestAnimationFrame(() => previewOpener.current?.focus())
          }}
        />
      )}
    </section>
  )
}
