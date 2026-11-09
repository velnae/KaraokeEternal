import React from 'react'
import { birthdayVoiceName, type BirthdayVoiceOption } from './settingsHelpers'

export default function BirthdayVoiceSelect ({ id, voices, onChange }: { id: string, voices: BirthdayVoiceOption[], onChange(id: string): void }) {
  const selected = voices.find(voice => voice.voiceId.toLowerCase() === id.toLowerCase())
  return (
    <select value={id} onChange={event => onChange(event.target.value)}>
      <option value=''>Seleccione una voz</option>
      {id && (!selected || selected.voiceId !== id) && <option value={id}>{birthdayVoiceName(id, voices)}</option>}
      {voices.map(voice => <option key={voice.voiceId} value={voice.voiceId}>{birthdayVoiceName(voice.voiceId, voices)}</option>)}
    </select>
  )
}
