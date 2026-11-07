import { createSelector } from '@reduxjs/toolkit'
import { getAllowedArtists } from './getAllowedLibrary'

const getAlphaPickerMap = createSelector(
  [getAllowedArtists],
  (artists) => {
    const map: Record<string, number> = { '#': 0 } // letters to row numbers
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    let c = 0

    artists.result.forEach((artistId, i) => {
      const char = artists.entities[artistId].name[0].toUpperCase()
      const distance = chars.indexOf(char) - c

      if (distance >= 0) {
        c += distance
        map[chars[c]] = i
        c++
      }
    })

    return map
  })

export default getAlphaPickerMap
