import type { OptimisticQueueItem, QueueItem } from '../../../../shared/types.js'
import type { QueuePrefs } from '../../../../shared/queueRules.js'

interface ParticipantTurn {
  ids: number[]
  startsNewTurn: boolean
}

const isPersistedItem = (
  item: QueueItem | OptimisticQueueItem | undefined,
): item is QueueItem => item !== undefined && item.isOptimistic !== true

export const buildRoundRobinQueue = (
  result: number[],
  entities: Record<number, QueueItem | OptimisticQueueItem>,
  history: number[],
  curId: number,
  nextUserId: number | null,
  prefs: Pick<QueuePrefs, 'houseTracksBeforeParticipant' | 'maxSongsPerParticipantRound' | 'rotationMode'>,
) => {
  // History/current are an immutable playback prefix and may contain every origin.
  const fixedHistory = history.filter(queueId => result.includes(queueId))
  if (entities[curId] && !fixedHistory.includes(curId)) fixedHistory.push(curId)

  const isApprovedOrigin = (queueId: number, origin: QueueItem['origin']): boolean => {
    const item = entities[queueId]
    return isPersistedItem(item) && item.origin === origin && item.status === 'APPROVED'
  }

  const participantIds = result.filter(queueId => (
    !fixedHistory.includes(queueId) && isApprovedOrigin(queueId, 'PARTICIPANT')
  ))
  const lockedId = nextUserId === null
    ? undefined
    : participantIds.find(queueId => (entities[queueId] as QueueItem).userId === nextUserId)
  const unlockedParticipantIds = participantIds.filter(queueId => queueId !== lockedId)
  const participantHistory = fixedHistory
    .filter((queueId) => {
      const item = entities[queueId]
      return isPersistedItem(item) && item.origin === 'PARTICIPANT'
    })
    .map(queueId => (entities[queueId] as QueueItem).userId)

  const turns = prefs.rotationMode === 'FIFO'
    ? buildFifoTurns(unlockedParticipantIds, entities, lockedId)
    : buildFairTurns(
        unlockedParticipantIds,
        entities,
        participantHistory,
        lockedId,
        prefs.maxSongsPerParticipantRound,
      )

  const participantOrder = turns.flatMap(turn => turn.ids)
  const turnStarts = new Set(
    turns.filter(turn => turn.startsNewTurn).map(turn => turn.ids[0]),
  )
  const upcoming = mergeOperatorItems(result, entities, fixedHistory, participantOrder)
  const housePool = result.filter(queueId => (
    !fixedHistory.includes(queueId) && isApprovedOrigin(queueId, 'HOUSE')
  ))
  const scheduled = interleaveHouseItems(
    upcoming,
    entities,
    fixedHistory,
    housePool,
    turnStarts,
    prefs.houseTracksBeforeParticipant,
  )

  return {
    result: fixedHistory.concat(scheduled),
    entities: entities as Record<number, QueueItem>,
  }
}

const buildFifoTurns = (
  participantIds: number[],
  entities: Record<number, QueueItem | OptimisticQueueItem>,
  lockedId?: number,
): ParticipantTurn[] => {
  const sorted = [...participantIds].sort((leftId, rightId) => {
    const left = entities[leftId] as QueueItem
    const right = entities[rightId] as QueueItem
    return left.dateCreated - right.dateCreated || left.queueId - right.queueId
  })

  return (lockedId === undefined ? sorted : [lockedId, ...sorted])
    .map(queueId => ({ ids: [queueId], startsNewTurn: true }))
}

const buildFairTurns = (
  participantIds: number[],
  entities: Record<number, QueueItem | OptimisticQueueItem>,
  participantHistory: number[],
  lockedId: number | undefined,
  turnLimit: number,
): ParticipantTurn[] => {
  const byUser = new Map<number, number[]>()
  const turns: ParticipantTurn[] = []
  const resultByUser = [...participantHistory]

  participantIds.forEach((queueId) => {
    const userId = (entities[queueId] as QueueItem).userId
    byUser.set(userId, [...(byUser.get(userId) ?? []), queueId])
  })

  const appendTurn = (
    userId: number,
    limit: number,
    startsNewTurn: boolean,
    initialIds: number[] = [],
  ) => {
    const userItems = byUser.get(userId) ?? []
    const ids = [...initialIds, ...userItems.splice(0, Math.max(0, limit - initialIds.length))]

    if (userItems.length) byUser.set(userId, userItems)
    else byUser.delete(userId)

    resultByUser.push(...ids.map(() => userId))
    if (ids.length) turns.push({ ids, startsNewTurn })
  }

  const trailingUserId = resultByUser[resultByUser.length - 1]
  let trailingCount = 0
  for (let i = resultByUser.length - 1; i >= 0 && resultByUser[i] === trailingUserId; i--) trailingCount++

  if (lockedId !== undefined) {
    const lockedUserId = (entities[lockedId] as QueueItem).userId
    const continuesTurn = lockedUserId === trailingUserId && trailingCount < turnLimit
    const limit = continuesTurn ? turnLimit - trailingCount : turnLimit
    appendTurn(lockedUserId, limit, !continuesTurn, [lockedId])
  } else if (typeof trailingUserId === 'number' && byUser.has(trailingUserId)) {
    const remainingInTurn = turnLimit - trailingCount
    if (remainingInTurn > 0) appendTurn(trailingUserId, remainingInTurn, false)
  }

  while (byUser.size) {
    let longestWait = -1
    let selectedUserId: number | undefined

    for (const userId of byUser.keys()) {
      const idx = resultByUser.lastIndexOf(userId)
      const distance = idx === -1 ? Infinity : resultByUser.length - idx

      if (distance > longestWait) {
        longestWait = distance
        selectedUserId = userId
      }
    }

    if (selectedUserId === undefined) break
    appendTurn(selectedUserId, turnLimit, true)
  }

  return turns
}

const mergeOperatorItems = (
  result: number[],
  entities: Record<number, QueueItem | OptimisticQueueItem>,
  fixedHistory: number[],
  participantOrder: number[],
): number[] => {
  const slots = new Map<number, number[]>()
  let participantSlot = 0

  result.forEach((queueId) => {
    if (fixedHistory.includes(queueId)) return
    const item = entities[queueId]
    if (!isPersistedItem(item) || item.status !== 'APPROVED') return

    if (item.origin === 'PARTICIPANT') {
      participantSlot++
    } else if (item.origin === 'OPERATOR') {
      slots.set(participantSlot, [...(slots.get(participantSlot) ?? []), queueId])
    }
  })

  const merged: number[] = []
  participantOrder.forEach((queueId, index) => {
    merged.push(...(slots.get(index) ?? []), queueId)
  })
  merged.push(...(slots.get(participantOrder.length) ?? []))

  // Filtering may leave an operator beyond the final participant slot.
  for (const [slot, queueIds] of slots) {
    if (slot > participantOrder.length) merged.push(...queueIds)
  }

  return merged
}

const interleaveHouseItems = (
  upcoming: number[],
  entities: Record<number, QueueItem | OptimisticQueueItem>,
  fixedHistory: number[],
  housePool: number[],
  turnStarts: Set<number>,
  limit: number,
): number[] => {
  const scheduled: number[] = []
  let houseIndex = 0
  let hasParticipant = false
  let housesSinceParticipant = 0

  for (let i = fixedHistory.length - 1; i >= 0; i--) {
    const item = entities[fixedHistory[i]]
    if (!isPersistedItem(item)) continue
    if (item.origin === 'PARTICIPANT') {
      hasParticipant = true
      break
    }
    if (item.origin === 'HOUSE') housesSinceParticipant++
  }

  upcoming.forEach((queueId) => {
    const item = entities[queueId] as QueueItem

    if (item.origin === 'PARTICIPANT' && turnStarts.has(queueId) && hasParticipant) {
      const amount = Math.min(
        Math.max(0, limit - housesSinceParticipant),
        housePool.length - houseIndex,
      )
      scheduled.push(...housePool.slice(houseIndex, houseIndex + amount))
      houseIndex += amount
    }

    scheduled.push(queueId)

    if (item.origin === 'PARTICIPANT') {
      hasParticipant = true
      housesSinceParticipant = 0
    }
  })

  return scheduled
}
