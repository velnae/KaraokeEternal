export type ProviderUse = 'catalog' | 'greetings' | 'calls' | 'names' | 'birthdays' | 'birthday-text'
export interface VoiceOption { voiceId: string, name: string }
export interface ManagedAudioProvider {
  id: 'elevenlabs' | 'gemini'
  name: string
  configured: boolean
  checks: { use: ProviderUse, model: string }[]
  catalog?: { voiceId: string, models: Partial<Record<'voice' | 'effect' | 'ambience', string>> }
}
export const providerUseLabels: Record<ProviderUse, string> = {
  'catalog': 'Catálogo del animador', 'greetings': 'Saludos de participantes', 'calls': 'Llamados y plantillas', 'names': 'Nombres', 'birthdays': 'Voz de cumpleaños', 'birthday-text': 'Texto de cumpleaños',
}
