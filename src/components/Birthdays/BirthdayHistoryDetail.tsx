import React, { useEffect, useRef, useState } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import { approachLabels } from 'shared/birthdays'
import { birthdayOutcome, birthdayOutcomeLabels, type BirthdayHistoryDetail as Detail } from 'shared/birthdayHistory'
import { birthdayApi, birthdayUrl } from './api'
import { birthdayDate, birthdayDuration } from './historyFormatting'
import styles from './BirthdayHistory.css'

export default function BirthdayHistoryDetail ({ id, listen, onClose }: { id: string, listen: boolean, onClose(): void }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [audioError, setAudioError] = useState('')
  const [reload, setReload] = useState(0)
  const audio = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    let live = true
    const controller = new AbortController()
    void birthdayApi.get<Detail>(`history/${encodeURIComponent(id)}`, { signal: controller.signal }).then((value): void => {
      if (live) {
        setDetail(value)
        setError('')
      }
      return undefined
    }).catch((failure) => { if (live) setError(failure.message) })
    return () => {
      live = false
      controller.abort()
    }
  }, [id, reload])
  const context = detail?.personalization
  const greeting = detail?.assets.find(item => item.kind === 'greeting')
  useEffect(() => {
    const element = audio.current
    return () => element?.pause()
  }, [greeting?.id, reload])
  return (
    <Modal title={detail ? `Cumpleaños de ${detail.name}` : 'Detalle de cumpleaños'} className={styles.dialog} scrollable onClose={onClose}>
      {error && (
        <div role='alert'>
          <p>{error}</p>
          <Button onClick={() => {
            setReload(value => value + 1)
          }}
          >
            Recargar detalle
          </Button>
        </div>
      )}
      {!detail && !error && <p role='status'>Cargando cumpleaños…</p>}
      {detail && (
        <div className={styles.detail}>
          <div className={styles.summary}>
            <span>{birthdayDate(detail.createdAt)}</span>
            <strong>{birthdayOutcomeLabels[birthdayOutcome(detail)]}</strong>
            <span>{`Versión ${detail.generationRevision + 1}`}</span>
          </div>
          {detail.error && <p role='alert'>{detail.error}</p>}
          <section aria-label='Saludo generado'>
            <h2>Saludo</h2>
            {greeting
              ? (
                  <>
                    <audio ref={audio} key={`${greeting.id}:${reload}`} controls autoPlay={listen} preload='metadata' src={birthdayUrl(greeting.url)} onLoadedMetadata={() => setAudioError('')} onError={() => setAudioError('No se pudo abrir el audio guardado.')} />
                    <p className={styles.muted}>{`${birthdayDuration(greeting.durationMs)} · Escucha en este dispositivo`}</p>
                  </>
                )
              : <p>No hay audio preparado para esta versión.</p>}
            {audioError && (
              <div role='alert'>
                <p>{audioError}</p>
                <Button onClick={() => {
                  setAudioError('')
                  setReload(value => value + 1)
                }}
                >
                  Reintentar audio
                </Button>
              </div>
            )}
            <p className={styles.script}>{detail.script || 'No se guardó un texto para este evento.'}</p>
          </section>
          <section aria-label='Personalización del saludo'>
            <h2>Personalización</h2>
            <dl className={styles.metadata}>
              <dt>Año de nacimiento</dt>
              <dd>{detail.birthYear}</dd>
              <dt>Edad en la celebración</dt>
              <dd>{detail.celebrationYear - detail.birthYear}</dd>
              <dt>Sexo registrado</dt>
              <dd>{{ female: 'Femenino', male: 'Masculino', unspecified: 'Sin especificar' }[detail.sex]}</dd>
              <dt>Perfil</dt>
              <dd>{context?.profile.title || 'No registrado'}</dd>
              <dt>Enfoque</dt>
              <dd>{context ? approachLabels[context.approach] : 'No registrado'}</dd>
              <dt>Voz</dt>
              <dd>{context?.speech.voice || detail.voiceId}</dd>
              <dt>Interpretación</dt>
              <dd>{context?.speech.style || 'No registrada'}</dd>
              <dt>Dedicatoria</dt>
              <dd>{context?.dedication || 'Sin dedicatoria'}</dd>
            </dl>
            {context?.reference && (
              <div>
                <h3>Referencia histórica</h3>
                <p>{context.reference.phrase}</p>
                <a href={context.reference.source} target='_blank' rel='noreferrer'>Consultar fuente</a>
              </div>
            )}
          </section>
          <details className={styles.technical}>
            <summary>Datos técnicos y recursos</summary>
            <dl className={styles.metadata}>
              <dt>Identificador</dt>
              <dd>{detail.id}</dd>
              <dt>Inicio de reproducción</dt>
              <dd>{birthdayDate(detail.startedAt)}</dd>
              <dt>Modelo de texto</dt>
              <dd>{detail.generationSettings.textModel}</dd>
              <dt>Proveedor de voz</dt>
              <dd>{context?.speech.provider || 'ElevenLabs (configuración anterior)'}</dd>
              <dt>Modelo de voz</dt>
              <dd>{context?.speech.model || 'No registrado'}</dd>
              <dt>Duración del evento</dt>
              <dd>{birthdayDuration(detail.durationMs)}</dd>
              <dt>Duración objetivo del saludo</dt>
              <dd>{`${detail.generationSettings.targetSeconds} s`}</dd>
              <dt>Selección de introducción</dt>
              <dd>{detail.scene ? detail.scene.introMode === 'auto' ? 'Automática' : 'Manual' : 'No registrada'}</dd>
              <dt>Selección de video</dt>
              <dd>{detail.scene ? detail.scene.videoMode === 'auto' ? 'Automática' : 'Manual' : 'No registrada'}</dd>
            </dl>
            <ul>{detail.assets.map(asset => <li key={asset.id}>{`${{ intro: 'Introducción', greeting: 'Saludo', music: 'Música', video: 'Video' }[asset.kind]}: ${asset.title} · ${birthdayDuration(asset.durationMs)}`}</li>)}</ul>
          </details>
        </div>
      )}
    </Modal>
  )
}
