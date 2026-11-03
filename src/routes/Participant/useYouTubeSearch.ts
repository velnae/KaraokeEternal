import { useEffect, useRef, useState } from 'react'
import socket from 'lib/socket'
import { SONG_SOURCE_SEARCH, SONG_SOURCE_SEARCH_SUCCESS } from 'shared/actionTypes'
import type { SongSearchResult } from 'shared/songSource'
import { youtubeQuery, type YouTubeSearchMode } from 'shared/youtubeSearch'
import { useConnection } from './useConnection'

interface SearchState {
  query: string
  isLoading: boolean
  error: string | null
  code: string | null
  results: SongSearchResult[]
}
const empty: SearchState = { query: '', isLoading: false, error: null, code: null, results: [] }

export const useYouTubeSearch = (enabled: boolean) => {
  const [search, setSearch] = useState(empty)
  const sequence = useRef(0)
  const connected = useConnection()

  useEffect(() => {
    const invalidate = () => {
      sequence.current++
    }
    const onDisconnect = () => {
      invalidate()
      setSearch(previous => previous.isLoading
        ? { ...previous, isLoading: false, error: 'Búsqueda interrumpida. Vuelve a buscar.', code: 'CONNECTION' }
        : previous)
    }
    socket.on('disconnect', onDisconnect)
    return () => {
      invalidate()
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  // Only an explicit submission spends search quota, including after reconnecting.
  const submit = async (query: string, mode: YouTubeSearchMode = 'all') => {
    if (!enabled || query.trim().length < 2) return
    const initial = { ...empty, query: youtubeQuery(query, mode) }
    const attempt = ++sequence.current
    if (!socket.connected) {
      setSearch({ ...initial, error: 'Sin conexión', code: 'CONNECTION' })
      return
    }
    // Retain cards on a retry so pending requests and open actions stay mounted.
    setSearch(previous => ({ ...initial, isLoading: true, results: previous.query === initial.query ? previous.results : [] }))
    try {
      const response = await socket.timeout(12000).emitWithAck('action', {
        type: SONG_SOURCE_SEARCH, payload: { query: initial.query },
      })
      if (attempt !== sequence.current) return
      setSearch(response.type === SONG_SOURCE_SEARCH_SUCCESS
        ? { ...initial, results: response.payload.results }
        : { ...initial, code: response.payload?.code, error: 'No se pudo buscar en YouTube' })
    } catch {
      if (attempt === sequence.current) setSearch({ ...initial, error: 'No se pudo confirmar la búsqueda', code: 'CONNECTION' })
    }
  }

  const state = !enabled
    ? empty
    : !connected && search.query
        ? { ...search, isLoading: false, code: 'CONNECTION', error: 'Sin conexión' }
        : search
  return { ...state, submit }
}
