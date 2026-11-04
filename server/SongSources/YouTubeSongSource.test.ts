import { afterEach, describe, expect, it, vi } from 'vitest'
import { createYouTubeSongSource, YouTubeApiError, parseIsoDuration } from './YouTubeSongSource.js'

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
})

const playableVideo = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    title: 'Song &amp; Dance',
    channelTitle: 'Singer &quot;Official&quot;',
    categoryId: '10',
    liveBroadcastContent: 'none',
    thumbnails: { high: { url: `https://img.youtube.com/${id}.jpg` } },
  },
  contentDetails: { duration: 'PT3M5S' },
  status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
  ...overrides,
})

afterEach(() => vi.restoreAllMocks())

describe('YouTube playlist inspection', () => {
  const playlistId = 'PLfixture00000001'
  const entry = (videoId: string, position: number) => ({ contentDetails: { videoId }, snippet: { title: `Title ${position}`, position } })

  it('paginates and batches video lookups while preserving playlist order and explaining omissions', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `video${String(i).padStart(6, '0')}`)
    const entries = [...ids.map(entry), entry(ids[0], 51), entry('missing0001', 52), entry('toolong0001', 53)]
    const fetchImpl = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith('/playlists')) return jsonResponse({ items: [{ snippet: { title: 'Music &amp; Friends' }, contentDetails: { itemCount: entries.length } }] })
      if (url.pathname.endsWith('/playlistItems')) {
        expect(url.searchParams.get('maxResults')).toBe('50')
        return jsonResponse(url.searchParams.has('pageToken') ? { items: entries.slice(50) } : { items: entries.slice(0, 50), nextPageToken: 'second' })
      }
      expect(url.pathname).toMatch(/\/videos$/)
      const requested = url.searchParams.get('id')!.split(',')
      expect(requested.length).toBeLessThanOrEqual(50)
      return jsonResponse({ items: requested.filter(id => id !== 'missing0001').reverse().map(id => playableVideo(id, id === 'toolong0001' ? { contentDetails: { duration: 'PT8M' } } : {})) })
    })
    const result = await createYouTubeSongSource({ apiKey: 'secret', fetchImpl }).inspectPlaylist(playlistId)
    expect(result.title).toBe('Music & Friends')
    expect(result.songs.map(song => song.sourceId)).toEqual(ids)
    expect(result.omissions.map(item => [item.position, item.reason])).toEqual([[52, 'DUPLICATE'], [53, 'UNAVAILABLE'], [54, 'DURATION']])
    expect(fetchImpl).toHaveBeenCalledTimes(5)
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it.each([
    [{ status: { embeddable: false, privacyStatus: 'public', uploadStatus: 'processed' } }, 'EMBEDDING'],
    [{ contentDetails: { duration: 'PT3M', contentRating: { ytRating: 'ytAgeRestricted' } } }, 'AGE'],
    [{ contentDetails: { duration: 'PT3M', regionRestriction: { blocked: ['PE'] } } }, 'REGION'],
    [{ snippet: { title: 'Other', channelTitle: 'Channel', categoryId: '22' } }, 'CATEGORY'],
    [{ snippet: { title: 'Live', channelTitle: 'Channel', categoryId: '10', liveBroadcastContent: 'upcoming' } }, 'LIVE'],
  ])('explains rejected videos using the shared eligibility rules', async (overrides, reason) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [{ snippet: { title: 'List' } }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [entry('AAAAAAAAAAA', 0)] }))
      .mockResolvedValueOnce(jsonResponse({ items: [playableVideo('AAAAAAAAAAA', overrides as Record<string, unknown>)] }))
    const result = await createYouTubeSongSource({ apiKey: 'secret', fetchImpl }).inspectPlaylist(playlistId)
    expect(result.songs).toHaveLength(0)
    expect(result.omissions[0].reason).toBe(reason)
  })

  it('bounds oversized playlists even when the reported count is absent and pagination repeats', async () => {
    const fetchImpl = vi.fn(async (url: URL) => url.pathname.endsWith('/playlists')
      ? jsonResponse({ items: [{ snippet: { title: 'Large list' } }] })
      : jsonResponse({ items: Array.from({ length: 50 }, (_, i) => entry('AAAAAAAAAAA', i)), nextPageToken: 'repeated' }))
    await expect(createYouTubeSongSource({ apiKey: 'secret', fetchImpl }).inspectPlaylist(playlistId)).rejects.toThrow('supera los 200')
    expect(fetchImpl).toHaveBeenCalledTimes(5)
  })

  it('rejects known oversized or inaccessible playlists and surfaces a later-page failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [{ snippet: { title: 'Large' }, contentDetails: { itemCount: 201 } }] }))
    const source = createYouTubeSongSource({ apiKey: 'secret', fetchImpl })
    await expect(source.inspectPlaylist(playlistId)).rejects.toThrow('supera los 200')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    fetchImpl.mockResolvedValueOnce(jsonResponse({ error: { errors: [{ reason: 'playlistNotFound' }] } }, 404))
    await expect(source.inspectPlaylist(playlistId)).rejects.toThrow('Comprueba el enlace')
    fetchImpl.mockResolvedValueOnce(jsonResponse({ items: [{ snippet: { title: 'Partial' } }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [entry('AAAAAAAAAAA', 0)], nextPageToken: 'next' }))
      .mockResolvedValueOnce(jsonResponse({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403))
    await expect(source.inspectPlaylist(playlistId)).rejects.toMatchObject({ code: 'YOUTUBE_QUOTA' })
  })

  it('returns an empty preview without video lookups for an empty playlist', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ items: [{ snippet: { title: 'Empty' } }] }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    expect(await createYouTubeSongSource({ apiKey: 'secret', fetchImpl }).inspectPlaylist(playlistId)).toEqual({ title: 'Empty', songs: [], omissions: [] })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('YouTubeSongSource', () => {
  it('coalesces concurrent searches and reuses metadata across rooms until cache expiry', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const fetchImpl = vi.fn(async (url: URL) => url.pathname.endsWith('/search')
      ? jsonResponse({ items: [{ id: { videoId: 'AAAAAAAAAAA' } }] })
      : jsonResponse({ items: [playableVideo('AAAAAAAAAAA')] }))
    const source = createYouTubeSongSource({ apiKey: 'secret', fetchImpl })
    const [first, second] = await Promise.all([source.search('Song title', { roomId: 1 }), source.search(' song  TITLE ', { roomId: 2 })])
    expect(first).toEqual(second)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    first[0].title = 'Changed by consumer'
    expect((await source.search('Song title', { roomId: 2 }))[0].title).toBe('Song & Dance')
    clock.mockReturnValue(601001)
    await source.search('Song title', { roomId: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    await source.resolve('AAAAAAAAAAA', { roomId: 1 })
    expect(fetchImpl).toHaveBeenCalledTimes(5)
  })

  it('recognizes the real daily search bucket 429 and still resolves pasted links', async () => {
    const fetchImpl = vi.fn(async (url: URL) => url.pathname.endsWith('/search')
      ? jsonResponse({ error: { errors: [{ reason: 'rateLimitExceeded' }], details: [{ reason: 'RATE_LIMIT_EXCEEDED', metadata: {
          quota_metric: 'youtube.googleapis.com/search_list', quota_limit: 'defaultSearchListPerDayPerProject', quota_unit: '1/d/{project}',
        } }] } }, 429)
      : jsonResponse({ items: [playableVideo('AAAAAAAAAAA')] }))
    const source = createYouTubeSongSource({ apiKey: 'secret', fetchImpl })
    await expect(source.search('song', { roomId: 1 })).rejects.toMatchObject({ code: 'YOUTUBE_SEARCH_QUOTA' })
    await expect(source.search('another song', { roomId: 2 })).rejects.toMatchObject({ code: 'YOUTUBE_SEARCH_QUOTA' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(source.search('https://youtu.be/AAAAAAAAAAA?si=example', { roomId: 1 })).resolves.toMatchObject([{ sourceId: 'AAAAAAAAAAA' }])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(new URL(fetchImpl.mock.calls[1][0]).pathname).toMatch(/\/videos$/)
  })

  it('serves cached results during quota exhaustion without caching failed queries forever', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, 429))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
    const source = createYouTubeSongSource({ apiKey: 'secret', fetchImpl })
    await source.search('cached query', { roomId: 1 })
    await expect(source.search('new query', { roomId: 1 })).rejects.toMatchObject({ code: 'YOUTUBE_RATE_LIMIT' })
    await expect(source.search('cached query', { roomId: 1 })).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    clock.mockReturnValue(61001)
    await expect(source.search('new query', { roomId: 1 })).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('sanitizes malformed provider responses and bounds search requests', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>private provider diagnostic</html>', { status: 503 }))
    const source = createYouTubeSongSource({ apiKey: 'secret', fetchImpl })
    await expect(source.search('song', { roomId: 1 })).rejects.toMatchObject({ code: 'YOUTUBE_API', message: 'YouTube devolvió una respuesta no válida. Intenta nuevamente.' })
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
  it('searches videos, verifies playback metadata, and never exposes the API key', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [
          { id: { videoId: 'BBBBBBBBBBB' } },
          { id: { videoId: 'AAAAAAAAAAA' } },
          { id: { videoId: 'CCCCCCCCCCC' } },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          playableVideo('AAAAAAAAAAA'),
          playableVideo('BBBBBBBBBBB'),
          playableVideo('CCCCCCCCCCC', { status: { embeddable: false, privacyStatus: 'public', uploadStatus: 'processed' } }),
        ],
      }))
    const source = createYouTubeSongSource({ apiKey: 'server-secret', fetchImpl, regionCode: 'PE' })

    const results = await source.search('karaoke song', { roomId: 4 })

    expect(results.map(result => result.sourceId)).toEqual(['BBBBBBBBBBB', 'AAAAAAAAAAA'])
    expect(results[0]).toMatchObject({
      source: 'YOUTUBE',
      title: 'Song & Dance',
      artistOrChannel: 'Singer "Official"',
      durationSeconds: 185,
      isPlayable: true,
    })
    expect(String(fetchImpl.mock.calls[0][0])).toContain('key=server-secret')
    expect(Object.fromEntries(new URL(fetchImpl.mock.calls[0][0]).searchParams)).toMatchObject({
      part: 'snippet',
      type: 'video',
      q: 'karaoke song',
      regionCode: 'PE',
      safeSearch: 'moderate',
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
      videoCategoryId: '10',
    })
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get('part')).toBe('snippet,contentDetails,status')
    expect(JSON.stringify(results)).not.toContain('server-secret')
  })

  it.each([
    { name: 'age restricted', details: { contentRating: { ytRating: 'ytAgeRestricted' } }, eligible: false },
    { name: 'missing content rating', details: {}, eligible: true },
    { name: 'missing YouTube rating', details: { contentRating: {} }, eligible: true },
    { name: 'empty YouTube rating', details: { contentRating: { ytRating: '' } }, eligible: true },
    { name: 'allowed country', details: { regionRestriction: { allowed: ['PE'] } }, eligible: true },
    { name: 'excluded country', details: { regionRestriction: { allowed: ['US'] } }, eligible: false },
    { name: 'empty allowed countries', details: { regionRestriction: { allowed: [] } }, eligible: false },
    { name: 'blocked country', details: { regionRestriction: { blocked: ['PE'] } }, eligible: false },
    { name: 'other blocked country', details: { regionRestriction: { blocked: ['US'] } }, eligible: true },
    { name: 'empty blocked countries', details: { regionRestriction: { blocked: [] } }, eligible: true },
    { name: 'not embeddable', status: { embeddable: false }, eligible: false },
    { name: 'private', status: { privacyStatus: 'private' }, eligible: false },
    { name: 'not processed', status: { uploadStatus: 'uploaded' }, eligible: false },
  ])('keeps search and resolution consistent for $name', async ({ details, status, eligible }) => {
    const candidate = playableVideo('CCCCCCCCCCC')
    const video = {
      ...candidate,
      contentDetails: { ...candidate.contentDetails, ...details },
      status: { ...candidate.status, ...status },
    }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [
        { id: { videoId: 'BBBBBBBBBBB' } },
        { id: { videoId: video.id } },
        { id: { videoId: 'AAAAAAAAAAA' } },
      ] }))
      .mockResolvedValueOnce(jsonResponse({ items: [playableVideo('AAAAAAAAAAA'), video, playableVideo('BBBBBBBBBBB')] }))
      .mockResolvedValueOnce(jsonResponse({ items: [video] }))
    const source = createYouTubeSongSource({ apiKey: 'server-secret', fetchImpl, regionCode: 'PE' })

    const results = await source.search('song', { roomId: 1 })
    expect(results.map(result => result.sourceId)).toEqual(eligible
      ? ['BBBBBBBBBBB', video.id, 'AAAAAAAAAAA']
      : ['BBBBBBBBBBB', 'AAAAAAAAAAA'])
    const resolved = await source.resolve(video.id, { roomId: 1 })
    expect(resolved).toMatchObject({ sourceId: video.id, isPlayable: eligible })
    expect(JSON.stringify({ results, resolved })).not.toContain('server-secret')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('resolves a video but marks non-embeddable and region-blocked videos unplayable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      items: [playableVideo('AAAAAAAAAAA', {
        contentDetails: { duration: 'PT3M5S', regionRestriction: { blocked: ['PE'] } },
        status: { embeddable: false, privacyStatus: 'public', uploadStatus: 'processed' },
      })],
    }))
    const source = createYouTubeSongSource({ apiKey: 'secret', fetchImpl, regionCode: 'PE' })

    await expect(source.resolve('AAAAAAAAAAA', { roomId: 1 })).resolves.toMatchObject({
      durationSeconds: 185,
      isPlayable: false,
    })
    await expect(source.resolve('not-a-video-id', { roomId: 1 })).resolves.toBeNull()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('classifies unconfigured, quota, and transport failures without leaking credentials', async () => {
    const unconfigured = createYouTubeSongSource({ apiKey: '' })
    await expect(unconfigured.search('song', { roomId: 1 })).rejects.toMatchObject({
      code: 'YOUTUBE_UNCONFIGURED',
      message: 'La búsqueda en YouTube no está configurada',
    })

    const quotaFetch = vi.fn().mockResolvedValue(jsonResponse({
      error: { message: 'Quota exhausted', errors: [{ reason: 'quotaExceeded' }] },
    }, 403))
    const quota = createYouTubeSongSource({ apiKey: 'quota-secret', fetchImpl: quotaFetch })
    const quotaError = await quota.search('song', { roomId: 1 }).catch(error => error)
    expect(quotaError).toBeInstanceOf(YouTubeApiError)
    expect(quotaError).toMatchObject({ code: 'YOUTUBE_QUOTA', message: 'Se agotó la cuota de búsqueda de YouTube' })
    expect(JSON.stringify(quotaError)).not.toContain('quota-secret')

    const unavailable = createYouTubeSongSource({
      apiKey: 'transport-secret',
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
    })
    await expect(unavailable.search('song', { roomId: 1 })).rejects.toMatchObject({
      code: 'YOUTUBE_API',
      message: 'YouTube no está disponible temporalmente',
    })
  })

  it.each([
    { name: 'exactly seven minutes', duration: 'PT7M', categoryId: '10', liveBroadcastContent: 'none', eligible: true },
    { name: 'seven minutes and one second', duration: 'PT7M1S', categoryId: '10', liveBroadcastContent: 'none', eligible: false },
    { name: 'unknown duration', duration: undefined, categoryId: '10', liveBroadcastContent: 'none', eligible: false },
    { name: 'malformed duration', duration: 'invalid', categoryId: '10', liveBroadcastContent: 'none', eligible: false },
    { name: 'zero duration', duration: 'PT0S', categoryId: '10', liveBroadcastContent: 'none', eligible: false },
    { name: 'live broadcast', duration: 'PT3M', categoryId: '10', liveBroadcastContent: 'live', eligible: false },
    { name: 'upcoming broadcast', duration: 'PT3M', categoryId: '10', liveBroadcastContent: 'upcoming', eligible: false },
    { name: 'non-music category', duration: 'PT3M', categoryId: '22', liveBroadcastContent: 'none', eligible: false },
    { name: 'unknown category', duration: 'PT3M', categoryId: undefined, liveBroadcastContent: 'none', eligible: false },
  ])('enforces music eligibility on search, links and fresh resolution: $name', async ({ duration, categoryId, liveBroadcastContent, eligible }) => {
    const video = playableVideo('AAAAAAAAAAA')
    const candidate = { ...video, snippet: { ...video.snippet, categoryId, liveBroadcastContent }, contentDetails: { duration } }
    const fetchImpl = vi.fn(async (url: URL) => url.pathname.endsWith('/search')
      ? jsonResponse({ items: [{ id: { videoId: video.id } }] })
      : jsonResponse({ items: [candidate] }))
    const source = createYouTubeSongSource({ apiKey: 'secret', fetchImpl })
    expect(await source.search('song', { roomId: 1 })).toHaveLength(eligible ? 1 : 0)
    if (eligible) {
      await expect(source.search(`https://youtu.be/${video.id}`, { roomId: 1 })).resolves.toMatchObject([{ durationSeconds: 420 }])
      await expect(source.resolve(video.id, { roomId: 1 })).resolves.toMatchObject({ isPlayable: true, durationSeconds: 420 })
    } else {
      await expect(source.search(`https://youtu.be/${video.id}`, { roomId: 1 })).rejects.toMatchObject({ code: 'YOUTUBE_VIDEO_UNSUPPORTED', message: expect.stringContaining('7 minutos') })
      await expect(source.resolve(video.id, { roomId: 1 })).rejects.toMatchObject({ code: 'YOUTUBE_VIDEO_UNSUPPORTED' })
    }
    expect(fetchImpl.mock.calls.filter(([url]) => url.pathname.endsWith('/search'))).toHaveLength(1)
  })

  it('parses ISO 8601 durations used by YouTube', () => {
    expect(parseIsoDuration('PT4M9S')).toBe(249)
    expect(parseIsoDuration('P1DT2H')).toBe(93600)
    expect(parseIsoDuration('invalid')).toBeNull()
  })
})
