import type { QueueItem } from './types.js'

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
