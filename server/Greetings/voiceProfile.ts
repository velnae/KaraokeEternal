import { createHash } from 'node:crypto'
import type { GreetingVoiceConfig } from '../../shared/greetingVoice.js'
import { greetingText, validateGreeting, type Greeting } from '../../shared/greetings.js'
import { AudioValidationError } from '../Animation/AudioPreparation.js'
import type { CallPurpose } from '../../shared/karaokeCalls.js'

export interface GreetingVoiceProfile {
  provider: 'gemini'
  model: string
  voice: string
  style: string
  processingRevision: number
}
const callDirections: Record<CallPurpose, string> = {
  intro: 'This is a short karaoke introduction. Sound welcoming, with moderate energy and a natural sentence ending.',
  table: 'This is the opening clause of a longer announcement. Use a continuing intonation after the table number, with a brief comma pause, not a final sentence cadence.',
  continuation: 'Continue a karaoke introduction after the table has been named. Welcome the performer warmly and pronounce the song title clearly. Keep the delivery concise and natural.',
  reference: 'Read this complete karaoke introduction naturally, with a brief pause after the opening sentence and a warm welcome for the performer.',
}
export function callSpeechProfile (profile: GreetingVoiceProfile, purpose?: CallPurpose): GreetingVoiceProfile {
  if (purpose === undefined) return profile
  if (!Object.hasOwn(callDirections, purpose)) throw new Error('Propósito de voz no válido.')
  return { ...profile, style: `${profile.style} ${callDirections[purpose]}` }
}
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

export function loadGreetingVoiceProfile (config: GreetingVoiceConfig): GreetingVoiceProfile {
  // Credentials, enablement and quotas do not change how cached speech sounds.
  return { provider: 'gemini', model: config.model, voice: config.voice, style: config.style, processingRevision: 1 }
}

export function greetingSpeechText (greeting: Pick<Greeting, 'recipient' | 'message' | 'sender'>) {
  try {
    validateGreeting(greeting, greeting.sender)
  } catch {
    throw new AudioValidationError('El texto del saludo no es válido para preparar su voz. Se conserva la entrega en pantalla.')
  }
  const text = greetingText(greeting, greeting.sender).normalize('NFC').replace(/\s+/gu, ' ').trim()
  if (/[<>[\]]/u.test(text) || [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new AudioValidationError('El saludo contiene etiquetas o caracteres que no se leen en voz alta. Se mostrará en pantalla.')
  }
  return text
}

export const greetingAudioKey = (roomId: number, text: string, profile: GreetingVoiceProfile) => hash(JSON.stringify([roomId, text, profile]))
