import React from 'react'
import type { VoiceOption } from 'shared/audioProviders'

export default function VoiceSelect ({ id, voices, onChange, ...props }: {
  id: string
  voices: VoiceOption[]
  onChange(id: string): void
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'value' | 'onChange'>) {
  const selected = voices.find(voice => voice.voiceId.toLowerCase() === id.toLowerCase())
  return (
    <select {...props} value={id} onChange={event => onChange(event.target.value)}>
      <option value=''>Seleccione una voz</option>
      {id && (!selected || selected.voiceId !== id) && <option value={id}>{selected?.name ?? id}</option>}
      {voices.map(voice => <option key={voice.voiceId} value={voice.voiceId}>{voice.name}</option>)}
    </select>
  )
}
