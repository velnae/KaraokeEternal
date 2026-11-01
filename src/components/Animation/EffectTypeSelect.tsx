import React from 'react'
import { effectTypeLabels, type EffectType } from 'shared/animation'

export default function EffectTypeSelect ({ value = 'short', onChange, disabled = false }: { value?: EffectType, onChange: (value: EffectType) => void, disabled?: boolean }) {
  return (
    <label>
      Tipo de efecto
      <select aria-label='Tipo de efecto' value={value} disabled={disabled} onChange={event => onChange(event.target.value as EffectType)}>
        {(Object.keys(effectTypeLabels) as EffectType[]).map(type => <option key={type} value={type}>{effectTypeLabels[type]}</option>)}
      </select>
      {value === 'transition' && <small>Hasta 12 s. Acompaña las presentaciones del programa automático; no se usa como aplauso.</small>}
    </label>
  )
}
