import { describe, expect, it } from 'vitest'
import { youtubeQuery } from './youtubeSearch.js'

describe('YouTube search intent', () => {
  it('distinguishes formats without changing the local search text', () => {
    expect(youtubeQuery('  Mi canción  ', 'karaoke')).toBe('Mi canción karaoke')
    expect(youtubeQuery('Mi canción', 'lyrics')).toBe('Mi canción letra lyrics')
    expect(youtubeQuery('Mi canción', 'music-video')).toBe('Mi canción official music video')
    expect(youtubeQuery('  Mi canción  ', 'all')).toBe('Mi canción')
  })

  it('does not duplicate explicit format keywords or turn an empty query into a search', () => {
    expect(youtubeQuery('Mi canción KARAOKE', 'karaoke')).toBe('Mi canción KARAOKE')
    expect(youtubeQuery('Mi canción con letras', 'lyrics')).toBe('Mi canción con letras')
    expect(youtubeQuery('Mi canción official video', 'music-video')).toBe('Mi canción official video')
    expect(youtubeQuery('Mi canción video oficial', 'music-video')).toBe('Mi canción video oficial')
    expect(youtubeQuery('  ', 'karaoke')).toBe('')
  })
})
