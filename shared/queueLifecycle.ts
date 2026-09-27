export const QUEUE_ITEM_ORIGINS = ['PARTICIPANT', 'HOUSE', 'OPERATOR'] as const
export const SONG_SOURCES = ['LOCAL', 'YOUTUBE'] as const
export const QUEUE_ITEM_STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'PLAYING',
  'PLAYED',
  'REJECTED',
  'REMOVED',
  'FAILED',
] as const

export type QueueItemOrigin = typeof QUEUE_ITEM_ORIGINS[number]
export type SongSource = typeof SONG_SOURCES[number]
export type QueueItemStatus = typeof QUEUE_ITEM_STATUSES[number]

export const PENDING_QUEUE_STATUSES: ReadonlySet<QueueItemStatus> = new Set([
  'PENDING_APPROVAL',
  'APPROVED',
])

export const PLAYED_QUEUE_STATUSES: ReadonlySet<QueueItemStatus> = new Set([
  'PLAYED',
  'FAILED',
])

const TRANSITIONS: Readonly<Record<QueueItemStatus, ReadonlySet<QueueItemStatus>>> = {
  PENDING_APPROVAL: new Set(['APPROVED', 'REJECTED', 'REMOVED']),
  APPROVED: new Set(['PLAYING', 'PLAYED', 'REMOVED', 'FAILED']),
  PLAYING: new Set(['APPROVED', 'PLAYED', 'FAILED']),
  PLAYED: new Set(),
  REJECTED: new Set(),
  REMOVED: new Set(),
  FAILED: new Set(),
}

export const isQueueItemStatus = (value: unknown): value is QueueItemStatus => {
  return typeof value === 'string' && QUEUE_ITEM_STATUSES.includes(value as QueueItemStatus)
}

export const canTransitionQueueItem = (from: QueueItemStatus, to: QueueItemStatus): boolean => {
  return from === to || TRANSITIONS[from].has(to)
}
