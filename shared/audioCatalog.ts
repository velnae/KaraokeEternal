import type { AudioKind, RoomProfile, VoiceFamily } from './animation.js'

export type ResourceState = 'active' | 'disabled' | 'archived'
export type PreparationState = 'queued' | 'generating' | 'preparing' | 'ready' | 'failed' | 'uncertain' | 'cancelled'
export interface AudioMetadata {
  text: string
  family: VoiceFamily | 'manual'
  modes: RoomProfile[]
  category?: string
  language?: string
  style?: string
  loop?: boolean
  voiceId?: string
  voiceName?: string
  providerId?: string
  model?: string
  validUntil?: number
  automatic?: boolean
  origin: 'generated' | 'uploaded' | 'included'
  source?: string
  license?: string
  originalName?: string
  parentId?: string
  generationInput?: Record<string, unknown>
}
export interface AudioResource {
  id: string
  roomId: number | null
  kind: AudioKind
  title: string
  state: ResourceState
  preparation: PreparationState
  metadata: AudioMetadata
  durationMs: number | null
  size: number | null
  mime: string | null
  checksum: string | null
  error: string | null
  createdAt: number
  updatedAt: number
}
export interface ResourcePage {
  items: AudioResource[]
  total: number
  page: number
  pageSize: number
  counts: Record<AudioKind, number>
}
export interface ProviderCapabilities {
  id: string
  name: string
  configured: boolean
  kinds: AudioKind[]
  models: Partial<Record<AudioKind, string>>
  styles: string[]
  languages: string[]
  loop: boolean
}
export const resourceKindLabels: Record<AudioKind, string> = {
  voice: 'Voz del animador', effect: 'Efectos de apoyo', ambience: 'Ambiente de pausa',
}
export function resourceStatus (resource: AudioResource) {
  if (resource.state === 'archived') return 'Archivado'
  if (resource.preparation !== 'ready') return {
    queued: 'En cola', generating: 'Generando…', preparing: 'Preparando…', failed: 'Error', uncertain: 'Sin confirmación', cancelled: 'Cancelado',
  }[resource.preparation]
  return resource.state === 'active' ? 'Disponible' : 'Desactivado'
}
