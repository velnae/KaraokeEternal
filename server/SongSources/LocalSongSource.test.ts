import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getResolvedSongValidationError } from '../../shared/songSource.js'
import { close, db, open } from '../lib/Database.js'
import Library from '../Library/Library.js'
import { localSongSource } from './LocalSongSource.js'

describe('LocalSongSource', () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-eternal-local-source-'))
    open({ file: path.join(tempDir, 'database.sqlite3'), ro: false })
    db.run('INSERT INTO artists (artistId, name, nameNorm) VALUES (1, \'Alpha Artist\', \'alpha artist\'), (2, \'Beta Band\', \'beta band\')')
    db.run('INSERT INTO songs (songId, artistId, title, titleNorm) VALUES (1, 1, \'First Song\', \'first song\'), (2, 2, \'Second Song\', \'second song\'), (3, 1, \'Unavailable Song\', \'unavailable song\')')
    db.run('INSERT INTO paths (pathId, path, priority, data) VALUES (1, \'/music/primary\', 1, \'{"prefs":{}}\'), (2, \'/music/secondary\', 2, \'{"prefs":{}}\')')
    db.run('INSERT INTO media (mediaId, songId, pathId, relPath, duration, isPreferred) VALUES (1, 1, 1, \'first.zip\', 181, 0), (2, 1, 2, \'first.mp4\', 182, 1), (3, 2, 1, \'second.zip\', 203, 0)')
    Library.cache = { version: null }
  })

  afterAll(() => {
    Library.cache = { version: null }
    close()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('searches the existing library by title or artist with normalized results', async () => {
    const byTitle = await localSongSource.search(' first ', { roomId: 1 })
    const byArtist = await localSongSource.search('BETA', { roomId: 1 })

    expect(byTitle).toEqual([{
      source: 'LOCAL',
      sourceId: '1',
      title: 'First Song',
      artistOrChannel: 'Alpha Artist',
      durationSeconds: 182,
      thumbnailUrl: null,
      isPlayable: true,
    }])
    expect(byArtist.map(song => song.sourceId)).toEqual(['2'])
    expect((await localSongSource.search('', { roomId: 1 })).map(song => song.sourceId)).toEqual(['1', '2'])
  })

  it('resolves the preferred local media and satisfies source invariants', async () => {
    const song = await localSongSource.resolve('1', { roomId: 1 })

    expect(song).toEqual({
      source: 'LOCAL',
      sourceId: '1',
      localSongId: 1,
      externalId: null,
      mediaId: 2,
      mediaType: 'mp4',
      title: 'First Song',
      artistOrChannel: 'Alpha Artist',
      durationSeconds: 182,
      thumbnailUrl: null,
      isPlayable: true,
    })
    expect(song && getResolvedSongValidationError(song)).toBeNull()
  })

  it('rejects malformed, missing and unplayable local identifiers', async () => {
    await expect(localSongSource.resolve('1abc', { roomId: 1 })).resolves.toBeNull()
    await expect(localSongSource.resolve('999', { roomId: 1 })).resolves.toBeNull()
    await expect(localSongSource.resolve('3', { roomId: 1 })).resolves.toBeNull()
  })

  it('does not mutate or replace the inherited library cache', async () => {
    const before = Library.get()
    await localSongSource.search('song', { roomId: 1 })
    const after = Library.get()

    expect(after).toBe(before)
    expect(after.songs?.result).toEqual([1, 2])
    expect(after.artists?.result).toEqual([1, 2])
  })
})
