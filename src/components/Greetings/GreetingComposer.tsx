import React, { useId } from 'react'
import { useAppSelector } from 'store/hooks'
import { greetingText, GREETING_LIMIT, type GreetingDraft } from 'shared/greetings'
import styles from './Greetings.css'

export default function GreetingComposer ({ value, onChange, locked }: { value: GreetingDraft | null, onChange: (value: GreetingDraft | null) => void, locked: boolean }) {
  const id = useId()
  const user = useAppSelector(state => state.user)
  const text = value ? greetingText(value, user.name) : ''
  return (
    <div className={styles.composer}>
      <label className={styles.toggle}>
        <input type='checkbox' checked={!!value} disabled={locked} aria-controls={`${id}-fields`} onChange={event => onChange(event.target.checked ? { recipient: '', message: '' } : null)} />
        Agregar saludo
        <span className={styles.secondary}>(opcional)</span>
      </label>
      {value && (
        <fieldset id={`${id}-fields`} disabled={locked} className={styles.fields} aria-label='Saludo'>
          <label htmlFor={`${id}-recipient`}>Para (opcional)</label>
          <input id={`${id}-recipient`} value={value.recipient} maxLength={50} onChange={event => onChange({ ...value, recipient: event.target.value })} />
          <label htmlFor={`${id}-message`}>Mensaje</label>
          <textarea id={`${id}-message`} rows={3} value={value.message} maxLength={GREETING_LIMIT} onChange={event => onChange({ ...value, message: event.target.value })} aria-describedby={`${id}-count ${id}-notice`} />
          <div className={styles.caption}>
            <span id={`${id}-notice`}>Antes de esta canción, en pantalla y con voz si está disponible.</span>
            <span id={`${id}-count`} aria-label={`${[...text].length} de ${GREETING_LIMIT} caracteres, incluidos los nombres`}>{`${[...text].length}/${GREETING_LIMIT}`}</span>
          </div>
        </fieldset>
      )}
    </div>
  )
}
