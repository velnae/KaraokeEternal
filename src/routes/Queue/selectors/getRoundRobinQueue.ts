import { RootState } from 'store/store'
import { ensureState } from 'redux-optimistic-ui'
import { createSelector } from '@reduxjs/toolkit'
import getPlayerHistory from './getPlayerHistory'
import { buildRoundRobinQueue } from './roundRobin'
import { normalizeQueuePrefs } from 'shared/queueRules'

const getResult = (state: RootState) => ensureState(state.queue).result
const getEntities = (state: RootState) => ensureState(state.queue).entities
const getQueueId = (state: RootState) => state.status.queueId
const getNextUserId = (state: RootState) => state.status.nextUserId
const getRoomQueuePrefs = (state: RootState) => {
  const roomId = state.user.roomId
  return typeof roomId === 'number' ? state.rooms.entities[roomId]?.prefs?.queue : undefined
}

const getRoundRobinQueue = createSelector(
  [getResult, getEntities, getPlayerHistory, getQueueId, getNextUserId, getRoomQueuePrefs],
  (result, entities, history, queueId, nextUserId, queuePrefs) => buildRoundRobinQueue(
    result,
    entities,
    history,
    queueId,
    nextUserId,
    normalizeQueuePrefs(queuePrefs),
  ),
)

export default getRoundRobinQueue
