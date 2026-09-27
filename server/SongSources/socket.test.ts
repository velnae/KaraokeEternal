import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SONG_SOURCE_SEARCH,
  SONG_SOURCE_SEARCH_ERROR,
  SONG_SOURCE_SEARCH_SUCCESS,
} from '../../shared/actionTypes.js'
import { youtubeSongSource, YouTubeApiError } from './YouTubeSongSource.js'
import ACTION_HANDLERS from './socket.js'

const handler = ACTION_HANDLERS[SONG_SOURCE_SEARCH]
const socket = { user: { roomId: 8 } }

describe('song source search socket', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns normalized YouTube results to the requesting client', async () => {
    const results = [{
      source: 'YOUTUBE' as const,
      sourceId: 'AAAAAAAAAAA',
      title: 'Song',
      artistOrChannel: 'Channel',
      durationSeconds: 120,
      thumbnailUrl: null,
      isPlayable: true,
    }]
    vi.spyOn(youtubeSongSource, 'search').mockResolvedValue(results)
    const acknowledge = vi.fn()

    await handler(socket, { payload: { query: '  karaoke  ' } }, acknowledge)

    expect(youtubeSongSource.search).toHaveBeenCalledWith('karaoke', { roomId: 8 })
    expect(acknowledge).toHaveBeenCalledWith({
      type: SONG_SOURCE_SEARCH_SUCCESS,
      payload: { query: 'karaoke', results },
    })
  })

  it('isolates quota failures in the search response', async () => {
    vi.spyOn(youtubeSongSource, 'search').mockRejectedValue(new YouTubeApiError('Quota exceeded', 'YOUTUBE_QUOTA'))
    const acknowledge = vi.fn()

    await handler(socket, { payload: { query: 'karaoke' } }, acknowledge)

    expect(acknowledge).toHaveBeenCalledWith({
      type: SONG_SOURCE_SEARCH_ERROR,
      payload: { query: 'karaoke', code: 'YOUTUBE_QUOTA', error: 'Quota exceeded' },
    })
  })

  it('does not call YouTube for undersized queries', async () => {
    const search = vi.spyOn(youtubeSongSource, 'search')
    const acknowledge = vi.fn()

    await handler(socket, { payload: { query: 'a' } }, acknowledge)

    expect(search).not.toHaveBeenCalled()
    expect(acknowledge).toHaveBeenCalledWith({
      type: SONG_SOURCE_SEARCH_SUCCESS,
      payload: { query: 'a', results: [] },
    })
  })
})
