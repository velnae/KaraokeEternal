import { createGemini } from '../AudioProviders/index.js'
import { VoiceError as GreetingVoiceError } from '../AudioProviders/errors.js'
import type { BirthdaySpeech } from '../../shared/birthdays.js'

export async function listBirthdayVoices (model: string, language = 'es-419', search?: string) {
  if (!['es-PE', 'es-419', 'es', ''].includes(language)) throw new Error('Seleccione español de Perú o latinoamericano.')
  return createGemini().listVoices(model, language, search)
}
export async function speakGeminiBirthday (text: string, profile: BirthdaySpeech, signal: AbortSignal) {
  const provider = createGemini()
  try {
    // A bounded world-wide listing can omit valid Spanish voices. Scope by the
    // regional ID or search a named voice instead of scanning the whole library.
    const region = /^es-(419|PE)-/i.exec(profile.voice)
    const language = region ? `es-${region[1].toUpperCase()}` : ''
    const voices = await listBirthdayVoices(profile.model, language, region ? undefined : profile.voice)
    const selected = voices.find(voice => voice.voiceId.toLowerCase() === profile.voice.toLowerCase())
    if (!selected) throw new Error('La voz seleccionada no está disponible en el catálogo Gemini. Consulte las voces antes de generar.')
    return await provider.generate(text, { ...profile, voice: selected.voiceId }, signal)
  } catch (error) {
    if (error instanceof GreetingVoiceError) throw new Error(`No se pudo preparar la voz del cumpleaños (${error.kind}). Revise Gemini y reintente explícitamente.`)
    throw error
  }
}
