import type { OptimisticQueueItem, QueueItem } from './types.js'
import type { QueuePrefs } from './queueRules.js'

export interface ParticipantTurn {
  ids: number[]
  startsNewTurn: boolean
}

export const HOUSE_BACKLOG_LIMIT = 3
export const HOUSE_WAIT_LIMIT_SECONDS = 10 * 60

export const houseInterleaving = (pending: QueueItem[], nowSeconds: number, configuredLimit: number) => {
  const oldestWait = pending.length ? Math.max(0, nowSeconds - Math.min(...pending.map(item => item.dateCreated))) : 0
  const reason = pending.length >= HOUSE_BACKLOG_LIMIT ? 'backlog' : oldestWait >= HOUSE_WAIT_LIMIT_SECONDS ? 'wait' : null
  return { limit: reason ? 0 : Math.min(1, configuredLimit), reason, pendingCount: pending.length }
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
  nowSeconds = Math.floor(Date.now() / 1000),
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
  const turns = prefs.rotationMode === 'FIFO'
    ? buildFifoTurns(unlockedParticipantIds, entities, lockedId)
    : buildFairTurns(
        unlockedParticipantIds,
        entities,
        fixedHistory,
        lockedId,
        curId,
        nowSeconds,
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
    nowSeconds,
  )

  return {
    result: fixedHistory.concat(scheduled),
    entities: entities as Record<number, QueueItem>,
    turns,
    housePolicy: houseInterleaving(participantIds.map(id => entities[id] as QueueItem), nowSeconds, prefs.houseTracksBeforeParticipant),
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
  history: number[],
  lockedId: number | undefined,
  curId: number,
  nowSeconds: number,
): ParticipantTurn[] => {
  const byUser = new Map<number, number[]>()
  const turns: ParticipantTurn[] = []
  const lastTurn = new Map<number, number>()
  for (const id of history) {
    const item = entities[id]
    // A failed song has not served the customer's turn.
    if (!isPersistedItem(item) || item.origin !== 'PARTICIPANT' || item.status === 'FAILED') continue
    const servedAt = id === curId || item.status !== 'PLAYED' ? nowSeconds : item.dateUpdated
    lastTurn.set(item.userId, Math.max(lastTurn.get(item.userId) ?? 0, servedAt))
  }
  const chronological = (left: number, right: number) => {
    const a = entities[left] as QueueItem
    const b = entities[right] as QueueItem
    return a.dateCreated - b.dateCreated || a.queueId - b.queueId
  }
  const ids = lockedId === undefined ? participantIds : [...participantIds, lockedId]
  ids.forEach((queueId) => {
    const userId = (entities[queueId] as QueueItem).userId
    byUser.set(userId, [...(byUser.get(userId) ?? []), queueId])
  })
  const waiting = [...byUser.keys()].sort((a, b) => {
    const firstA = byUser.get(a)![0]
    const firstB = byUser.get(b)![0]
    const oldestA = Math.min(...byUser.get(a)!.map(id => (entities[id] as QueueItem).dateCreated))
    const oldestB = Math.min(...byUser.get(b)!.map(id => (entities[id] as QueueItem).dateCreated))
    const servedA = lastTurn.get(a) ?? -1
    const servedB = lastTurn.get(b) ?? -1
    const sinceA = Math.max(oldestA, servedA)
    const sinceB = Math.max(oldestB, servedB)
    // Persisted timestamps have second precision. A completed turn joins behind
    // requests already waiting in that second, not ahead of them by old queueId.
    return sinceA - sinceB || Number(servedA >= oldestA) - Number(servedB >= oldestB) || chronological(firstA, firstB)
  })
  if (lockedId !== undefined) {
    const userId = (entities[lockedId] as QueueItem).userId
    waiting.splice(waiting.indexOf(userId), 1)
    waiting.unshift(userId)
    const songs = byUser.get(userId)!
    songs.splice(songs.indexOf(lockedId), 1)
    songs.unshift(lockedId)
  }
  while (waiting.length) {
    const userId = waiting.shift()!
    const songs = byUser.get(userId)!
    turns.push({ ids: [songs.shift()!], startsNewTurn: true })
    if (songs.length) waiting.push(userId)
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
  nowSeconds: number,
): number[] => {
  const scheduled: number[] = []
  let houseIndex = 0
  let hasParticipant = false
  let housesSinceParticipant = 0
  let projectedTime = nowSeconds
  let pending = upcoming.map(id => entities[id] as QueueItem).filter(item => item.origin === 'PARTICIPANT')

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
        Math.max(0, houseInterleaving(pending, projectedTime, limit).limit - housesSinceParticipant),
        housePool.length - houseIndex,
      )
      scheduled.push(...housePool.slice(houseIndex, houseIndex + amount))
      projectedTime += housePool.slice(houseIndex, houseIndex + amount).reduce((sum, id) => sum + ((entities[id] as QueueItem).durationSeconds ?? 180), 0)
      houseIndex += amount
    }

    scheduled.push(queueId)
    projectedTime += item.durationSeconds ?? 180

    if (item.origin === 'PARTICIPANT') {
      hasParticipant = true
      housesSinceParticipant = 0
      pending = pending.filter(candidate => candidate.queueId !== queueId)
    }
  })

  // With no approved participant waiting, the house pool supplies idle music.
  if (!upcoming.some(queueId => (entities[queueId] as QueueItem).origin === 'PARTICIPANT')) {
    scheduled.push(...housePool.slice(houseIndex))
  }
  return scheduled
}
