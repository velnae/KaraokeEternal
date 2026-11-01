import React from 'react'
import type { CelebrationMode } from 'shared/animation'

export default function CelebrationModeSelect ({ value = 'confirmed', onChange }: { value?: CelebrationMode, onChange: (value: CelebrationMode) => void }) {
  return (
    <label>
      Cuándo usar esta celebración
      <select aria-label='Cuándo usar esta celebración' value={value} onChange={event => onChange(event.target.value as CelebrationMode)}>
        <option value='confirmed'>Solo con confirmación</option>
        <option value='song_end'>Automática al finalizar canción</option>
      </select>
      <small>Use el modo automático para frases genéricas, sin cumpleaños, nombres ni ocasiones específicas.</small>
    </label>
  )
}
