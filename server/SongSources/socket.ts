import {
  SONG_SOURCE_SEARCH,
  SONG_SOURCE_SEARCH_ERROR,
  SONG_SOURCE_SEARCH_SUCCESS,
} from '../../shared/actionTypes.js'
import { getSongSource } from './index.js'
import { YouTubeApiError } from './YouTubeSongSource.js'

const ACTION_HANDLERS = {
  [SONG_SOURCE_SEARCH]: async (sock, { payload }, acknowledge) => {
    const query = typeof payload?.query === 'string' ? payload.query.trim() : ''
    const roomId = sock.user.roomId

    if (query.length < 2) {
      return acknowledge({
        type: SONG_SOURCE_SEARCH_SUCCESS,
        payload: { query, results: [] },
      })
    }

    try {
      const results = await getSongSource('YOUTUBE').search(query, { roomId })
      acknowledge({
        type: SONG_SOURCE_SEARCH_SUCCESS,
        payload: { query, results },
      })
    } catch (err) {
      acknowledge({
        type: SONG_SOURCE_SEARCH_ERROR,
        payload: {
          query,
          code: err instanceof YouTubeApiError ? err.code : 'YOUTUBE_API',
          error: err instanceof Error ? err.message : 'YouTube search failed',
        },
      })
    }
  },
}

export default ACTION_HANDLERS
