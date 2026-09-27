import { RootState } from 'store/store'
import { ensureState } from 'redux-optimistic-ui'
import { createSelector } from '@reduxjs/toolkit'
import getPlayerHistory from './getPlayerHistory'
import { buildRoundRobinQueue } from './roundRobin'

const getResult = (state: RootState) => ensureState(state.queue).result
const getEntities = (state: RootState) => ensureState(state.queue).entities
const getQueueId = (state: RootState) => state.status.queueId
const getNextUserId = (state: RootState) => state.status.nextUserId

const getRoundRobinQueue = createSelector(
  [getResult, getEntities, getPlayerHistory, getQueueId, getNextUserId],
  buildRoundRobinQueue,
)

export default getRoundRobinQueue
