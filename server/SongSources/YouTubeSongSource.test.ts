import { describe, expect, it, vi } from 'vitest'
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
    thumbnails: { high: { url: `https://img.youtube.com/${id}.jpg` } },
  },
  contentDetails: { duration: 'PT3M5S' },
  status: { embeddable: true, privacyStatus: 'public', uploadStatus: 'processed' },
  ...overrides,
})

describe('YouTubeSongSource', () => {
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
    expect(JSON.stringify(results)).not.toContain('server-secret')
  })

  it('resolves a video but marks non-embeddable and region-blocked videos unplayable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      items: [playableVideo('AAAAAAAAAAA', {
        contentDetails: { duration: 'PT1H2M3S', regionRestriction: { blocked: ['PE'] } },
        status: { embeddable: false, privacyStatus: 'public', uploadStatus: 'processed' },
      })],
    }))
    const source = createYouTubeSongSource({ apiKey: 'secret', fetchImpl, regionCode: 'PE' })

    await expect(source.resolve('AAAAAAAAAAA', { roomId: 1 })).resolves.toMatchObject({
      durationSeconds: 3723,
      isPlayable: false,
    })
    await expect(source.resolve('not-a-video-id', { roomId: 1 })).resolves.toBeNull()
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('classifies unconfigured, quota, and transport failures without leaking credentials', async () => {
    const unconfigured = createYouTubeSongSource({ apiKey: '' })
    await expect(unconfigured.search('song', { roomId: 1 })).rejects.toMatchObject({ code: 'YOUTUBE_UNCONFIGURED' })

    const quotaFetch = vi.fn().mockResolvedValue(jsonResponse({
      error: { message: 'Quota exhausted', errors: [{ reason: 'quotaExceeded' }] },
    }, 403))
    const quota = createYouTubeSongSource({ apiKey: 'quota-secret', fetchImpl: quotaFetch })
    const quotaError = await quota.search('song', { roomId: 1 }).catch(error => error)
    expect(quotaError).toBeInstanceOf(YouTubeApiError)
    expect(quotaError).toMatchObject({ code: 'YOUTUBE_QUOTA' })
    expect(JSON.stringify(quotaError)).not.toContain('quota-secret')

    const unavailable = createYouTubeSongSource({
      apiKey: 'transport-secret',
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')),
    })
    await expect(unavailable.search('song', { roomId: 1 })).rejects.toMatchObject({ code: 'YOUTUBE_API' })
  })

  it('parses ISO 8601 durations used by YouTube', () => {
    expect(parseIsoDuration('PT4M9S')).toBe(249)
    expect(parseIsoDuration('P1DT2H')).toBe(93600)
    expect(parseIsoDuration('invalid')).toBeNull()
  })
})
