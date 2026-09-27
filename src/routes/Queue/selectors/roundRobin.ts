import type { OptimisticQueueItem, QueueItem } from '../../../../shared/types.js'
import type { QueuePrefs } from '../../../../shared/queueRules.js'

export const buildRoundRobinQueue = (
  result: number[],
  entities: Record<number, QueueItem | OptimisticQueueItem>,
  history: number[],
  curId: number,
  nextUserId: number | null,
  prefs: Pick<QueuePrefs, 'maxSongsPerParticipantRound' | 'rotationMode'>,
) => {
  // in case history references non-existent items or queue is still loading
  history = history.filter(queueId => result.includes(queueId))

  // consider current item played (don't re-order it)
  if (entities[curId] && history.lastIndexOf(curId) === -1) {
    history.push(curId)
  }

  const isEligible = (queueId: number): boolean => {
    const item = entities[queueId]
    return item.isOptimistic !== true
      && item.origin === 'PARTICIPANT'
      && item.status === 'APPROVED'
  }

  // "lock in" the next participant item (don't re-order it)
  if (nextUserId !== null) {
    for (const queueId of result) {
      if (!history.includes(queueId)
        && isEligible(queueId)
        && (entities[queueId] as QueueItem).userId === nextUserId
      ) {
        history.push(queueId)
        break
      }
    }
  }

  const eligible = result.filter(queueId => !history.includes(queueId) && isEligible(queueId))

  if (prefs.rotationMode === 'FIFO') {
    const upcoming = eligible.sort((leftId, rightId) => {
      const left = entities[leftId] as QueueItem
      const right = entities[rightId] as QueueItem
      return left.dateCreated - right.dateCreated || left.queueId - right.queueId
    })

    return {
      result: history.concat(upcoming),
      entities: entities as Record<number, QueueItem>,
    }
  }

  const map = new Map<number, number[]>()
  const upcoming: number[] = []
  const resultByUser = history
    .filter(queueId => entities[queueId]?.isOptimistic !== true && entities[queueId]?.origin === 'PARTICIPANT')
    .map(queueId => (entities[queueId] as QueueItem).userId)

  eligible.forEach((queueId) => {
    const userId = (entities[queueId] as QueueItem).userId
    map.set(userId, map.has(userId) ? [...map.get(userId), queueId] : [queueId])
  })

  const appendTurn = (userId: number, limit: number) => {
    const userItems = map.get(userId) ?? []
    const turnItems = userItems.splice(0, limit)

    if (userItems.length) map.set(userId, userItems)
    else map.delete(userId)

    resultByUser.push(...turnItems.map(() => userId))
    upcoming.push(...turnItems)
  }

  const trailingUserId = resultByUser[resultByUser.length - 1]
  if (typeof trailingUserId === 'number' && map.has(trailingUserId)) {
    let consecutive = 0
    for (let i = resultByUser.length - 1; i >= 0 && resultByUser[i] === trailingUserId; i--) consecutive++

    const remainingInTurn = prefs.maxSongsPerParticipantRound - consecutive
    if (remainingInTurn > 0) appendTurn(trailingUserId, remainingInTurn)
  }

  while (map.size) {
    let max = -1
    let maxUserId

    for (const userId of map.keys()) {
      const idx = resultByUser.lastIndexOf(userId)
      const distance = idx === -1 ? Infinity : resultByUser.length - idx

      if (distance > max) {
        max = distance
        maxUserId = userId
      }
    }

    appendTurn(maxUserId, prefs.maxSongsPerParticipantRound)
  }

  return {
    result: history.concat(upcoming) as number[],
    entities: entities as Record<number, QueueItem>,
  }
}
