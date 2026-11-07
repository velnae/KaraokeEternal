import type { QueueItem, OptimisticQueueItem } from '../../../../shared/types'
import { isQueueHistoryHidden } from '../../../../shared/queueCleanup'

// Presentation only: keep the scheduler's order and distinguish repeated plays by queueId.
export function operatorQueue (
  orderedIds: number[],
  entities: Record<number, QueueItem | OptimisticQueueItem>,
  history: number[],
  queueId: number,
  isAtQueueEnd: boolean,
) {
  const candidate = entities[queueId]
  const currentId = !isAtQueueEnd && candidate && candidate.isOptimistic !== true ? queueId : undefined
  const upcomingIds = orderedIds.filter((id) => {
    const item = entities[id]
    return item && item.isOptimistic !== true && item.status === 'APPROVED'
      && id !== currentId && !history.includes(id)
  })
  const completedIds = history.filter((id) => {
    const item = entities[id]
    return item && item.isOptimistic !== true && id !== currentId && !isQueueHistoryHidden(item)
  })
  return [...(currentId === undefined ? [] : [currentId]), ...upcomingIds, ...completedIds]
}
