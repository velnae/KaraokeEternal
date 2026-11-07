import { createSelector } from '@reduxjs/toolkit'
import type { RootState } from 'store/store'
import { findMusicBlock } from '../../../../shared/musicBlocking'

export const getAllowedSongs = createSelector(
  [(state: RootState) => state.songs, (state: RootState) => state.artists, (state: RootState) => state.prefs.musicBlocking],
  (songs, artists, settings) => new Set(songs.result.filter((id) => {
    const song = songs.entities[id]
    return !findMusicBlock({ source: 'LOCAL', sourceId: String(id), title: song.title, artistOrChannel: artists.entities[song.artistId]?.name ?? '' }, settings)
  })),
)

export const getAllowedArtists = createSelector(
  [(state: RootState) => state.artists, getAllowedSongs],
  (artists, allowed) => {
    const entities = Object.fromEntries(Object.values(artists.entities).map(artist => [artist.artistId, { ...artist, songIds: artist.songIds.filter(id => allowed.has(id)) }]))
    return { ...artists, entities, result: artists.result.filter(id => entities[id].songIds.length > 0) }
  },
)
