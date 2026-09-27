import { RootState } from 'store/store'
import { createSelector } from '@reduxjs/toolkit'
import getPlayerHistory from './getPlayerHistory'
import getRoundRobinQueue from './getRoundRobinQueue'

const getPosition = (state: RootState) => state.status.position
const getQueue = (state: RootState) => getRoundRobinQueue(state)
const getQueueId = (state: RootState) => state.status.queueId
const getSongs = (state: RootState) => state.songs

const getWaits = createSelector(
  [getQueue, getQueueId, getPlayerHistory, getPosition, getSongs],
  (queue, queueId, history, position, songs) => {
    const curIdx = queue.result.indexOf(queueId)
    const waits: Record<number, number> = {}
    let curWait = 0
    let nextWait = 0

    queue.result.forEach((queueId, i) => {
      const item = queue.entities[queueId]
      const localDuration = typeof item.songId === 'number' ? songs.entities[item.songId]?.duration : undefined
      const duration = item.durationSeconds ?? localDuration
      if (typeof duration !== 'number') return

      if (i === curIdx) {
        // if history includes the current item it's already been played
        if (history.lastIndexOf(queueId) === -1) {
          nextWait = Math.round(duration - position)
        }
      } else if (i > curIdx) {
        // upcoming
        curWait += nextWait
        nextWait = duration
      }

      waits[queueId] = curWait
    })

    return waits
  },
)

export default getWaits
