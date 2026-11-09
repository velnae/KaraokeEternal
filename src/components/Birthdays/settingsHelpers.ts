import type { BirthdaySettings, BirthdayVoiceRule } from '../../../shared/birthdays.js'

export interface BirthdayVoiceOption { voiceId: string, name: string }
export function birthdaySampleKey (config: BirthdaySettings, voiceId = config.defaultVoiceId, style = config.speechStyle) {
  const provider = config.speechProvider ?? 'elevenlabs'
  return JSON.stringify([provider, config.speechModel ?? (provider === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_v4'), voiceId,
    style || config.speechStyle || 'Voz cálida y alegre, ritmo moderado, pronunciación clara.', 1])
}
export function birthdayVoiceName (id: string, voices: BirthdayVoiceOption[]) {
  const name = voices.find(voice => voice.voiceId.toLowerCase() === id.toLowerCase())?.name
  if (name) return name.replace('Commercial Voiceover', 'Voz comercial').replace('Podcaster', 'Locutor').replace('Mexico Spanish', 'Español de México').replace('Argentina Spanish', 'Español de Argentina')
  const regional = /^es-419-(commercial|podcaster)-(\d+)$/i.exec(id)
  if (regional) return `${regional[1].toLowerCase() === 'commercial' ? 'Voz comercial' : 'Locutor'} ${regional[2]} · Español latinoamericano`
  return id || 'Seleccione una voz'
}
export const birthdayProfileAges = (rule: BirthdayVoiceRule) => rule.minAge === 0 ? `Hasta ${rule.maxAge} años` : rule.maxAge === 120 ? `${rule.minAge} años o más` : `${rule.minAge}–${rule.maxAge} años`
export function birthdayProfileTitle (rule: BirthdayVoiceRule, index: number) {
  const title = rule.title || `Perfil ${index + 1}`
  const pieces = title.split(' · ')
  return pieces.length > 1 && pieces[pieces.length - 1].toLocaleLowerCase('es') === birthdayProfileAges(rule).toLocaleLowerCase('es') ? pieces.slice(0, -1).join(' · ') : title
}
