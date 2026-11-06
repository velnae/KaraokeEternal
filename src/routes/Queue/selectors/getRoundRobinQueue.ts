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
const getDecisionTime = (state: RootState) => state.status.queueDecisionAt || undefined
const getRoomQueuePrefs = (state: RootState) => {
  const roomId = state.user.roomId
  return typeof roomId === 'number' ? state.rooms.entities[roomId]?.prefs?.queue : undefined
}

const getRoundRobinQueue = createSelector(
  [getResult, getEntities, getPlayerHistory, getQueueId, getNextUserId, getRoomQueuePrefs, getDecisionTime],
  (result, entities, history, queueId, nextUserId, queuePrefs, nowSeconds) => buildRoundRobinQueue(
    result,
    entities,
    history,
    queueId,
    nextUserId,
    normalizeQueuePrefs(queuePrefs),
    nowSeconds,
  ),
)

export default getRoundRobinQueue

// The authoritative player must not select from its delayed status echo.
export const getPlaybackQueue = (state: RootState) => getRoundRobinQueue({
  ...state,
  status: {
    ...state.status,
    queueId: state.player.queueId,
    historyJSON: state.player.historyJSON,
    nextUserId: state.player.nextUserId,
    queueDecisionAt: state.player.queueDecisionAt,
  },
})
