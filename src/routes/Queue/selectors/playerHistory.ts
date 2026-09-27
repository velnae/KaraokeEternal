import { PLAYED_QUEUE_STATUSES } from '../../../../shared/queueLifecycle'
import type { OptimisticQueueItem, QueueItem } from '../../../../shared/types.js'

export const buildPlayerHistory = (
  historyJSON: string,
  result: number[],
  entities: Record<number, QueueItem | OptimisticQueueItem>,
): number[] => {
  let transientHistory: number[] = []

  try {
    const parsed = JSON.parse(historyJSON)
    if (Array.isArray(parsed)) {
      transientHistory = parsed.filter(queueId => Number.isInteger(queueId))
    }
  } catch {
    // Persisted terminal state remains available when player history is malformed.
  }

  const transientIds = new Set(transientHistory)
  const persistedHistory = result
    .filter((queueId) => {
      const queued = entities[queueId]
      return queued.isOptimistic !== true && PLAYED_QUEUE_STATUSES.has(queued.status)
    })
    .sort((leftId, rightId) => {
      const left = entities[leftId] as QueueItem
      const right = entities[rightId] as QueueItem
      return left.dateUpdated - right.dateUpdated || left.queueId - right.queueId
    })
    .filter(queueId => !transientIds.has(queueId))

  return [...persistedHistory, ...transientHistory]
}
