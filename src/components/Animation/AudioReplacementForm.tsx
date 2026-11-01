import React, { useEffect, useRef, useState } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import HttpApi from 'lib/HttpApi'
import { clipDurationLimit, type EffectType } from 'shared/animation'
import type { AudioResource } from 'shared/audioCatalog'
import styles from './AudioLibrary.css'
import EffectTypeSelect from './EffectTypeSelect'
import EffectCategorySelect from './EffectCategorySelect'
import { effectCategory } from 'shared/effectCategories'

const api = new HttpApi('animation/')
export default function AudioReplacementForm ({ resource, onClose, onSaved }: { resource: AudioResource, onClose: () => void, onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [effectType, setEffectType] = useState<EffectType>(resource.metadata.effectType ?? 'short')
  const [category, setCategory] = useState(resource.metadata.category ?? '')
  const [error, setError] = useState(resource.error ?? '')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const body = new FormData()
      body.set('file', file)
      if (resource.kind === 'effect') {
        body.set('effectType', effectType)
        body.set('category', category)
      }
      await api.post(`resources/${resource.id}/replace`, { body })
      onSaved()
    } catch (error) { setError((error as Error).message) } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <Modal className={styles.dialog} title='Reemplazar archivo' onClose={() => { if (!busy) onClose() }}>
      <form className={styles.form} onSubmit={event => void submit(event)}>
        <p className={styles.deleteMessage}>{resource.title}</p>
        {error && <p role='alert' className={styles.notice}>{error}</p>}
        {resource.kind === 'effect' && (
          <>
            <EffectTypeSelect
              value={effectType}
              disabled={busy}
              onChange={(value) => {
                setEffectType(value)
                if (effectCategory(category) && effectCategory(category)!.effectType !== value) setCategory('')
              }}
            />
            <EffectCategorySelect
              value={category}
              disabled={busy}
              onChange={(value) => {
                setCategory(value)
                const selected = effectCategory(value)
                if (selected) setEffectType(selected.effectType)
              }}
            />
          </>
        )}
        <label>
          Nuevo archivo de audio
          <input ref={input} type='file' accept='.mp3,.wav,.ogg' disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} />
          <small>{`MP3, WAV u OGG · Hasta ${clipDurationLimit(resource.kind, effectType) / 1000} s y 20 MB`}</small>
        </label>
        <p className={styles.help}>Se conservarán el nombre y la configuración. El archivo anterior solo se sustituye cuando el nuevo es válido.</p>
        <p role='status' id='replacement-status' className={styles.help}>{busy ? 'Validando el nuevo archivo…' : !file ? 'Seleccione una versión que cumpla el límite indicado.' : 'El archivo se validará antes de reemplazarlo.'}</p>
        <div className={styles.actions}>
          <Button className={styles.secondary} disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button variant='primary' type='submit' disabled={busy || !file} aria-describedby='replacement-status'>Reemplazar archivo</Button>
        </div>
      </form>
    </Modal>
  )
}
