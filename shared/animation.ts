import { normalizeQueuePrefs } from './queueRules.js'
import type { QueueItem, OptimisticQueueItem } from './types.js'

export const ANIMATION_REQUEST = 'server/ANIMATION_REQUEST'
export const ANIMATION_CANCEL = 'server/ANIMATION_CANCEL'
export const ANIMATION_CONTROL = 'server/ANIMATION_CONTROL'
export const ANIMATION_RESERVE = 'server/ANIMATION_RESERVE'
export const ANIMATION_EVENT = 'server/ANIMATION_EVENT'
export const ANIMATION_READY = 'server/ANIMATION_READY'
export const ANIMATION_SYNC = 'server/ANIMATION_SYNC'
export const ANIMATION_STATE = 'animation/STATE'
export const ANIMATION_DISCONNECTED = 'animation/DISCONNECTED'
export const ANIMATION_LIMITS = { clipMs: 10000, requestMs: 600000, startMs: 1000, marginMs: 500 }

export interface AnimationPrefs { enabled: boolean, volume: number }
export const animationPrefs = (value?: Partial<AnimationPrefs>): AnimationPrefs => ({
  enabled: value?.enabled === true,
  volume: typeof value?.volume === 'number' && Number.isFinite(value.volume)
    ? Math.max(0, Math.min(1, value.volume))
    : 0.5,
})

export interface AnimationClip {
  id: string
  title: string
  displayText: string
  durationMs: number
  checksum: string
  source: string
  license: string
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
}
export interface AnimationRoomState {
  roomId: number
  playerEpoch: number
  controlVersion: number
  microphoneOccupied: number
  blockedUntil: number
}
export interface AnimationSnapshot extends AnimationRoomState {
  prefs: AnimationPrefs
  active: Intervention | null
  history: Intervention[]
  playerPresent: boolean
  audioUnlocked: boolean
  readyClips: string[]
  serverTime: number
}
export interface AnimationReply {
  type: string
  error?: string
  payload?: AnimationSnapshot
  grant?: Intervention
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
