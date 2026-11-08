import React, { useRef, useState } from 'react'
import Modal from 'components/Modal/Modal'
import Button from 'components/Button/Button'
import { celebrationYear, type BirthdayEvent, type BirthdayInput, type BirthdaySex } from 'shared/birthdays'
import { birthdayApi } from './api'
import styles from './Birthdays.css'

export default function BirthdayForm ({ event, onClose, onSaved }: { event?: BirthdayEvent, onClose(): void, onSaved(): void }) {
  const [input, setInput] = useState<BirthdayInput>({ name: event?.name ?? '', sex: event?.sex ?? 'unspecified', birthYear: event?.birthYear ?? Number.NaN })
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
