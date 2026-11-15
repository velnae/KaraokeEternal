import { createGemini } from './index.js'
import { greetingVoiceModels } from '../../shared/greetingVoice.js'
import { VoiceError } from './errors.js'

export async function resolveGeminiSelection (input: unknown) {
  const value = input as { model?: unknown, voice?: unknown } | null
  if (!value || !greetingVoiceModels.includes(value.model as typeof greetingVoiceModels[number])) throw new VoiceError('Seleccione un modelo de voz Gemini válido.', 'invalid', 0, false)
  return createGemini().resolveVoice(value.voice)
}
