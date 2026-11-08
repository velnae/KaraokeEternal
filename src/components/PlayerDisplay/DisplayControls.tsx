import React, { useId } from 'react'
import { isDisplayColor } from 'shared/playerDisplay'
import styles from './PlayerDisplaySettings.css'

export function NumberControl ({ label, value, limit, onChange }: { label: string, value: number, limit: readonly number[], onChange(value: number): void }) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.numberControls}>
        <input type='range' aria-label={`${label} (deslizador)`} min={limit[0]} max={limit[1]} step={limit[2]} value={Number.isFinite(value) ? value : limit[0]} onChange={event => onChange(event.currentTarget.valueAsNumber)} />
        <input id={id} type='number' required min={limit[0]} max={limit[1]} step='any' value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.currentTarget.valueAsNumber)} />
      </div>
    </div>
  )
}

export function ColorControl ({ label, value, onChange }: { label: string, value: string, onChange(value: string): void }) {
  const id = useId()
  const valid = isDisplayColor(value)
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.colorControls}>
        <input type='color' aria-label={`Elegir ${label.toLowerCase()}`} value={valid ? value : '#030509'} onChange={event => onChange(event.currentTarget.value)} />
        <input id={id} type='text' required maxLength={7} pattern='#[0-9a-fA-F]{6}' spellCheck={false} value={value} aria-invalid={!valid} onChange={event => onChange(event.currentTarget.value)} />
      </div>
    </div>
  )
}
