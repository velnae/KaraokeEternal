import React, { useState } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import { approachLabels, birthdayApproaches, validateBirthdaySettings, type BirthdayAsset, type BirthdaySettings, type BirthdayVoiceRule } from 'shared/birthdays'
import BirthdayVoiceSelect from './BirthdayVoiceSelect'
import type { BirthdayVoiceOption } from './settingsHelpers'
import styles from './BirthdaySettings.css'

export default function BirthdayProfileEditor ({ config, index, initial, voices, videos, onApply, onRemove, onClose }: {
  config: BirthdaySettings
  index: number
  initial: BirthdayVoiceRule
  voices: BirthdayVoiceOption[]
  videos: BirthdayAsset[]
  onApply(rule: BirthdayVoiceRule): void
  onRemove?(): void
  onClose(): void
}) {
  const [rule, setRule] = useState(initial)
  const [error, setError] = useState('')
  const update = (patch: Partial<BirthdayVoiceRule>) => setRule(value => ({ ...value, ...patch }))
  const apply = (event: React.FormEvent) => {
    event.preventDefault()
    try {
      const rules = [...config.rules]
      rules[index] = rule
      // The profile can be edited before the global default voice is selected.
      validateBirthdaySettings({ ...config, textModel: config.textModel || 'draft', defaultVoiceId: config.defaultVoiceId || rule.voiceId, rules })
      onApply(rule)
    } catch (failure) { setError((failure as Error).message) }
  }
  return (
    <Modal title={onRemove ? 'Editar perfil' : 'Agregar perfil'} className={styles.editor} scrollable onClose={onClose}>
      <form className={styles.editorForm} onSubmit={apply}>
        <label>
          Nombre del perfil
          <input type='text' required maxLength={80} value={rule.title ?? ''} onChange={event => update({ title: event.target.value })} />
        </label>
        <div className={styles.fields}>
          <label>
            Desde
            <input type='number' required min={0} max={120} value={Number.isFinite(rule.minAge) ? rule.minAge : ''} onChange={event => update({ minAge: event.target.valueAsNumber })} />
          </label>
          <label>
            Hasta
            <input type='number' required min={0} max={120} value={Number.isFinite(rule.maxAge) ? rule.maxAge : ''} onChange={event => update({ maxAge: event.target.valueAsNumber })} />
          </label>
          <label>
            Sexo
            <select value={rule.sex} onChange={event => update({ sex: event.target.value as BirthdayVoiceRule['sex'] })}>
              <option value='any'>Cualquier sexo</option>
              <option value='female'>Femenino</option>
              <option value='male'>Masculino</option>
              <option value='unspecified'>Sin especificar</option>
            </select>
          </label>
        </div>
        <label>
          Voz
          <BirthdayVoiceSelect id={rule.voiceId} voices={voices} onChange={voiceId => update({ voiceId })} />
        </label>
        <label>
          Video del cumpleaños
          <select value={rule.videoId ?? ''} onChange={event => update({ videoId: event.target.value || null })}>
            <option value=''>Usar fondo general</option>
            {videos.map(video => <option key={video.id} value={video.id}>{video.title}</option>)}
          </select>
        </label>
        <label>
          Indicaciones del saludo
          <textarea rows={3} maxLength={500} value={rule.writing ?? ''} onChange={event => update({ writing: event.target.value })} />
        </label>
        <label>
          Interpretación de voz
          <textarea rows={3} maxLength={400} value={rule.style ?? ''} onChange={event => update({ style: event.target.value })} />
        </label>
        <fieldset className={styles.approaches}>
          <legend>Enfoques creativos</legend>
          {birthdayApproaches.map(approach => (
            <label key={approach}>
              <input type='checkbox' checked={(rule.approaches ?? birthdayApproaches).includes(approach)} onChange={event => update({ approaches: event.target.checked ? [...(rule.approaches ?? birthdayApproaches), approach] : (rule.approaches ?? birthdayApproaches).filter(value => value !== approach) })} />
              {approachLabels[approach]}
            </label>
          ))}
        </fieldset>
        <label className={styles.check}>
          <input type='checkbox' checked={rule.history !== false} onChange={event => update({ history: event.target.checked })} />
          Permitir referencia histórica
        </label>
        {error && <p role='alert'>{error}</p>}
        <div className={styles.editorActions}>
          {onRemove && <Button type='button' onClick={onRemove}>Quitar perfil</Button>}
          <Button type='button' onClick={onClose}>Cancelar</Button>
          <Button type='submit' variant='primary'>Aplicar perfil</Button>
        </div>
      </form>
    </Modal>
  )
}
