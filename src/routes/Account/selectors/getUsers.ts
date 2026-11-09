import { RootState } from 'store/store'
import { createSelector } from '@reduxjs/toolkit'
import { normalizeUserSearch, userGroup } from '../userGroups'

const getResult = (state: RootState) => state.users.result
const getEntities = (state: RootState) => state.users.entities
const getFilterOnline = (state: RootState) => state.users.filterOnline
const getFilterRoomId = (state: RootState) => state.users.filterRoomId
const getFilterGroup = (state: RootState) => state.users.filterGroup || 'staff'
const getQuery = (state: RootState) => state.users.query || ''

const getUsers = createSelector(
  [getResult, getEntities, getFilterOnline, getFilterRoomId, getFilterGroup, getQuery],
  (result, entities, filterOnline, filterRoomId, filterGroup, query) => {
    const keywords = normalizeUserSearch(query).split(/\s+/).filter(Boolean)
    result = result.filter((userId) => {
      const user = entities[userId]
      const text = normalizeUserSearch(`${user.name} ${user.username || ''}`)
      return userGroup(user.role) === filterGroup && keywords.every(keyword => text.includes(keyword))
    })
    if (filterOnline) {
      result = result.filter(userId => entities[userId].rooms.length)
    } else if (typeof filterRoomId === 'number') {
      result = result.filter(userId => entities[userId].rooms.includes(filterRoomId))
    }

    return {
      result,
      entities,
    }
  })

export default getUsers
