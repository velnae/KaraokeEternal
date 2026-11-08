import { describe, expect, it } from 'vitest'
import { isKaraokeTitle, youtubeQuery, youtubeVideoId, youtubeSearchCanRetry, youtubeSearchError } from './youtubeSearch.js'

describe('YouTube search intent', () => {
  it.each(['Karaokanta - Antología', 'Antología (KARAOKE)', 'Karaokes de ayer', 'Canción — karao', 'Karaoke con voz guía', 'Karaoke with guide vocals'])('accepts karaoke title prefixes without excluding vocal versions: %s', (title) => {
    expect(isKaraokeTitle(title)).toBe(true)
  })

  it.each(['Antología (video oficial)', 'Instrumental sin voz', 'MiKaraoke', 'éKaraoke', ''])('rejects titles without a word starting with karao: %s', (title) => {
    expect(isKaraokeTitle(title)).toBe(false)
  })

  it.each([
    'https://youtu.be/AAAAAAAAAAA?si=example',
    'https://www.youtube.com/watch?v=AAAAAAAAAAA&t=10',
    'https://m.youtube.com/watch?v=AAAAAAAAAAA',
    'https://www.youtube.com/shorts/AAAAAAAAAAA',
    'https://www.youtube.com/live/AAAAAAAAAAA',
  ])('preserves a video URL in every search mode: %s', (url) => {
    expect(youtubeVideoId(url)).toBe('AAAAAAAAAAA')
    for (const mode of ['karaoke', 'lyrics', 'music-video', 'all'] as const) expect(youtubeQuery(url, mode)).toBe(url)
  })

  it('does not interpret lookalike hosts or arbitrary URLs as a video', () => {
    for (const value of ['https://youtube.com.example.com/watch?v=AAAAAAAAAAA', 'https://example.com/AAAAAAAAAAA', 'https://youtube.com/watch?v=invalid', 'a song title']) expect(youtubeVideoId(value)).toBeNull()
  })

  it('explains daily search exhaustion and offers links instead of futile retries', () => {
    expect(youtubeSearchError('YOUTUBE_SEARCH_QUOTA')).toContain('pegar el enlace')
    expect(youtubeSearchError('YOUTUBE_SEARCH_QUOTA', true)).toContain('Google Cloud')
    expect(youtubeSearchCanRetry('YOUTUBE_SEARCH_QUOTA')).toBe(false)
    expect(youtubeSearchCanRetry('YOUTUBE_RATE_LIMIT')).toBe(true)
  })

  it('explains ineligible links without offering a futile retry', () => {
    expect(youtubeSearchError('YOUTUBE_VIDEO_UNSUPPORTED')).toContain('7 minutos')
    expect(youtubeSearchError('YOUTUBE_VIDEO_UNSUPPORTED')).toContain('Música')
    expect(youtubeSearchCanRetry('YOUTUBE_VIDEO_UNSUPPORTED')).toBe(false)
  })
  it('distinguishes formats without changing the local search text', () => {
    expect(youtubeQuery('  Mi canción  ', 'karaoke')).toBe('Mi canción karaoke')
    expect(youtubeQuery('Mi canción', 'lyrics')).toBe('Mi canción letra lyrics')
    expect(youtubeQuery('Mi canción', 'music-video')).toBe('Mi canción video oficial')
    expect(youtubeQuery('  Mi canción  ', 'all')).toBe('Mi canción')
  })

  it('does not duplicate explicit format keywords or turn an empty query into a search', () => {
    expect(youtubeQuery('Mi canción KARAOKE', 'karaoke')).toBe('Mi canción KARAOKE')
    expect(youtubeQuery('Mi canción con letras', 'lyrics')).toBe('Mi canción con letras')
    expect(youtubeQuery('Mi canción official video', 'music-video')).toBe('Mi canción official video')
    expect(youtubeQuery('Mi canción video oficial', 'music-video')).toBe('Mi canción video oficial')
    expect(youtubeQuery('Mi canción VIDEO OFICIAL', 'music-video')).toBe('Mi canción VIDEO OFICIAL')
    expect(youtubeQuery('Mi canción videoclip', 'music-video')).toBe('Mi canción videoclip')
    expect(youtubeQuery('Mi canción official music video', 'music-video')).toBe('Mi canción official music video')
    expect(youtubeQuery('  ', 'karaoke')).toBe('')
  })
})
