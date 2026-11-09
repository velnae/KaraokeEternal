import React, { useRef, useState } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import { approachLabels, birthdayApproaches, celebrationYear, type BirthdayEvent, type BirthdayInput, type BirthdaySex, type BirthdayVoiceRule } from 'shared/birthdays'
import { birthdayApi } from './api'
import styles from './Birthdays.css'

export default function BirthdayForm ({ event, profiles = [], onClose, onSaved }: { event?: BirthdayEvent, profiles?: BirthdayVoiceRule[], onClose(): void, onSaved(): void }) {
  const [input, setInput] = useState<BirthdayInput>({ name: event?.name ?? '', sex: event?.sex ?? 'unspecified', birthYear: event?.birthYear ?? Number.NaN,
    dedication: event?.personalization?.dedication ?? '', approach: event?.personalization?.approachOverride ?? 'auto', profileId: event?.personalization?.profileOverride ?? '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(crypto.randomUUID())
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await birthdayApi.post(event ? `events/${event.id}` : 'events', { body: event
        ? { operation: 'edit', revision: event.revision, input }
        : { ...input, requestId: requestId.current } })
      onSaved()
    } catch (failure) {
      setError((failure as Error).message)
    } finally { setBusy(false) }
  }
  return (
    <Modal title={event ? 'Editar cumpleaños' : 'Preparar cumpleaños'} onClose={onClose}>
      <form onSubmit={submit} className={styles.form}>
        <label>
          Nombre
          <input type='text' autoFocus required maxLength={60} value={input.name} onChange={e => setInput({ ...input, name: e.target.value })} />
        </label>
        <label>
          Dedicatoria (opcional)
          <input type='text' maxLength={160} value={input.dedication ?? ''} onChange={e => setInput({ ...input, dedication: e.target.value })} placeholder='Con cariño, de tus amigos de la mesa 05' />
        </label>
        <details>
          <summary>Opciones del saludo</summary>
          <label>
            Enfoque creativo
            <select value={input.approach ?? 'auto'} onChange={e => setInput({ ...input, approach: e.target.value as BirthdayInput['approach'] })}>
              <option value='auto'>Automático</option>
              {birthdayApproaches.map(value => <option key={value} value={value}>{approachLabels[value]}</option>)}
            </select>
          </label>
          <label>
            Perfil de voz
            <select value={input.profileId ?? ''} onChange={e => setInput({ ...input, profileId: e.target.value })}>
              <option value=''>Automático según la persona</option>
              {profiles.filter(profile => profile.id).map(profile => <option key={profile.id} value={profile.id}>{profile.title || profile.id}</option>)}
            </select>
          </label>
        </details>
        <label>
          Sexo
          <select value={input.sex} onChange={e => setInput({ ...input, sex: e.target.value as BirthdaySex })}>
            <option value='unspecified'>Sin especificar</option>
            <option value='female'>Femenino</option>
            <option value='male'>Masculino</option>
          </select>
        </label>
        <label>
          Año de nacimiento
          <input type='number' required min={celebrationYear() - 120} max={celebrationYear()} value={Number.isFinite(input.birthYear) ? input.birthYear : ''} onChange={e => setInput({ ...input, birthYear: e.target.valueAsNumber })} />
        </label>
        {error && <p role='alert'>{error}</p>}
        {busy && <p role='status'>Guardando cumpleaños…</p>}
        <div className={styles.actions}>
          <Button type='submit' variant='primary' disabled={busy}>Preparar saludo</Button>
          <Button type='button' onClick={onClose}>Cerrar</Button>
        </div>
      </form>
    </Modal>
  )
}
