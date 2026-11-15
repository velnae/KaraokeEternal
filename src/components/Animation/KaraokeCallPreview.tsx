import React, { useEffect, useState, useSyncExternalStore } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import { Link } from 'react-router'
import HttpApi from 'lib/HttpApi'
import { useAppSelector } from 'store/hooks'
import type { CallJob, CallPart, CallSnapshot } from 'shared/karaokeCalls'
import type { KaraokeBackgroundOverview } from 'shared/karaokeBackgrounds'
import KaraokePreviewPlayer from './KaraokePreviewPlayer'
import PrivateCallAudio from './PrivateCallAudio'
import CallPreparationList from './CallPreparationList'
import { karaokePreviewMemory } from 'lib/karaokePreviewMemory'
import type { KaraokePreviewDraft, KaraokePreviewState } from 'shared/karaokePreview'
import styles from './KaraokeCallPilot.css'

const api = new HttpApi()
export default function KaraokeCallPreview ({ roomId, snapshot, backgrounds, unavailable, refresh, cancel, onClose }: {
  roomId: number
  snapshot: CallSnapshot | null
  backgrounds: KaraokeBackgroundOverview | null
  unavailable: string
  refresh: () => Promise<void>
  cancel: (id: string) => Promise<void>
  onClose: () => void
}) {
  const userId = useAppSelector(state => state.user.userId)
  const venueName = useAppSelector(state => state.rooms.entities[roomId]?.name || 'Karaoke')
  const base = `rooms/${roomId}/karaoke-calls/preview`
  const entry = karaokePreviewMemory.room(roomId, {
    load: () => api.get<KaraokePreviewState>(base),
    save: (draft, revision) => api.put<{ revision: number }>(base, { body: { draft, revision }, keepalive: true }),
    generate: input => api.post<{ key: string, job: CallJob }>(base, { body: input }),
  })
  const { draft, busy, loading, saving, error, blocked, savedDrafts } = useSyncExternalStore(entry.subscribe, entry.getSnapshot)
  const config = backgrounds?.settings
  const [listening, setListening] = useState<CallPart | null>(null)
  useEffect(() => {
    if (Object.values(entry.getSnapshot().samples).some(job => job.error && !job.result)) void entry.refreshSamples(true)
    const save = () => {
      void entry.flush()
    }
    window.addEventListener('pagehide', save)
    return () => {
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [entry])
  useEffect(() => {
    void entry.refreshSamples()
  }, [entry, snapshot?.jobs])
  const close = () => {
    void entry.flush().finally(onClose)
  }
  if (!draft) return (
    <Modal key={userId} title='Previsualizar llamado' className={`${styles.dialog} ${styles.panel}`} scrollable onClose={close}>
      {loading && <p role='status'>Recuperando prueba guardada…</p>}
      {error && <p role='alert'>{error}</p>}
      {blocked && <Button onClick={() => void entry.reload()}>Recargar prueba</Button>}
    </Modal>
  )
  const currentJob = snapshot ? entry.sample(snapshot) : undefined
  const key = JSON.stringify([draft.introId, draft.tableId, draft.performer, draft.song, draft.mode])
  const voice = !currentJob?.outdated ? currentJob?.result ?? undefined : undefined
  const table = snapshot?.tables.find(item => String(item.tableId) === draft.tableId)
  let reason = blocked ? 'Recargue la prueba antes de preparar audio.' : unavailable
  if (!draft.introId || !snapshot?.intros.some(intro => intro.id === draft.introId)) reason ||= 'Genere o seleccione una introducción en Configuración.'
  else if (!table?.part || table.outdated) reason ||= 'Prepare la voz de la mesa en Salas y mesas.'
  else if (!draft.performer.trim() || !draft.song.trim()) reason ||= 'Ingrese cantante y canción para preparar la prueba.'
  const generate = async () => {
    setListening(null)
    if (snapshot) await entry.generate(snapshot)
    await refresh()
  }
  const update = (patch: Partial<KaraokePreviewDraft>) => {
    setListening(null)
    entry.update(patch)
  }
  const video = backgrounds?.assets.find(asset => asset.kind === 'video' && asset.id === draft.videoId && asset.state === 'ready')
  const bed = backgrounds?.assets.find(asset => asset.kind === 'bed' && asset.id === draft.bedId && asset.state === 'ready')
  return (
    <Modal key={userId} title='Previsualizar llamado' className={`${styles.dialog} ${styles.panel}`} scrollable onClose={close}>
      {!listening && <KaraokePreviewPlayer key={JSON.stringify([key, voice?.id, video?.id, bed?.id, draft.volume, busy])} roomId={roomId} performer={draft.performer} song={draft.song} table={table ? `Mesa ${table.code}` : ''} venueName={venueName} voice={busy ? undefined : voice} video={video} bed={bed} volume={draft.volume} dimOpacity={config?.dimOpacity ?? 0.55} />}
      {listening && <PrivateCallAudio key={listening.id} roomId={roomId} part={listening} onClose={() => setListening(null)} />}
      {error && <p role='alert'>{error}</p>}
      {saving && <p role='status'>Guardando prueba…</p>}
      {blocked && <Button onClick={() => void entry.reload()}>Recargar prueba</Button>}
      {currentJob && ['queued', 'generating', 'preparing'].includes(currentJob.status) && <p role='status'>Preparando audio del llamado…</p>}
      {currentJob?.error && <p role='alert'>{currentJob.error}</p>}
      <fieldset className={styles.section} disabled={busy}>
        <legend>Variantes</legend>
        {Object.keys(savedDrafts).length > 0 && (
          <label className={styles.field}>
            Pruebas guardadas
            <select
              value=''
              onChange={(event) => {
                setListening(null)
                entry.restore(event.target.value)
              }}
            >
              <option value=''>Restaurar una prueba…</option>
              {Object.entries(savedDrafts).reverse().map(([key, saved], index) => <option key={key} value={key}>{`${saved.performer} · ${saved.song} · Mesa ${saved.tableId} (${index + 1})`}</option>)}
            </select>
          </label>
        )}
        <div className={styles.grid}>
          {(['video', 'bed'] as const).map(kind => (
            <label key={kind} className={styles.field}>
              {kind === 'video' ? 'Video de fondo' : 'Audio de fondo'}
              <select aria-label={kind === 'video' ? 'Video de fondo' : 'Audio de fondo'} value={draft[`${kind}Id`]} onChange={event => update({ [`${kind}Id`]: event.target.value })}>
                <option value=''>Sin fondo</option>
                {backgrounds?.assets.filter(asset => asset.kind === kind && asset.state === 'ready').map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}
              </select>
            </label>
          ))}
          <label className={styles.field}>
            Volumen de prueba (%)
            <input
              type='number'
              min={0}
              max={100}
              value={Math.round(draft.volume * 100)}
              onChange={(event) => {
                if (Number.isFinite(event.target.valueAsNumber)) update({ volume: Math.min(1, Math.max(0, event.target.valueAsNumber / 100)) })
              }}
            />
          </label>
        </div>
      </fieldset>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void generate()
        }}
      >
        <div className={styles.grid}>
          <label className={styles.field}>
            Introducción
            <select aria-label='Introducción' value={draft.introId} onChange={event => update({ introId: event.target.value })} required>
              <option value=''>Seleccione una introducción</option>
              {draft.introId && !snapshot?.intros.some(item => item.id === draft.introId) && <option value={draft.introId}>Introducción guardada</option>}
              {snapshot?.intros.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            Mesa
            <select aria-label='Mesa' value={draft.tableId} onChange={event => update({ tableId: event.target.value })} required>
              <option value=''>Seleccione una mesa</option>
              {snapshot?.tables.map(item => <option key={item.tableId} value={item.tableId}>{`Mesa ${item.code}${!item.part || item.outdated ? ' — preparar voz' : ''}`}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            Cantante
            <input value={draft.performer} onChange={event => update({ performer: event.target.value })} maxLength={60} required />
          </label>
          <label className={styles.field}>
            Canción
            <input value={draft.song} onChange={event => update({ song: event.target.value })} maxLength={140} required />
          </label>
        </div>
        <details className={styles.requestDetails}>
          <summary>Más opciones</summary>
          <label className={styles.field}>
            Tipo de prueba
            <select aria-label='Tipo de prueba' value={draft.mode} onChange={event => update({ mode: event.target.value as KaraokePreviewDraft['mode'] })}>
              <option value='hybrid'>Híbrido: introducción + mesa + presentación</option>
              <option value='reference'>Referencia: frase completa con Gemini</option>
            </select>
          </label>
        </details>
        <Button type='submit' variant='primary' disabled={busy || !!reason}>{currentJob && ['failed', 'uncertain', 'cancelled'].includes(currentJob.status) ? 'Reintentar prueba' : 'Preparar prueba'}</Button>
        {reason && <p role='status'>{reason}</p>}
        {!table?.part && <Link to='/admin/rooms'>Voces de las mesas</Link>}
      </form>
      <section className={styles.section} aria-label='Pruebas recientes'>
        <h3>Pruebas recientes</h3>
        <CallPreparationList jobs={snapshot?.jobs.filter(item => item.operation === 'hybrid' || item.operation === 'reference') ?? []} cancel={cancel} listen={setListening} />
      </section>
    </Modal>
  )
}
