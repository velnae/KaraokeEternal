import { normalizeQueuePrefs } from './queueRules.js'
import type { QueueItem, OptimisticQueueItem } from './types.js'

export const ANIMATION_REQUEST = 'server/ANIMATION_REQUEST'
export const ANIMATION_CANCEL = 'server/ANIMATION_CANCEL'
export const ANIMATION_CONTROL = 'server/ANIMATION_CONTROL'
export const ANIMATION_RESERVE = 'server/ANIMATION_RESERVE'
export const ANIMATION_EVENT = 'server/ANIMATION_EVENT'
export const ANIMATION_READY = 'server/ANIMATION_READY'
export const ANIMATION_SYNC = 'server/ANIMATION_SYNC'
export const ANIMATION_AUTO = 'server/ANIMATION_AUTO'
export const ANIMATION_SESSION = 'server/ANIMATION_SESSION'
export const ANIMATION_AMBIENCE = 'server/ANIMATION_AMBIENCE'
export const ANIMATION_AMBIENCE_STOP = 'server/ANIMATION_AMBIENCE_STOP'
export const ANIMATION_AMBIENCE_STARTED = 'server/ANIMATION_AMBIENCE_STARTED'
export const ANIMATION_STATE = 'animation/STATE'
export const ANIMATION_DISCONNECTED = 'animation/DISCONNECTED'
export const ANIMATION_LIMITS = { clipMs: 10000, requestMs: 600000, startMs: 1000, marginMs: 500 }

export const VOICE_FAMILIES = ['welcome', 'turn', 'closing', 'invitation', 'celebration', 'goodbye', 'booth', 'promotion'] as const
export type VoiceFamily = typeof VOICE_FAMILIES[number]
export type AudioKind = 'voice' | 'effect' | 'ambience'
export type RoomProfile = 'dinner' | 'mixed' | 'party'
export const familyLabels: Record<VoiceFamily, string> = {
  welcome: 'Bienvenida', turn: 'Presentación', closing: 'Cierre neutral', invitation: 'Invitación',
  celebration: 'Celebración', goodbye: 'Despedida', booth: 'Guiño de cabina', promotion: 'Promoción',
}
export interface AnimationPrefs {
  enabled: boolean
  volume: number
  automation?: boolean
  profile?: RoomProfile
  ambienceEnabled?: boolean
  ambienceVolume?: number
  cutoffHour?: number
  events?: Partial<Record<VoiceFamily, boolean>>
}
export const animationPrefs = (value?: Partial<AnimationPrefs>) => ({
  enabled: value?.enabled === true,
  volume: typeof value?.volume === 'number' && Number.isFinite(value.volume)
    ? Math.max(0, Math.min(1, value.volume))
    : 0.5,
  automation: value?.automation === true,
  profile: (['dinner', 'mixed', 'party'].includes(value?.profile ?? '') ? value!.profile : 'mixed') as RoomProfile,
  ambienceEnabled: value?.ambienceEnabled === true,
  ambienceVolume: typeof value?.ambienceVolume === 'number' && Number.isFinite(value.ambienceVolume) ? Math.max(0, Math.min(1, value.ambienceVolume)) : 0.2,
  cutoffHour: Number.isInteger(value?.cutoffHour) && value!.cutoffHour! >= 0 && value!.cutoffHour! <= 23 ? value!.cutoffHour! : 4,
  events: Object.fromEntries(VOICE_FAMILIES.map(family => [family, value?.events?.[family] ?? !['booth', 'promotion'].includes(family)])) as Record<VoiceFamily, boolean>,
})
export const clipDurationLimit = (kind: AudioKind = 'voice') => kind === 'ambience' ? 30000 : kind === 'effect' ? 3000 : 10000

export interface AnimationClip {
  id: string
  title: string
  displayText: string
  durationMs: number
  checksum: string
  source: string
  license: string
  kind?: AudioKind
  family?: VoiceFamily | 'manual'
  modes?: RoomProfile[]
  approvedForAuto?: boolean
  weight?: number
  roomId?: number
  validUntil?: number
  loop?: boolean
}
export type InterventionStatus = 'PENDING' | 'RESERVED' | 'PLAYING' | 'PLAYED' | 'CANCELLED' | 'EXPIRED' | 'FAILED' | 'INTERRUPTED' | 'UNCERTAIN'
export interface Intervention {
  interventionId: string
  roomId: number
  requestId: string
  requestedByUserId: number
  clipId: string
  clipChecksum: string
  displayText: string
  durationMs: number
  status: InterventionStatus
  playerEpoch: number | null
  ownerSocketId: string | null
  contextKey: string | null
  transitionId: string | null
  requestedAt: number
  expiresAt: number
  startBefore: number | null
  leaseUntil: number | null
  startedAt: number | null
  finishedAt: number | null
  stopRequestedAt: number | null
  reason: string | null
  origin?: 'MANUAL' | 'AUTO'
  sessionId?: string | null
  sourceEventKey?: string | null
  family?: string | null
  sequenceJSON?: string
}
export interface AnimationRoomState {
  roomId: number
  playerEpoch: number
  controlVersion: number
  microphoneOccupied: number
  blockedUntil: number
  pendingEventJSON?: string | null
  ambienceJSON?: string | null
  lastOmission?: string | null
}
export interface AnimationSession {
  sessionId: string
  roomId: number
  status: 'OPEN' | 'CLOSING' | 'CLOSED'
  openedAt: number
  closedAt: number | null
  closingDeadline: number | null
  businessDate: string
  openedBy: number
}
export interface AmbienceGrant {
  id: string
  clip: AnimationClip
  ownerSocketId: string
  playerEpoch: number
  until: number
  durationMs: number
  offsetMs: number
}
export interface AnimationSnapshot extends AnimationRoomState {
  prefs: AnimationPrefs
  active: Intervention | null
  history: Intervention[]
  playerPresent: boolean
  audioUnlocked: boolean
  readyClips: string[]
  serverTime: number
  session?: AnimationSession | null
  ambience?: AmbienceGrant | null
  catalogVersion?: number
  voiceBudgetRemainingMs?: number
}
export interface AnimationReply {
  type: string
  error?: string
  payload?: AnimationSnapshot
  grant?: Intervention
  ambience?: AmbienceGrant
}

export function interventionAssets (row: Intervention): AnimationClip[] {
  try {
    const sequence: AnimationClip[] = JSON.parse(row.sequenceJSON ?? '[]')
    if (Array.isArray(sequence) && sequence.length) return sequence
  } catch { /* Legacy rows contain only a single clip snapshot. */ }
  return [{ id: row.clipId, checksum: row.clipChecksum, durationMs: row.durationMs, displayText: row.displayText, title: '', source: '', license: '' }]
}

// Compare scheduling inputs, not computed order: the player remains the scheduler.
export function animationContext (queue: { entities: Record<number, QueueItem | OptimisticQueueItem> }, prefs: unknown): string {
  return JSON.stringify([
    Object.values(queue.entities).filter((item): item is QueueItem => item.isOptimistic !== true && (item.status === 'APPROVED' || item.status === 'PLAYING'))
      .sort((a, b) => a.queueId - b.queueId)
      .map(item => [item.queueId, item.prevQueueId, item.status, item.userId, item.origin]),
    normalizeQueuePrefs(prefs),
  ])
}

export const interventionLabels: Record<InterventionStatus, string> = {
  PENDING: 'Esperando una pausa', RESERVED: 'Preparando el inicio', PLAYING: 'Reproduciendo anuncio',
  PLAYED: 'Reproducido', CANCELLED: 'Cancelado', EXPIRED: 'Vencido', FAILED: 'Fallido',
  INTERRUPTED: 'Interrumpido', UNCERTAIN: 'Resultado incierto',
}
