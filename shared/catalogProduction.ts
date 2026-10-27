import type { AudioKind, VoiceFamily, RoomProfile } from './animation.js'

export type VoiceStyle = 'warm' | 'cheerful' | 'celebration'
export const voicePrompt = (text: string, style: VoiceStyle) => `${{ warm: '[warmly]', cheerful: '[cheerfully]', celebration: '[excited]' }[style]} ${text.normalize('NFC').replace(/\s+/g, ' ').trim()}`
export interface ProductionInput {
  providerId?: string
  category?: string
  language?: string
  loop?: boolean
  parentId?: string
  versionRequestId?: string
  title: string
  text: string
  kind: AudioKind
  family: VoiceFamily | 'manual'
  style: VoiceStyle
  voiceId?: string
  durationSeconds?: number
  revision?: number
  modes?: RoomProfile[]
  validUntil?: number
}
export interface ProductionConfig extends ProductionInput {
  model: string
  spokenText: string
  settings: { stability: number, similarity_boost: number }
  processingRevision: number
}
export interface GenerationJob {
  jobId: string
  roomId: number
  config: ProductionConfig
  status: 'queued' | 'generating' | 'ready_for_review' | 'publishing' | 'published' | 'rejected' | 'failed' | 'uncertain' | 'cancelled'
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  units: number
  unitType: 'characters' | 'seconds'
  estimatedCost: number | null
  providerRequestId: string | null
  durationMs: number | null
  error: string | null
  active?: boolean
}
export interface ProductionStatus {
  configured: boolean
  connectionVerified: boolean
  processorAvailable: boolean
  unavailableReason?: string | null
  model: string
  voiceId: string
  voices?: { voiceId: string, name: string }[]
  characterLimit: number
  effectSecondsLimit: number
  usedCharacters: number
  usedEffectSeconds: number
  pricePerThousandCharacters: number | null
  pricePerEffectSecond: number | null
}
export const pilotTexts: Record<VoiceFamily, string[]> = {
  turn: ['La siguiente canción ya está lista. Sigamos disfrutando juntos.', 'Seguimos compartiendo música. Vamos con la próxima canción.', 'La noche continúa con una nueva canción para compartir.'],
  closing: ['Gracias por compartir este momento con nosotros.', 'Una canción más para recordar. Gracias por acompañarnos.', 'Seguimos disfrutando la noche juntos. Gracias por participar.'],
  invitation: ['Escanea el QR de tu mesa y elige tu próxima canción.', 'Tu canción favorita puede ser la siguiente. Pídela desde el QR.', 'La música también la eliges tú. Encuentra el QR de tu mesa.'],
  welcome: ['Bienvenidos a Il Gatto. Disfruten la música y su mesa.', 'Qué gusto recibirlos. Compartamos una noche de música y buena compañía.', 'Bienvenidos. La mesa y las canciones ya están listas para disfrutar.'],
  goodbye: ['Gracias por acompañarnos esta noche. Hasta la próxima.', 'Nos despedimos con cariño. Gracias por compartir su música.', 'Una gran noche termina. Gracias por ser parte de ella.'],
  celebration: ['Hoy tenemos un motivo especial para celebrar. Un aplauso para compartir.', 'Brindemos por este momento especial. Que siga la alegría.', 'Esta celebración merece un aplauso. Disfruten juntos este momento.'],
  booth: ['Probando, uno, dos, tres. Todo listo para seguir compartiendo.', 'Una pequeña pausa y volvemos con más canciones.', 'Aquí seguimos, acompañando la noche con buena música.'],
  promotion: [],
}
