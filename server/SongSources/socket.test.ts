import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Prefs from '../Prefs/Prefs.js'
import { defaultMusicBlocking } from '../../shared/musicBlocking.js'
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
  beforeEach(() => vi.spyOn(Prefs, 'getMusicBlocking').mockReturnValue(defaultMusicBlocking))
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
      payload: { query: 'karaoke', results, blockedCount: 0 },
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

  it('filters cached/provider results and distinguishes fully blocked searches from no matches', async () => {
    const song = { source: 'YOUTUBE' as const, sourceId: 'AAAAAAAAAAA', title: 'FARAÓN LOVE SHADY - Tema (karaoke)', artistOrChannel: 'Karaoke Channel', durationSeconds: 120, thumbnailUrl: null, isPlayable: true }
    vi.spyOn(youtubeSongSource, 'search').mockResolvedValue([song])
    const ack = vi.fn()
    await handler(socket, { payload: { query: song.sourceId } }, ack)
    expect(ack.mock.calls[0][0].payload).toMatchObject({ results: [], blockedCount: 1 })
    vi.mocked(Prefs.getMusicBlocking).mockReturnValue({ rules: [] })
    await handler(socket, { payload: { query: song.sourceId } }, ack)
    expect(ack.mock.calls[1][0].payload).toMatchObject({ results: [song], blockedCount: 0 })
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
