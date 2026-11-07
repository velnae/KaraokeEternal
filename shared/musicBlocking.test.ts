import { expect, it } from 'vitest'
import { defaultMusicBlocking, findMusicBlock, validateMusicBlocking } from './musicBlocking.js'

const song = { source: 'YOUTUBE' as const, sourceId: 'AAAAAAAAAAA', title: 'Tema', artistOrChannel: 'Otro artista' }
it('blocks the seeded artist, accents, full-name title mentions and exact short aliases', () => {
  for (const artistOrChannel of [' FARAÓN   LOVE SHADY ', 'Faraon Love Shady - Topic', 'Faraón']) {
    expect(findMusicBlock({ ...song, artistOrChannel }, defaultMusicBlocking)).toBeTruthy()
  }
  expect(findMusicBlock({ ...song, title: 'Faraón Love Shady - Tema (karaoke)' }, defaultMusicBlocking)).toBeTruthy()
  expect(findMusicBlock({ ...song, title: 'El faraón de Egipto' }, defaultMusicBlocking)).toBeUndefined()
  expect(findMusicBlock({ ...song, artistOrChannel: 'Faraones del norte' }, defaultMusicBlocking)).toBeUndefined()
})
it('keeps song and resource rules scoped and validates/deduplicates stored settings', () => {
  const settings = validateMusicBlocking({ rules: [{ kind: 'song', artist: 'Otro artista', title: 'Tema' }, { kind: 'song', artist: 'ÓTRO ARTISTA', title: 'tema' }] })
  expect(settings.rules).toHaveLength(1)
  expect(findMusicBlock(song, settings)).toBeTruthy()
  expect(findMusicBlock({ ...song, artistOrChannel: 'Different', title: 'Tema' }, settings)).toBeUndefined()
  const resource = validateMusicBlocking({ rules: [{ kind: 'resource', source: 'YOUTUBE', sourceId: song.sourceId }] })
  expect(findMusicBlock({ ...song, title: 'Renamed' }, resource)).toBeTruthy()
  expect(findMusicBlock({ ...song, sourceId: 'BBBBBBBBBBB' }, resource)).toBeUndefined()
  for (const invalid of [null, {}, { rules: [null] }, { rules: [{ kind: 'artist', artist: '', aliases: [] }] }, { rules: [{ kind: 'resource', source: 'YOUTUBE', sourceId: 'bad' }] }]) {
    expect(() => validateMusicBlocking(invalid)).toThrow()
  }
})
