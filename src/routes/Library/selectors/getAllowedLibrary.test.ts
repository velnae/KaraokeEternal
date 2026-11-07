import { expect, it } from 'vitest'
import type { RootState } from 'store/store'
import { defaultMusicBlocking } from '../../../../shared/musicBlocking'
import { getAllowedArtists, getAllowedSongs } from './getAllowedLibrary'

it('filters local artist children and resources, and restores them after removing rules', () => {
  const state = {
    prefs: { musicBlocking: { rules: [...defaultMusicBlocking.rules, { kind: 'resource', source: 'LOCAL', sourceId: '3' }] } },
    songs: { result: [1, 2, 3], entities: { 1: { songId: 1, artistId: 1, title: 'Song' }, 2: { songId: 2, artistId: 2, title: 'El faraón' }, 3: { songId: 3, artistId: 2, title: 'Blocked song' } } },
    artists: { result: [1, 2], entities: { 1: { artistId: 1, name: 'Faraón Love Shady', songIds: [1] }, 2: { artistId: 2, name: 'Other', songIds: [2, 3] } } },
  } as unknown as RootState
  expect([...getAllowedSongs(state)]).toEqual([2])
  expect(getAllowedArtists(state).result).toEqual([2])
  expect(getAllowedArtists(state).entities[2].songIds).toEqual([2])
  expect(state.artists.entities[2].songIds).toEqual([2, 3])
  const unblocked: RootState = { ...state, prefs: { ...state.prefs, musicBlocking: { rules: [] } } }
  expect([...getAllowedSongs(unblocked)]).toEqual([1, 2, 3])
})
