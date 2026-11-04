export const greetingVoiceModels = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'] as const
export const greetingVoiceSample = '¡Hola! ¡Bienvenidos al karaoke! Esta noche, ¡llamas y ñustas nos acompañan! ¿Qué te parece?'
export interface GreetingVoiceConfig {
  enabled: boolean
  model: typeof greetingVoiceModels[number]
  voice: string
  style: string
  requestsPerMinute: number
  requestsPerDay: number
  revision: number
}
export const defaultGreetingVoiceConfig: GreetingVoiceConfig = {
  enabled: false,
  model: 'gemini-3.8-flash-lite-tts',
  voice: 'Puck',
  style: 'Speak in Latin American Spanish with a neutral Peruvian accent. Be warm, cheerful and welcoming, without shouting. Use a natural medium pace and clear pronunciation. Solo voice, no music or sound effects.',
  requestsPerMinute: 3,
  requestsPerDay: 10,
  revision: 0,
}
export type GreetingVoiceState = 'disabled' | 'unconfigured' | 'available' | 'checking' | 'generating' | 'limited' | 'error'
export interface GreetingVoiceSnapshot {
  config: GreetingVoiceConfig
  configured: boolean
  state: GreetingVoiceState
  message: string
  checkedAt: number | null
  usage: { minute: number, day: number, resetsAt: number, nextAt: number }
}
export const greetingVoiceStateLabels: Record<GreetingVoiceState, string> = {
  disabled: 'Generación desactivada', unconfigured: 'Falta la clave de Gemini', available: 'Gemini configurado',
  checking: 'Comprobando conexión', generating: 'Generando saludo', limited: 'Esperando cuota', error: 'Requiere atención',
}
