import { RootState } from 'store/store'
import { ensureState } from 'redux-optimistic-ui'
import { createSelector } from '@reduxjs/toolkit'
import { PLAYED_QUEUE_STATUSES } from 'shared/queueLifecycle'

const getPlayerHistoryJSON = (state: RootState) => state.status.historyJSON
const getResult = (state: RootState) => ensureState(state.queue).result
const getEntities = (state: RootState) => ensureState(state.queue).entities

const getPlayerHistory = createSelector(
  [getPlayerHistoryJSON, getResult, getEntities],
  (historyJSON, result, entities) => {
    const transientHistory = JSON.parse(historyJSON) as number[]
    const persistedHistory = result.filter((queueId) => {
      const item = entities[queueId]
      return item.isOptimistic !== true && PLAYED_QUEUE_STATUSES.has(item.status)
    })

    return Array.from(new Set([...persistedHistory, ...transientHistory]))
  },
)

export default getPlayerHistory
