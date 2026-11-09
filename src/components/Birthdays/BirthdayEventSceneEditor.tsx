import React, { useState } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import type { BirthdayAsset, BirthdayEvent } from 'shared/birthdays'
import { birthdayApi } from './api'
import styles from './BirthdayCelebration.css'

export default function BirthdayEventSceneEditor ({ event, assets, onClose, onSaved }: { event: BirthdayEvent, assets: BirthdayAsset[], onClose(): void, onSaved(): void }) {
  const intro = event.assets.find(asset => asset.kind === 'intro')!
  const video = event.assets.find(asset => asset.kind === 'video')!
  const [introId, setIntroId] = useState(intro.id)
  const [videoId, setVideoId] = useState(video.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const options = [...new Map([...event.assets, ...assets].map(asset => [asset.id, asset])).values()]
  const save = async (automatic = false) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await birthdayApi.put(`events/${event.id}/scene`, { body: { revision: event.revision, ...(automatic ? { automatic: true } : { ...(introId !== intro.id ? { introId } : {}), ...(videoId !== video.id ? { videoId } : {}) }) } })
      onSaved()
      onClose()
    } catch (failure) {
      setError((failure as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <Modal title={`Celebración de ${event.name}`} className={styles.editor} onClose={onClose}>
      <form
        className={styles.form}
        onSubmit={(submit) => {
          submit.preventDefault()
          void save()
        }}
      >
        <label>
          Introducción
          <select value={introId} disabled={busy} onChange={change => setIntroId(change.target.value)}>{options.filter(asset => asset.kind === 'intro').map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select>
        </label>
        <label>
          Video
          <select value={videoId} disabled={busy} onChange={change => setVideoId(change.target.value)}>{options.filter(asset => asset.kind === 'video').map(asset => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select>
        </label>
        {error && <p role='alert'>{error}</p>}
        {busy && <p role='status'>Guardando selección…</p>}
        <div className={styles.actions}>
          <Button type='button' disabled={busy} onClick={() => void save(true)}>Volver a la propuesta automática</Button>
          <Button type='submit' variant='primary' disabled={busy}>Aplicar selección</Button>
        </div>
      </form>
    </Modal>
  )
}
