import { createAction, createReducer } from '@reduxjs/toolkit'
import {
  LIBRARY_FILTER_STRING,
  LIBRARY_FILTER_STRING_RESET,
  LIBRARY_FILTER_TOGGLE_STARRED,
  LIBRARY_PUSH,
  TOGGLE_ARTIST_EXPANDED,
  TOGGLE_ARTIST_RESULT_EXPANDED,
  SCROLL_ARTISTS,
  SONG_SOURCE_SEARCH,
  SONG_SOURCE_SEARCH_CLEAR,
  SONG_SOURCE_SEARCH_ERROR,
  SONG_SOURCE_SEARCH_SUCCESS,
} from 'shared/actionTypes'
import type { SongSearchResult } from 'shared/songSource'

// ------------------------------------
// Actions
// ------------------------------------
export const scrollArtists = createAction<number>(SCROLL_ARTISTS)
export const toggleArtistExpanded = createAction<number>(TOGGLE_ARTIST_EXPANDED)
export const toggleArtistResultExpanded = createAction<number>(TOGGLE_ARTIST_RESULT_EXPANDED)
const libraryPush = createAction<LibraryState>(LIBRARY_PUSH)

export const resetFilterStr = createAction(LIBRARY_FILTER_STRING_RESET)
export const toggleFilterStarred = createAction<void>(LIBRARY_FILTER_TOGGLE_STARRED)
export const searchYouTube = createAction<{ query: string }>(SONG_SOURCE_SEARCH)
export const clearYouTubeSearch = createAction(SONG_SOURCE_SEARCH_CLEAR)
const searchYouTubeSuccess = createAction<{ query: string, results: SongSearchResult[] }>(SONG_SOURCE_SEARCH_SUCCESS)
const searchYouTubeError = createAction<{ query: string, code: string, error: string }>(SONG_SOURCE_SEARCH_ERROR)
export const setFilterStr = createAction(LIBRARY_FILTER_STRING, (payload: string) => ({
  payload,
  meta: {
    throttle: {
      wait: 350,
      leading: false,
    },
  },
}))

// ------------------------------------
// Reducer
// ------------------------------------
interface LibraryState {
  isLoading: boolean
  version: number
  filterStr: string
  filterStarred: boolean
  scrollRow: number
  expandedArtists: number[]
  expandedArtistResults: number[]
  youtubeSearch: {
    query: string
    isLoading: boolean
    error: string | null
    code: string | null
    results: SongSearchResult[]
  }
}

const initialState: LibraryState = {
  isLoading: true,
  version: 0,
  filterStr: '',
  filterStarred: false,
  scrollRow: 0,
  expandedArtists: [],
  expandedArtistResults: [],
  youtubeSearch: {
    query: '',
    isLoading: false,
    error: null,
    code: null,
    results: [],
  },
}

const libraryReducer = createReducer(initialState, (builder) => {
  builder
    .addCase(setFilterStr, (state, { payload }) => {
      state.filterStr = payload
    })
    .addCase(resetFilterStr, (state) => {
      state.filterStr = ''
    })
    .addCase(toggleFilterStarred, (state) => {
      state.filterStarred = !state.filterStarred
    })
    .addCase(searchYouTube, (state, { payload }) => {
      state.youtubeSearch = {
        query: payload.query,
        isLoading: true,
        error: null,
        code: null,
        results: [],
      }
    })
    .addCase(searchYouTubeSuccess, (state, { payload }) => {
      if (payload.query !== state.youtubeSearch.query) return
      state.youtubeSearch.isLoading = false
      state.youtubeSearch.results = payload.results
    })
    .addCase(searchYouTubeError, (state, { payload }) => {
      if (payload.query !== state.youtubeSearch.query) return
      state.youtubeSearch.isLoading = false
      state.youtubeSearch.error = payload.error
      state.youtubeSearch.code = payload.code
    })
    .addCase(clearYouTubeSearch, (state) => {
      state.youtubeSearch = initialState.youtubeSearch
    })
    .addCase(scrollArtists, (state, { payload }) => {
      state.scrollRow = payload
    })
    .addCase(toggleArtistExpanded, (state, { payload }) => {
      const idx = state.expandedArtists.indexOf(payload)

      if (idx === -1) state.expandedArtists.push(payload)
      else state.expandedArtists.splice(idx, 1)
    })
    .addCase(toggleArtistResultExpanded, (state, { payload }) => {
      const idx = state.expandedArtistResults.indexOf(payload)

      if (idx === -1) state.expandedArtistResults.push(payload)
      else state.expandedArtistResults.splice(idx, 1)
    })
    .addCase(libraryPush, (state, { payload }) => ({
      ...state,
      isLoading: false,
      version: payload.version,
    }))
})

export default libraryReducer
