import { RootState } from 'store/store'
import { ensureState } from 'redux-optimistic-ui'
import { createSelector } from '@reduxjs/toolkit'
import { buildPlayerHistory } from './playerHistory'

const getPlayerHistoryJSON = (state: RootState) => state.status.historyJSON
const getResult = (state: RootState) => ensureState(state.queue).result
const getEntities = (state: RootState) => ensureState(state.queue).entities

const getPlayerHistory = createSelector(
  [getPlayerHistoryJSON, getResult, getEntities],
  buildPlayerHistory,
)

export default getPlayerHistory
