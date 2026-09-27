import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseWrapper } from './Database.js'

describe('queue lifecycle migration', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    tempDirs.splice(0).forEach(tempDir => fs.rmSync(tempDir, { recursive: true, force: true }))
  })

  it('preserves legacy queue ids, order, ownership and local metadata', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-eternal-migration-'))
    const legacySchemas = path.join(tempDir, 'legacy-schemas')
    const schemas = path.join(import.meta.dirname, 'schemas')
    tempDirs.push(tempDir)
    fs.mkdirSync(legacySchemas)

    fs.readdirSync(schemas)
      .filter(file => /^00[1-5]-.*\.sql$/.test(file))
      .forEach(file => fs.copyFileSync(path.join(schemas, file), path.join(legacySchemas, file)))

    const database = new DatabaseWrapper(path.join(tempDir, 'database.sqlite3'))
    database.migrate({ migrationsPath: legacySchemas })
    database.exec('PRAGMA foreign_keys = ON')
    database.run('INSERT INTO artists (artistId, name, nameNorm) VALUES (1, \'Artist\', \'artist\')')
    database.run('INSERT INTO songs (songId, artistId, title, titleNorm) VALUES (1, 1, \'First\', \'first\'), (2, 1, \'Second\', \'second\')')
    database.run('INSERT INTO paths (pathId, path, priority, data) VALUES (1, \'/music\', 1, \'{}\')')
    database.run('INSERT INTO media (mediaId, songId, pathId, relPath, duration, isPreferred) VALUES (1, 1, 1, \'first.mp4\', 181, 1), (2, 2, 1, \'second.mp4\', 202, 1)')
    database.run('INSERT INTO rooms (roomId, name, status, data) VALUES (1, \'Room\', \'open\', \'{}\')')
    database.run('INSERT INTO users (userId, username, password, name, roleId) VALUES (1, \'singer\', \'\', \'Singer\', 3)')
    database.run('INSERT INTO queue (queueId, roomId, songId, userId, prevQueueId) VALUES (7, 1, 1, 1, NULL), (9, 1, 2, 1, 7)')

    database.migrate({ migrationsPath: schemas })

    expect(database.all('SELECT queueId, prevQueueId, origin, source, status, title, artistOrChannel, durationSeconds FROM queue ORDER BY queueId')).toEqual([
      {
        queueId: 7,
        prevQueueId: null,
        origin: 'PARTICIPANT',
        source: 'LOCAL',
        status: 'APPROVED',
        title: 'First',
        artistOrChannel: 'Artist',
        durationSeconds: 181,
      },
      {
        queueId: 9,
        prevQueueId: 7,
        origin: 'PARTICIPANT',
        source: 'LOCAL',
        status: 'APPROVED',
        title: 'Second',
        artistOrChannel: 'Artist',
        durationSeconds: 202,
      },
    ])

    database.close()
  })
})
