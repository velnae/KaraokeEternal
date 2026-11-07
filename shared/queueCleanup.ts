import type { QueueItem } from './types.js'

export const clearedQueuePlayback = {
  queueId: -1,
  historyJSON: '[]',
  isPlaying: false,
  isAtQueueEnd: true,
  isErrored: false,
  errorMessage: '',
  position: 0,
  mediaType: null as QueueItem['mediaType'] | null,
  nextUserId: null as number | null,
  queueDecisionAt: 0,
}

export type QueueCleanupOperation = 'pending' | 'history'
export interface QueueCleanupRequest {
  operation: QueueCleanupOperation
  requestId: string
  throughQueueId: number
  expiresAt: number
}
export interface QueueCleanupResult {
  operation: QueueCleanupOperation
  requestId: string
  changedCount: number
  houseStopped: boolean
}
export const isQueueHistoryHidden = (item: QueueItem) => !!item.historyClearedAt
  && ['PLAYED', 'FAILED', 'REJECTED', 'REMOVED'].includes(item.status)
