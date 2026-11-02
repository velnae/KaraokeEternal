import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { LocalTtsConfig } from '../../shared/localTts.js'
import { greetingText, validateGreeting, type Greeting } from '../../shared/greetings.js'
import { AudioValidationError } from '../Animation/AudioPreparation.js'

export interface GreetingVoiceProfile {
  installationPath: string
  configurationRevision: number
  model: string
  engineHash: string
  referenceHash: string
  seed: number
  processingRevision: number
}
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')

async function boundedFile (file: string, limit: number) {
  const stat = await fs.stat(file)
  if (!stat.isFile() || !stat.size || stat.size > limit) throw new Error('Invalid local voice resource')
  const bytes = await fs.readFile(file)
  if (bytes.length > limit) throw new Error('Oversized local voice resource')
  return bytes
}

export async function loadGreetingVoiceProfile (config: LocalTtsConfig) {
  if (!config.installationPath) throw new AudioValidationError('Configure la voz local en Ajustes → Animador. El saludo se mostrará en pantalla.')
  try {
    const reference = await boundedFile(path.join(config.installationPath, 'reference', 'es_mx_f1.wav'), 5 * 1024 * 1024)
    const scripts = await Promise.all(['model.sh', 'resident.py', 'speak.py'].map(name => boundedFile(path.join(config.installationPath, name), 1024 * 1024)))
    const profile: GreetingVoiceProfile = {
      installationPath: config.installationPath, configurationRevision: config.revision,
      model: 'ResembleAI/Chatterbox-Multilingual-es-mx-latam', engineHash: hash(Buffer.concat(scripts)),
      referenceHash: hash(reference), seed: 42, processingRevision: 1,
    }
    return { profile, reference }
  } catch {
    throw new AudioValidationError('Revise la instalación y la voz de referencia local. El saludo se mostrará en pantalla.')
  }
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
