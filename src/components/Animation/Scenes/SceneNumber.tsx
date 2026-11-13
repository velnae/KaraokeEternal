import React, { useState } from 'react'

export default function SceneNumber ({ label, value, onChange, min, max, step = 1, hideLabel = false }: { label: string, value: number, onChange(value: number): void, min?: number, max?: number, step?: number, hideLabel?: boolean }) {
  const [input, setInput] = useState({ value, draft: String(value) })
  if (input.value !== value) setInput({ value, draft: String(value) })
  const draft = input.value === value ? input.draft : String(value)
  return (
    <label>
      {!hideLabel && label}
      <input
        aria-label={hideLabel ? label : undefined}
        type='number'
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => {
          setInput({ value, draft: e.target.value })
          const next = e.target.valueAsNumber
          if (Number.isFinite(next)) onChange(next)
        }}
        onBlur={() => setInput({ value, draft: String(value) })}
      />
    </label>
  )
}
