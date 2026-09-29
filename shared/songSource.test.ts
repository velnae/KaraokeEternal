import { describe, expect, it } from 'vitest'
import { getResolvedSongValidationError, type ResolvedSong } from './songSource.js'

const song: ResolvedSong = {
  source: 'LOCAL',
  sourceId: '1',
  localSongId: 1,
  externalId: null,
  mediaId: 1,
  mediaType: 'mp4',
  title: 'Original song title',
  artistOrChannel: 'Original artist name',
  durationSeconds: 120,
  thumbnailUrl: null,
  isPlayable: true,
}

describe('user-facing song validation', () => {
  it('reports missing song metadata in Spanish without changing supplied metadata', () => {
    expect(getResolvedSongValidationError({ ...song, title: '' })).toBe('Faltan datos de la canción')
    expect(song.title).toBe('Original song title')
    expect(song.artistOrChannel).toBe('Original artist name')
  })

  it('reports invalid duration and local media identifiers in Spanish', () => {
    expect(getResolvedSongValidationError({ ...song, durationSeconds: -1 }))
      .toBe('La duración de la canción no es válida')
    expect(getResolvedSongValidationError({ ...song, mediaId: null }))
      .toBe('La canción local debe tener un archivo multimedia válido')
  })
})
