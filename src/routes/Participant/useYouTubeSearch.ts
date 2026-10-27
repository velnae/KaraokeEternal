import { useEffect, useState } from 'react'
import socket from 'lib/socket'
import { SONG_SOURCE_SEARCH, SONG_SOURCE_SEARCH_SUCCESS } from 'shared/actionTypes'
import type { SongSearchResult } from 'shared/songSource'
import { youtubeQuery, type YouTubeSearchMode } from 'shared/youtubeSearch'
import { useConnection } from './useConnection'

interface SearchState {
  attempt: number
  query: string
  isLoading: boolean
  error: string | null
  code: string | null
  results: SongSearchResult[]
}
const empty: SearchState = { attempt: 0, query: '', isLoading: false, error: null, code: null, results: [] }

export const useYouTubeSearch = (query: string, mode: YouTubeSearchMode, retry: number, enabled: boolean) => {
  const [search, setSearch] = useState(empty)
  const connected = useConnection()
  const effectiveQuery = enabled && query.trim().length >= 2 ? youtubeQuery(query, mode) : ''
  useEffect(() => {
    let active = true
    if (!effectiveQuery || !connected) return
    const initial = { ...empty, attempt: retry, query: effectiveQuery }
    const timer = setTimeout(async () => {
      if (!socket.connected) {
        setSearch({ ...initial, error: 'Sin conexión', code: 'CONNECTION' })
        return
      }
      // Refreshing the same query must not unmount cards with an open action or pending request.
      setSearch(previous => ({ ...initial, isLoading: true, results: previous.query === effectiveQuery ? previous.results : [] }))
      try {
        const response = await socket.timeout(12000).emitWithAck('action', {
          type: SONG_SOURCE_SEARCH, payload: { query: effectiveQuery },
        })
        if (!active) return
        setSearch(response.type === SONG_SOURCE_SEARCH_SUCCESS
          ? { ...initial, results: response.payload.results }
          : { ...initial, code: response.payload?.code, error: 'No se pudo buscar en YouTube' })
      } catch {
        if (active) setSearch({ ...initial, error: 'No se pudo confirmar la búsqueda', code: 'CONNECTION' })
      }
    }, 350)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [effectiveQuery, retry, connected])
  if (!effectiveQuery) return empty
  if (!connected) return { ...empty, query: effectiveQuery, code: 'CONNECTION', error: 'Sin conexión' }
  return search.query === effectiveQuery && search.attempt === retry
    ? search
    : { ...empty, query: effectiveQuery, isLoading: socket.connected }
}
