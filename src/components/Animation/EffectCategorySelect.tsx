import React from 'react'
import { effectCategories, effectCategory, effectCategoryValue } from 'shared/effectCategories'

export default function EffectCategorySelect ({ value, onChange, disabled = false, filter = false }: { value?: string, onChange: (value: string) => void, disabled?: boolean, filter?: boolean }) {
  const selected = effectCategoryValue(value)
  const category = effectCategory(selected)
  return (
    <label>
      Categoría
      <select aria-label='Categoría' value={selected} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value=''>{filter ? 'Todas' : 'Sin especificar'}</option>
        {selected && !category && <option value={selected}>{selected}</option>}
        {effectCategories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      {!filter && category && <small>{`Duración recomendada: ${category.recommended}.`}</small>}
    </label>
  )
}
