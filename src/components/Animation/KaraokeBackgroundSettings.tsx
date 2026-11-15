import React, { useState } from 'react'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import type { KaraokeBackgroundAsset } from 'shared/karaokeBackgrounds'
import type useKaraokeBackgrounds from './useKaraokeBackgrounds'
import styles from './KaraokeCallPilot.css'

export default function KaraokeBackgroundSettings ({ state }: { state: ReturnType<typeof useKaraokeBackgrounds> }) {
  const { overview, draft, setDraft, busy, error, notice, upload, activate, save, reload } = state
  const [preview, setPreview] = useState<KaraokeBackgroundAsset | null>(null)
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(overview?.settings)
  return (
    <section className={styles.section} aria-label='Fondos de karaoke'>
      <h3>Fondos de karaoke</h3>
      {error && (
        <div role='alert' className={styles.error}>
          <p>{error}</p>
          <Button onClick={() => void reload()}>Recargar fondos</Button>
        </div>
      )}
      {notice && <p role='status'>{notice}</p>}
      {busy && <p role='status'>Preparando o guardando fondos…</p>}
      {!draft && !error && <p role='status'>Cargando fondos…</p>}
      {draft && overview && (
        <>
          {(['video', 'bed'] as const).map((kind) => {
            const title = kind === 'video' ? 'Videos de fondo' : 'Audios de fondo'
            const assets = overview.assets.filter(asset => asset.kind === kind)
            return (
              <fieldset key={kind} disabled={busy} className={styles.section}>
                <legend>{title}</legend>
                <label className={styles.field}>
                  {kind === 'video' ? 'Modo de video' : 'Modo de audio'}
                  <select aria-label={kind === 'video' ? 'Modo de video' : 'Modo de audio'} value={draft[`${kind}Mode`]} onChange={event => setDraft({ ...draft, [`${kind}Mode`]: event.target.value })}>
                    <option value='none'>Sin fondo</option>
                    <option value='single'>Un fondo fijo</option>
                    <option value='all'>Alternar los activos</option>
                  </select>
                </label>
                {draft[`${kind}Mode`] === 'single' && (
                  <label className={styles.field}>
                    {kind === 'video' ? 'Video fijo' : 'Audio fijo'}
                    <select aria-label={kind === 'video' ? 'Video fijo' : 'Audio fijo'} value={draft[`${kind}Id`] ?? ''} onChange={event => setDraft({ ...draft, [`${kind}Id`]: event.target.value || null })}>
                      <option value=''>Seleccione un fondo activo</option>
                      {assets.filter(asset => asset.active && asset.state === 'ready').map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}
                    </select>
                  </label>
                )}
                <label className={styles.field}>
                  {kind === 'video' ? 'Subir video' : 'Subir audio de fondo'}
                  <input
                    type='file'
                    accept={kind === 'video' ? 'video/mp4' : 'audio/mpeg,audio/wav,audio/ogg'}
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      event.target.value = ''
                      if (file) void upload(kind, file)
                    }}
                  />
                </label>
                {!assets.length && <p>{kind === 'video' ? 'Todavía no hay videos de fondo de Karaoke.' : 'Todavía no hay audios de fondo de Karaoke.'}</p>}
                <ul className={styles.list}>
                  {assets.map(asset => (
                    <li key={asset.id} className={styles.item}>
                      <strong>{asset.title}</strong>
                      {asset.state !== 'ready' && <p role={asset.state === 'failed' ? 'alert' : 'status'}>{asset.error || 'Preparando fondo…'}</p>}
                      {asset.state === 'ready' && (
                        <div className={styles.actions}>
                          <label className={styles.switch}>
                            <input type='checkbox' checked={asset.active} onChange={event => void activate(asset.id, event.target.checked)} aria-label={`Activar ${asset.title}`} />
                            Activo
                          </label>
                          <Button onClick={() => setPreview(asset)}>{kind === 'video' ? 'Ver video' : 'Escuchar fondo'}</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </fieldset>
            )
          })}
          <div className={styles.grid}>
            <label className={styles.field}>
              Oscurecimiento (%)
              <input type='number' min={0} max={85} value={Math.round(draft.dimOpacity * 100)} onChange={event => setDraft({ ...draft, dimOpacity: event.target.valueAsNumber / 100 })} />
            </label>
            <label className={styles.field}>
              Volumen del fondo (%)
              <input type='number' min={0} max={100} value={Math.round(draft.bedVolume * 100)} onChange={event => setDraft({ ...draft, bedVolume: event.target.valueAsNumber / 100 })} />
            </label>
          </div>
          {dirty && <Button variant='primary' disabled={busy} onClick={() => void save()}>Guardar fondos</Button>}
        </>
      )}
      {preview && (
        <Modal title={preview.title} className={styles.dialog} onClose={() => setPreview(null)}>
          {preview.kind === 'video'
            ? <video className={styles.resourceVideo} controls muted playsInline src={new URL(preview.url, document.baseURI).href} />
            : <audio controls src={new URL(preview.url, document.baseURI).href} />}
        </Modal>
      )}
    </section>
  )
}
