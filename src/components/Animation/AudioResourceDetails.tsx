import React, { useState } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import HttpApi from 'lib/HttpApi'
import { familyLabels, VOICE_FAMILIES, type RoomProfile } from 'shared/animation'
import type { AudioMetadata, AudioResource, ResourceState } from 'shared/audioCatalog'
import styles from './AudioLibrary.css'

const api = new HttpApi('animation/')
export default function AudioResourceDetails ({ resource, onClose, onChange, onVersion }: {
  resource: AudioResource
  onClose: () => void
  onChange: () => void
  onVersion: () => void
}) {
  const [title, setTitle] = useState(resource.title)
  const [metadata, setMetadata] = useState(resource.metadata)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const readOnly = resource.roomId === null
  const set = <K extends keyof AudioMetadata>(key: K, value: AudioMetadata[K]) => setMetadata(previous => ({ ...previous, [key]: value }))
  const mutate = async (patch: object) => {
    setBusy(true)
    setError('')
    try {
      await api.request('PATCH', `resources/${resource.id}`, { body: patch })
      onChange()
    } catch (error) {
      setError((error as Error).message)
    } finally { setBusy(false) }
  }
  const state = (state: ResourceState): void => {
    void mutate({ state })
  }
  const retry = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post(`production/${resource.id.replace(/^generated-/, '')}/register`)
      onChange()
    } catch (error) {
      setError((error as Error).message)
    } finally { setBusy(false) }
  }
  const save = (event: React.FormEvent) => {
    event.preventDefault()
    const { text, family, modes, category, language, style, loop, voiceName, validUntil } = metadata
    void mutate({ title, metadata: { text, family, modes, category, language, style, loop, voiceName, validUntil } })
  }
  return (
    <Modal className={styles.dialog} title='Datos del audio' onClose={onClose}>
      <form className={styles.form} onSubmit={save}>
        {readOnly && <p className={styles.help}>Audio incluido. Sus datos son compartidos entre salas.</p>}
        <label>
          Nombre
          <input value={title} disabled={readOnly || busy} maxLength={120} onChange={event => setTitle(event.target.value)} />
        </label>
        <label>
          {resource.kind === 'voice' ? 'Texto hablado' : 'Descripción'}
          <textarea value={metadata.text} rows={3} readOnly={readOnly || (resource.kind === 'voice' && metadata.origin === 'generated')} onChange={event => set('text', event.target.value)} />
        </label>
        <fieldset disabled={readOnly || busy}>
          <legend>Características</legend>
          <div className={styles.fields}>
            {resource.kind === 'voice'
              ? (
                  <>
                    <label>
                      Uso del audio
                      <select value={metadata.family} onChange={event => set('family', event.target.value as AudioMetadata['family'])}>
                        <option value='manual'>Anuncio puntual</option>
                        {VOICE_FAMILIES.map(value => <option key={value} value={value}>{familyLabels[value]}</option>)}
                      </select>
                    </label>
                    <label>
                      Voz
                      <input value={metadata.voiceName ?? ''} onChange={event => set('voiceName', event.target.value)} placeholder='Sin especificar' />
                    </label>
                    <label>
                      Idioma
                      <input value={metadata.language ?? ''} onChange={event => set('language', event.target.value)} placeholder='Sin especificar' />
                    </label>
                  </>
                )
              : (
                  <label>
                    Categoría
                    <input value={metadata.category ?? ''} onChange={event => set('category', event.target.value)} />
                  </label>
                )}
            {metadata.family === 'promotion' && (
              <label>
                Vigente hasta
                <input type='datetime-local' value={metadata.validUntil ? new Date(metadata.validUntil - new Date(metadata.validUntil).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''} onChange={event => set('validUntil', Date.parse(event.target.value))} />
              </label>
            )}
          </div>
          {resource.kind === 'ambience' && (
            <label className={styles.check}>
              <input type='checkbox' checked={!!metadata.loop} onChange={event => set('loop', event.target.checked)} />
              Apto para repetirse en bucle
            </label>
          )}
          {(['dinner', 'mixed', 'party'] as RoomProfile[]).map(mode => (
            <label className={styles.check} key={mode}>
              <input type='checkbox' checked={metadata.modes.includes(mode)} onChange={event => set('modes', event.target.checked ? [...metadata.modes, mode] : metadata.modes.filter(value => value !== mode))} />
              {{ dinner: 'Cena', mixed: 'Mixto', party: 'Fiesta' }[mode]}
            </label>
          ))}
        </fieldset>
        <section aria-label='Uso en sala'>
          <h3>Uso en sala</h3>
          <dl className={styles.technical}>
            <dt>Total de reproducciones</dt>
            <dd>{resource.usage?.total ?? 0}</dd>
            <dt>Esta jornada</dt>
            <dd>{resource.usage?.currentDay ?? 0}</dd>
            <dt>Última reproducción</dt>
            <dd>{resource.usage?.lastStartedAt ? new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'short' }).format(resource.usage.lastStartedAt) : 'Sin registros'}</dd>
          </dl>
          <p className={styles.help}>Solo inicios confirmados en la sala; las escuchas de prueba no cuentan.</p>
          {resource.kind !== 'voice' && <p className={styles.help}>El registro individual de efectos y ambientes comienza con esta versión. Un ambiente continuo cuenta una vez, no por cada tramo.</p>}
        </section>
        <details>
          <summary>Información del archivo</summary>
          <dl className={styles.technical}>
            <dt>Duración</dt>
            <dd>{resource.durationMs ? `${(resource.durationMs / 1000).toFixed(1)} s` : 'Sin archivo disponible'}</dd>
            <dt>Formato</dt>
            <dd>{resource.mime || 'Sin especificar'}</dd>
            <dt>Tamaño</dt>
            <dd>{resource.size ? `${Math.round(resource.size / 1024)} KB` : '—'}</dd>
            <dt>Origen</dt>
            <dd>{metadata.providerId || (metadata.origin === 'uploaded' ? 'Archivo subido' : 'Incluido')}</dd>
            <dt>Modelo</dt>
            <dd>{metadata.model || 'No corresponde'}</dd>
            <dt>Creado</dt>
            <dd>{new Date(resource.createdAt).toLocaleString()}</dd>
            <dt>Identificador</dt>
            <dd>{resource.id}</dd>
            <dt>Versión de</dt>
            <dd>{metadata.parentId || 'Original'}</dd>
          </dl>
        </details>
        {error && <p role='alert' className={styles.notice}>{error}</p>}
        {resource.preparation === 'failed' && resource.error?.includes('registrar') && <Button className={styles.secondary} disabled={busy} onClick={() => void retry()}>Reintentar preparación</Button>}
        <div className={styles.actions}>
          {resource.preparation === 'ready' && <a className={styles.secondary} href={`${document.baseURI}api/animation/resources/${resource.id}/audio?download=true`}>Descargar</a>}
          {!readOnly && resource.state !== 'archived' && <Button className={styles.secondary} disabled={busy} onClick={() => state(resource.state === 'active' ? 'disabled' : 'active')}>{resource.state === 'active' ? 'Desactivar' : 'Activar'}</Button>}
          {!readOnly && <Button className={styles.secondary} disabled={busy} onClick={() => state(resource.state === 'archived' ? 'disabled' : 'archived')}>{resource.state === 'archived' ? 'Restaurar desactivado' : 'Archivar'}</Button>}
          {metadata.origin === 'generated' && <Button className={styles.secondary} onClick={onVersion}>Crear otra versión</Button>}
          {!readOnly && <Button variant='primary' type='submit' disabled={busy || !title.trim()}>Guardar cambios</Button>}
        </div>
      </form>
    </Modal>
  )
}
